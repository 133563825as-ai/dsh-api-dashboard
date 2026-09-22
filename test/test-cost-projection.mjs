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

// ---- 11. 🔴 峰谷必须按**事件发生时刻**计价, 不能按"查看时刻" ----
// 北京时间 11:00 = UTC 03:00 → 峰时; 北京时间 13:00 = UTC 05:00 → 谷时。
// 2026-09-22 是周二, 两笔都在工作日, 不落周末特惠。
{
  const peakTs = Date.UTC(2026, 8, 22, 3, 0, 0)
  const offTs  = Date.UTC(2026, 8, 22, 5, 0, 0)
  const ts = (ev, t) => ({ ...ev, time: t })
  const v = run([
    ts(hdr('deepseek-flash'), peakTs),
    ts(msg(1, 1, { outputTokens: 1_000_000 }), peakTs),
    ts(msg(2, 1, { outputTokens: 1_000_000 }), offTs),
  ])
  // 1M 输出 @峰 ¥8 + 1M 输出 @谷 ¥4 = ¥12 —— 与"跑测试的时刻"无关。
  // 旧实现只用 Date.now() 计价, 两笔会被算成同一个价(¥8 或 ¥16), 恒不等于 12。
  a('T11 峰谷按事件时间分相计价 (¥8 + ¥4 = ¥12)', Math.abs(v.cost - 12) < 1e-9)
}
// ---- 12. 事件缺 time 字段时回退当前时刻, 不崩 ----
{
  const v = run([hdr('deepseek-flash'), msg(1, 1, { outputTokens: 1_000_000 })])
  a('T12 缺 time 的事件仍能计价(回退当前时刻)', v.cost > 0)
}
// ---- 13. 🔴 法定节假日必须算谷时 ----
// 官方英文定价页: "Peak hours are 01:00-04:00 and 06:00-10:00 UTC, Monday through Friday,
//   excluding Chinese public holidays ... including weekends and Chinese public holidays in full."
// 漏掉这条会在全年 33 天假期里把消耗按峰价高估一倍。
{
  const bj = (y, mo, d, h) => Date.UTC(y, mo - 1, d, h - 8) // 构造"北京时间 h:00"的时间戳
  a('T13 国庆 10-01 北京11:00 → 谷时', m.isPeakTime(bj(2026, 10, 1, 11)) === false)
  a('T13b 春节 02-17 北京10:00 → 谷时', m.isPeakTime(bj(2026, 2, 17, 10)) === false)
  a('T13c 普通工作日 2026-09-22 北京11:00 → 峰时(不能被假期逻辑误伤)', m.isPeakTime(bj(2026, 9, 22, 11)) === true)
  a('T13d 普通工作日 北京13:00 → 谷时(午休段)', m.isPeakTime(bj(2026, 9, 22, 13)) === false)
  a('T13e 表外年份不误判 (2027 国庆仍是峰时)', m.isCnHoliday('2027-10-01') === false && m.isPeakTime(bj(2027, 10, 1, 11)) === true)
  a('T13f 2026 七个假期区间首末日均命中', ['01-01','01-03','02-15','02-23','04-04','05-01','06-19','09-25','10-01','10-07'].every(d => m.isCnHoliday('2026-' + d) === true))
  a('T13g 假期外不误判 (09-22 / 10-08)', m.isCnHoliday('2026-09-22') === false && m.isCnHoliday('2026-10-08') === false)
}
// ---- 14. 缓存写入按 cacheWrite 计价 (官方 Anthropic = 输入 ×125%) ----
{
  const v = run([hdr('claude-opus-5'), msg(1, 1, { cacheWriteTokens: 1_000_000 })])
  // 海外模型走 USD, 不进主货币 cost, 而在 costByCurrency.USD 里 (v1.3.2 混合币种设计)
  a('T14 claude-opus-5 1M 缓存写 = $6.25 (旧实现按 cacheMiss 只算 $5)', Math.abs((v.costByCurrency?.USD ?? 0) - 6.25) < 1e-9)
}
{
  const v = run([hdr('glm-5.3'), msg(1, 1, { cacheWriteTokens: 1_000_000 })])
  a('T15 未给 cacheWrite 的条目回落 cacheMiss (glm-5.3 1M 缓存写 = ¥8)', Math.abs(v.cost - 8) < 1e-9)
}
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
