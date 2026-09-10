// v1.4.0: 会话消耗投影的事件语义 —— 对齐框架 dsh-token-meter 的 usage-projection。
//
// 背景: 旧代码只处理一个**不存在**的事件名 `assistant/chunk`(不在 KNOWN_SESSION_EVENT_TYPES 里),
//       于是两件真事被漏掉:
//         ① `assistant/attempt`(失败/重试/取消、没产出可见消息的尝试) 的 token 全丢;
//         ② 重试时 `llm/retry-started` 该关闭替换槽位, 否则第二次上报会**替换**掉第一次 → 少算。
//       两条都会让面板少算钱, 而旧夹具用的正是 `assistant/chunk`, 所以回归一直没拦住。
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name) } }

const CFG = { currency: 'CNY', overseasCurrency: 'USD' }
const hdr = (model) => ({ type: 'request/header', data: { header: { config: { model } } } })
const msg = (turn, step, usage) => ({ type: 'assistant/message', data: { turn, step, message: {}, stream: [], usage } })
const msgNoUsage = (turn, step, stream) => ({ type: 'assistant/message', data: { turn, step, message: {}, stream } })
const attempt = (turn, step, stream) => ({ type: 'assistant/attempt', data: { turn, step, stream } })
const retry = (turn, step) => ({ type: 'llm/retry-started', data: { retryId: 'r1', turn, step, retry: 1 } })
const usageChunk = (u) => ({ type: 'chunk', time0: 0, chunk: { type: 'usage', usage: u } })
const textChunk = () => ({ type: 'chunk', time0: 0, chunk: { type: 'text-delta', text: 'hi' } })

const run = (events) => {
  const proj = m.makeCostProjection(() => CFG)
  let st = proj.init()
  for (const ev of events) st = proj.apply(st, ev)
  return proj.wire.view(st)
}

// ---- 1. 基本路径: assistant/message 自带 usage ----
{
  const v = run([hdr('mimo-v2.5'), msg(1, 1, { inputTokens: 1000, outputTokens: 500 })])
  a('T1 message 自带 usage 被计入', v.tokens.uncachedInput === 1000 && v.tokens.output === 500)
}
// ---- 2. assistant/message 没带 usage, 但 stream 里有 usage chunk ----
{
  const v = run([hdr('mimo-v2.5'), msgNoUsage(1, 1, [textChunk(), usageChunk({ inputTokens: 700, outputTokens: 300 })])])
  a('T2 message 从 stream 回落取 usage', v.tokens.uncachedInput === 700 && v.tokens.output === 300)
}
// ---- 3. 🔴 assistant/attempt 的用量必须计入 (旧代码完全漏掉) ----
{
  const v = run([hdr('mimo-v2.5'), attempt(1, 1, [usageChunk({ inputTokens: 200000, outputTokens: 120 })])])
  a('T3 attempt 的用量被计入 (旧代码记为 0)', v.tokens.uncachedInput === 200000 && v.tokens.output === 120)
}
// ---- 4. 🔴 重试: llm/retry-started 之后, 下一次 attempt 是累加而非替换 ----
{
  const v = run([
    hdr('mimo-v2.5'),
    msg(1, 1, { inputTokens: 1000, outputTokens: 500 }),
    retry(1, 1),
    msg(1, 1, { inputTokens: 1000, outputTokens: 100 }),
  ])
  a('T4 重试后用量累加 (2000/600), 不被替换', v.tokens.uncachedInput === 2000 && v.tokens.output === 600)
}
// ---- 5. 没有 retry-started 时, 同 turn/step 的重复上报仍是替换语义 (不重复计数) ----
{
  const v = run([
    hdr('mimo-v2.5'),
    msg(1, 1, { inputTokens: 1000, outputTokens: 500 }),
    msg(1, 1, { inputTokens: 1000, outputTokens: 500 }),
  ])
  a('T5 同 turn/step 重复上报不重复计数', v.tokens.uncachedInput === 1000 && v.tokens.output === 500)
}
// ---- 6. retry-started 不匹配 turn/step 时不动状态 ----
{
  const v = run([
    hdr('mimo-v2.5'),
    msg(1, 1, { inputTokens: 1000, outputTokens: 500 }),
    retry(9, 9),
    msg(1, 1, { inputTokens: 1000, outputTokens: 500 }),
  ])
  a('T6 retry-started 不匹配时不误清槽位', v.tokens.uncachedInput === 1000)
}
// ---- 7. 🔴 `assistant/chunk` 不是真实事件, 不该被当成用量来源 ----
{
  const v = run([hdr('mimo-v2.5'), { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 999, outputTokens: 999 } } } }])
  a('T7 死事件 assistant/chunk 不再产出用量', v.tokens.uncachedInput === 0 && v.waiting === true)
}

// ---- 8. 缓存读写分桶不串味 ----
{
  const v = run([hdr('glm-5.3'), msg(1, 1, { inputTokens: 100, outputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 30 })])
  a('T8 缓存读/写分桶正确', v.tokens.uncachedInput === 100 && v.tokens.cacheRead === 20 && v.tokens.cacheWrite === 30 && v.tokens.output === 10)
}
// ---- 9. 端到端金额: 1M 未缓存输入走原生币种 ----
{
  const v = run([hdr('glm-5.3'), msg(1, 1, { inputTokens: 1_000_000, outputTokens: 0 })])
  a('T9 glm-5.3 1M 输入 = ¥8 (原生 CNY, 不再 ×7 舍入)', Math.abs(v.cost - 8) < 1e-9)
}
// ---- 10. 重试场景的端到端金额 (漏计会直接少算钱) ----
{
  const v = run([
    hdr('mimo-v2.5-pro'),
    attempt(1, 1, [usageChunk({ inputTokens: 500000, outputTokens: 0 })]),
    retry(1, 1),
    msg(1, 1, { inputTokens: 500000, outputTokens: 0 }),
  ])
  a('T10 重试+attempt 合计 1M 输入 = ¥3 (少算时会是 ¥1.5)', Math.abs(v.cost - 3) < 1e-9)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
