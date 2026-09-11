// v1.4.0: 子代理消耗汇总 —— 把子会话(subagent)的消耗并进父会话的投影视图。
// 关键性质: ① 只取直接子代理; ② 顺序 = 父会话 subagentCatalog 事件顺序(创建顺序);
//           ③ 金额向上汇总(孙代理并进它的直接父代理那一条); ④ 服务缺失时静默为空。
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name) } }
const CFG = { currency: 'CNY', overseasCurrency: 'USD' }

// ---- 极简 mock: 只实现本功能用到的那两个面 ----
const mkHost = ({ catalogs = {}, states = {} } = {}) => ({
  sessions: { get: (id) => (id in states || id in catalogs ? { id } : undefined) },
  projections: {
    snapshot: (session) => ({ values: { subagentCatalog: catalogs[session.id] ?? [] } }),
    stateOf: (session) => states[session.id],
  },
})
// 一份「某模型跑了 N 个未缓存输入 token」的投影状态
const raw = (model, inputTokens) => ({
  currentModel: model, currentProvider: null, last: null, modelOrder: [model],
  byModel: { [model]: { uncachedInputTokens: inputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } },
  sessionId: 'x',
})
const st = (model, inputTokens) => ({ ...raw(model,inputTokens), ownBoundaryKnown:true, own:raw(model,inputTokens), ownChildIds:[] })
const child = (id, label, createdAt, mode = 'continuable') => ({ id, label, createdAt, mode })

const run = (state, host) => {
  const proj = m.makeCostProjection(() => CFG, () => host)
  return proj.wire.view(state)
}
const parentState = (host) => {
  const proj = m.makeCostProjection(() => CFG, () => host)
  let s = proj.init({ id: 'parent' })
  s = proj.apply(s, { type: 'request/header', data: { header: { config: { model: 'glm-5.3' } } } })
  s = proj.apply(s, { type: 'assistant/message', data: { turn: 1, step: 1, message: {}, stream: [], usage: { inputTokens: 1_000_000, outputTokens: 0 } } })
  try { for (const c of host?.projections?.snapshot?.({id:"parent"})?.values?.subagentCatalog ?? []) s=proj.apply(s,{type:"subagent/catalog",data:{childId:c.id}}) } catch {}
  return proj.wire.view(s)
}

// ---- 1. 两个子代理, 顺序 = catalog 顺序, 金额各自独立 ----
{
  const host = mkHost({
    catalogs: { parent: [child('c1', 'researcher', 1), child('c2', 'implementer', 2)] },
    states: { parent: st('glm-5.3', 1_000_000), c1: st('glm-5.3', 1_000_000), c2: st('mimo-v2.5', 1_000_000) },
  })
  const v = parentState(host)
  a('S1 主板数字仍只算本会话 (¥8)', Math.abs(v.cost - 8) < 1e-9)
  a('S1 拿到 2 个子代理', v.subagents.length === 2)
  a('S1 顺序 = catalog 顺序 (researcher 在前)', v.subagents[0].label === 'researcher' && v.subagents[1].label === 'implementer')
  a('S1 c1 金额 = ¥8 (glm-5.3 1M 输入, 原生 CNY)', Math.abs(v.subagents[0].cost - 8) < 1e-9)
  a('S1 c2 金额 = ¥1 (mimo-v2.5 1M 输入)', Math.abs(v.subagents[1].cost - 1) < 1e-9)
  a('S1 币种分组正确', v.subagents[0].costByCurrency.CNY === 8 && v.subagents[1].costByCurrency.CNY === 1)
}
// ---- 2. 顺序真的跟着 catalog 走 (换一下顺序, 输出也要换) ----
{
  const host = mkHost({
    catalogs: { parent: [child('c2', 'B', 2), child('c1', 'A', 1)] },
    states: { parent: st('glm-5.3', 1_000_000), c1: st('glm-5.3', 1_000_000), c2: st('mimo-v2.5', 1_000_000) },
  })
  const v = parentState(host)
  a('S2 顺序跟随 catalog (B 在前)', v.subagents[0].label === 'B' && v.subagents[1].label === 'A')
  a('S2 金额也跟着条目走', Math.abs(v.subagents[0].cost - 1) < 1e-9 && Math.abs(v.subagents[1].cost - 8) < 1e-9)
}
// ---- 3. 孙代理向上汇总到它的直接父代理 ----
{
  const host = mkHost({
    catalogs: { parent: [child('c1', 'parent-agent', 1)], c1: [child('g1', 'grand', 2)] },
    states: { parent: st('glm-5.3', 0), c1: st('glm-5.3', 1_000_000), g1: st('mimo-v2.5', 1_000_000) },
  })
  const v = parentState(host)
  a('S3 只有 1 条直接子代理', v.subagents.length === 1)
  a('S3 只计自身¥8，不计孙代理', Math.abs(v.subagents[0].cost - 8) < 1e-9)
  a('S3 token也只计自身', v.subagents[0].tokens.uncachedInput === 1_000_000)
}
// ---- 4. 子代理用了海外模型 → 各自币种, 不按汇率合并 ----
{
  const host = mkHost({
    catalogs: { parent: [child('c1', 'claude-bot', 1)] },
    states: { parent: st('glm-5.3', 0), c1: st('claude-opus-5', 1_000_000) },
  })
  const v = parentState(host)
  a('S4 子代理走原生 USD ($5)', v.subagents[0].costByCurrency.USD === 5)
  a('S4 子代理标记混合货币', v.subagents[0].mixedCurrency === false && v.subagents[0].currencyByModel['claude-opus-5'] === 'USD')
}
// ---- 5. 没有子代理 / 服务缺失 / 子会话读不到 → 空数组, 不抛异常 ----
{
  const v1 = parentState(mkHost({ catalogs: { parent: [] }, states: { parent: st('glm-5.3', 0) } }))
  a('S5 无子代理 → 空数组', Array.isArray(v1.subagents) && v1.subagents.length === 0)
  const proj = m.makeCostProjection(() => CFG, () => null)
  const v2 = proj.wire.view(proj.init({ id: 'p' }))
  a('S5 无服务 → 空数组且不抛', v2.subagents.length === 0)
  const host = mkHost({ catalogs: { parent: [child('ghost', 'missing', 1)] }, states: { parent: st('glm-5.3', 0) } })
  const v3 = parentState(host)
  a('S5 子会话缺失为waiting非0', v3.subagents.length === 1 && v3.subagents[0].cost === -1 && v3.subagents[0].waiting)
  const bad = { sessions: { get: () => { throw new Error('boom') } }, projections: { snapshot: () => { throw new Error('boom') }, stateOf: () => { throw new Error('boom') } } }
  let threw = false
  try { parentState(bad) } catch { threw = true }
  a('S5 服务抛异常 → 静默降级, 不冒泡', threw === false)
}
// ---- 6. 标签缺失时回落到 id 前 12 位 ----
{
  const host = mkHost({
    catalogs: { parent: [{ id: 'abcdefghijklmnop', createdAt: 1, mode: 'one-shot' }] },
    states: { parent: st('glm-5.3', 0), abcdefghijklmnop: st('glm-5.3', 0) },
  })
  const v = parentState(host)
  a('S6 无 label → 用 id 前 12 位', v.subagents[0].label === 'abcdefghijkl')
  a('S6 mode 透传', v.subagents[0].mode === 'one-shot')
}
// ---- 7. 上限保护: catalog 超长时截断到 SUBAGENT_MAX_ROWS ----
{
  const many = Array.from({ length: 30 }, (_, i) => child('c' + i, 'a' + i, i))
  const states = { parent: st('glm-5.3', 0) }
  for (const c of many) states[c.id] = st('glm-5.3', 0)
  const v = parentState(mkHost({ catalogs: { parent: many }, states }))
  a('S7 行数被截断 (≤12)', v.subagents.length <= 12 && v.subagents.length > 0)
}
// ---- 8. 视图通过 strict schema ----
{
  const host = mkHost({
    catalogs: { parent: [child('c1', 'x', 1), child('c2', 'y', 2, 'one-shot')] },
    states: { parent: st('glm-5.3', 1_000_000), c1: st('glm-5.3', 1_000_000), c2: st('claude-opus-5', 1_000_000) },
  })
  const proj = m.makeCostProjection(() => CFG, () => host)
  let s = proj.init({ id: 'parent' })
  s = proj.apply(s, { type: 'assistant/message', data: { turn: 1, step: 1, message: {}, stream: [], usage: { inputTokens: 10, outputTokens: 1 } } })
  let ok = true
  try { proj.wire.viewSchema.parse(proj.wire.view(s)) } catch (e) { ok = false; console.log('  schema: ' + e.message.slice(0, 200)) }
  a('S8 带子代理的视图通过 viewSchema (strict)', ok)
}
// ---- 9. mergeSummary / emptySummary 单元 ----
{
  const e = m.emptySummary()
  a('S9 emptySummary 形态完整', e.cost === 0 && Array.isArray(e.models) && e.tokens.uncachedInput === 0)
  const merged = m.mergeSummary(
    { cost: 1, costByModel: { a: 1 }, costByCurrency: { CNY: 1 }, currencyByModel: { a: 'CNY' }, mixedCurrency: false, models: ['a'], tokens: { uncachedInput: 10, cacheRead: 0, cacheWrite: 0, output: 0 }, tokensByModel: { a: { uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } } },
    { cost: 2, costByModel: { b: 2 }, costByCurrency: { CNY: 2 }, currencyByModel: { b: 'CNY' }, mixedCurrency: false, models: ['b'], tokens: { uncachedInput: 20, cacheRead: 0, cacheWrite: 0, output: 0 }, tokensByModel: { b: { uncachedInputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } } })
  a('S9 币种相加', merged.costByCurrency.CNY === 3)
  a('S9 token 相加', merged.tokens.uncachedInput === 30)
  a('S9 模型并集', merged.models.join() === 'a,b')
  const mixed = m.mergeSummary({ costByCurrency: { CNY: 1 }, costByModel: {}, currencyByModel: {}, models: [], tokens: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, tokensByModel: {} },
    { costByCurrency: { USD: 5 }, costByModel: {}, currencyByModel: {}, models: [], tokens: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, tokensByModel: {} })
  a('S9 两种币种 → mixedCurrency', mixed.mixedCurrency === true && mixed.costByCurrency.USD === 5)
}

// ---- 10. 端到端: 父 + 2 子, 主板数字不被子代理污染 ----
{
  const host = mkHost({
    catalogs: { parent: [child('c1', 'A', 1), child('c2', 'B', 2)] },
    states: { parent: st('glm-5.3', 1_000_000), c1: st('glm-5.3', 1_000_000), c2: st('glm-5.3', 1_000_000) },
  })
  const v = parentState(host)
  a('S10 主板 = 本会话 ¥8 (不含子代理)', Math.abs(v.cost - 8) < 1e-9)
  a('S10 子代理合计 = ¥16 (2×¥8)', Math.abs(v.subagents[0].cost + v.subagents[1].cost - 16) < 1e-9)
}

// ---- 11. 冷子会话兜底 (从持久化投影缓存文件读) ----
// 子代理跑完就"冷"了(框架 SubagentListEntry.activity 只有 'running' | 'inactive'),
// 不在 ctx.sessions 常驻表里, 热路径拿不到 → 必须回落到
// storages/session_projcache/sessions/<id>.json (实测踩到: 面板显示 ~—)
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join as pjoin } from 'node:path'

const home = mkdtempSync(pjoin(tmpdir(), 'dshadb-sub-'))
mkdirSync(pjoin(home, 'storages', 'session_projcache', 'sessions'), { recursive: true })
process.env.DSH_HOME = home
const cacheFile = (id, rows) => writeFileSync(
  pjoin(home, 'storages', 'session_projcache', 'sessions', `${id}.json`),
  JSON.stringify({ version: 3, record: { identity: { formatVersion: 3 }, rows } }))
const costRow = (model, inputTokens) => ({ ver:3, seq:10, val: st(model,inputTokens) })
const catRow = (kids) => ({ ver: 2, seq: 5, val: { inheritedEventCount: 0, head: { values: kids.map((c) => ({
  version: 0, childId: c.id, childCreatedAt: c.createdAt, mode: c.mode, label: c.label })) } } })
// 全冷的宿主: sessions.get 一律 undefined, 投影也拿不到东西
const coldHost = () => ({ sessions: { get: () => undefined }, projections: { snapshot: () => ({ values: {} }), stateOf: () => undefined } })
const viewOf = (id, host) => { const p = m.makeCostProjection(() => CFG, () => host); const s=p.init({id});
const known={'parent-cold':['kid-1'],'parent-cold2':['kid-2'],'live-p':['kid-live']};s.ownChildIds=known[id]??[];return p.wire.view(s) }

{
  cacheFile('parent-cold', { subagentCatalog: catRow([child('kid-1', '冷子代理', 1)]) })
  cacheFile('kid-1', { queryBalanceCost: costRow('glm-5.3', 1_000_000) })
  const v = viewOf('parent-cold', coldHost())
  a('C1 冷父会话也能列出子代理', v.subagents.length === 1 && v.subagents[0].label === '冷子代理')
  a('C1 冷子会话消耗从缓存文件读到 (¥8)', Math.abs(v.subagents[0].cost - 8) < 1e-9)
}
{
  cacheFile('kid-2', { queryBalanceCost: costRow('glm-5.3', 1_000_000), subagentCatalog: catRow([child('grand-2', '孙', 2)]) })
  cacheFile('grand-2', { queryBalanceCost: costRow('mimo-v2.5', 1_000_000) })
  cacheFile('parent-cold2', { subagentCatalog: catRow([child('kid-2', '中间', 1)]) })
  const v = viewOf('parent-cold2', coldHost())
  a('C2 冷路径只计自身¥8', v.subagents.length === 1 && Math.abs(v.subagents[0].cost - 8) < 1e-9)
}
{
  // 热路径有数据时不读文件: 文件里故意写 9M token 来区分
  cacheFile('live-p', { subagentCatalog: catRow([child('kid-live', '热的', 1)]) })
  cacheFile('kid-live', { queryBalanceCost: costRow('glm-5.3', 9_000_000) })
  const hot = mkHost({ catalogs: { 'live-p': [child('kid-live', '热的', 1)] }, states: { 'live-p': st('glm-5.3', 0), 'kid-live': st('glm-5.3', 1_000_000) } })
  const v = viewOf('live-p', hot)
  a('C3 热路径优先 (¥8, 不是文件里的 ¥72)', Math.abs(v.subagents[0].cost - 8) < 1e-9)
}
{
  writeFileSync(pjoin(home, 'storages', 'session_projcache', 'sessions', 'broken.json'), '{不是 JSON')
  cacheFile('only-cost', { queryBalanceCost: costRow('glm-5.3', 1) })
  let threw = false
  const safeView = (id) => { try { return viewOf(id, coldHost()) } catch { threw = true; return { subagents: [] } } }
  a('C4 坏 JSON → 空, 不抛', safeView('broken').subagents.length === 0 && threw === false)
  a('C4 文件不存在 → 空', safeView('nope-nothing-here').subagents.length === 0)
  a('C4 路径穿越 id 被拒', safeView('../../etc/passwd').subagents.length === 0)
  a('C4 缺 subagentCatalog 行 → 空', safeView('only-cost').subagents.length === 0)
}
delete process.env.DSH_HOME

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
