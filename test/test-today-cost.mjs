// v1.6.7 「今日总结」跨会话汇总的**去重**钉子。
//
// 真机现象(维护者 2026-09-29 反馈): 只开着当前这一个会话, 状态条显示本会话 ~¥1.26,
// 但看板里的「今日总结」是 ¥2.53 —— **正好翻倍**, 比例精确到 2.000。
//
// 根因: collectTodayCost 的取数顺序是
//   ① 先把自己(add2 直接吃 selfState)
//   ② 再遍历宿主常驻会话 sessions.list()
//   ③ 最后扫投影缓存目录里的**冷会话**
// ② 里 `SessionStore.list()` 返回的是**全部常驻会话**, 当前这个会话就在里面。旧代码在 ②
// 只把 id 记进 `seen` 却**照样 add()** —— `seen` 实际只挡得住 ③(缓存路径), 于是当前会话
// 被算了两次: 状态条 1.26 → 今日 2.53。
//
// 这个数字从 v1.6.2 引入起就没有任何测试覆盖(全仓 grep 只有一处调用点), 所以下面几条把它钉死:
//   C1 当前会话在常驻表里(真机场景) → 只算一次
//   C2 常驻表里出现重复条目 / 夹着别的会话 → 各算一次
//   C3 只有本会话常驻、别的都是冷会话 → 自己那份缓存文件不能再被 ③ 加一遍
//   C4 拿不到 sessionId 时按对象身份认自己 → 和「常驻表里没有自己」等价(不再翻倍)
//
// 夹具用临时 DSH_HOME(绝不读运行机器上的私有文件): 缓存文件路径 = <DSH_HOME>/storages/
// session_projcache/sessions/<id>.json, 形状与真机逐项对齐({ version, record: { identity, rows } })。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

// ---- 夹具 ----
const TTL_SAFE = '夹具必须在 listCacheSessionIds 的 10s TTL 之前一次性写好'
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-today-'))
const sessionsDir = path.join(home, 'storages', 'session_projcache', 'sessions')
fs.mkdirSync(sessionsDir, { recursive: true })
process.env.DSH_HOME = home

// 北京时间当天(collectTodayCost 内部用 bjtParts 取 ymd, 这里按同一口径算 UTC+8)
const TODAY = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)

/** 金额 → 当日桶: 约定「1 块钱 = 1000 个 uncachedInput token」。
 *  ⚠️ 计价桩必须**只看桶里的数字**, 不能用对象身份的 WeakMap —— 冷会话是 JSON 读回来的,
 *  对象身份过不了序列化, 那样金额会静默变成 0(token 照加), 夹具就假了。 */
const mkState = (sessionId, cost) => {
  const dayMap = { 'deepseek-flash': { uncachedInputTokens: cost * 1000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 } }
  const state = { sessionId, byDay: { [TODAY]: dayMap } }
  return state
}
const priceDay = (dayMap) => {
  const b = Object.values(dayMap)[0]
  const tokens = b.uncachedInputTokens + b.cacheReadTokens + b.cacheWriteTokens + b.outputTokens
  const cost = b.uncachedInputTokens / 1000
  return { byCurrency: { CNY: cost }, tokens: { uncachedInput: b.uncachedInputTokens, cacheRead: b.cacheReadTokens, cacheWrite: b.cacheWriteTokens, output: b.outputTokens }, byModel: { 'deepseek-flash': { tokens, cost, currency: 'CNY' } } }
}
const writeCache = (id, state) => {
  fs.writeFileSync(path.join(sessionsDir, `${id}.json`), JSON.stringify({
    version: 7,
    record: { identity: { formatVersion: 4, createdAt: 1, cwd: '/root', isSeeded: false, inheritedEventCount: 0 }, rows: { queryBalanceCost: { ver: 5, seq: 1, val: state } } },
  }))
}

const SELF_ID = 'session-self-0001'          // 当前会话
const OTHER_ID = 'session-other-0002'        // 另一个常驻会话
const COLD_ID = 'session-cold-0003'          // 冷会话(只在缓存目录里)
const SELF = 1.26, OTHER = 2, COLD = 4       // 各自的当日花销(真机那一笔: 本会话 1.26)
const selfState = mkState(SELF_ID, SELF)
const otherState = mkState(OTHER_ID, OTHER)
const coldState = mkState(COLD_ID, COLD)
writeCache(SELF_ID, selfState)               // 当前会话的缓存文件**也在**(真机就是如此)
writeCache(OTHER_ID, otherState)
writeCache(COLD_ID, coldState)

/** 冷会话永远走缓存计入, 所以「常驻表里只有自己」时的正确值 = 自己 + 两个冷会话。 */
const OK_SELF_ONCE = SELF + OTHER + COLD
/** 本次修的那个 bug 会算出来的值: 自己那份加了两遍(状态条 1.26 → 今日 2.53)。 */
const BUG_SELF_TWICE = SELF * 2 + OTHER + COLD

const { collectTodayCost } = await import('../src/index.js')

/** 造 services: 常驻表 = list, projections.stateOf 就是拿同一批 state。 */
const services = (list) => ({
  sessions: { list: () => list },
  projections: { stateOf: (s) => s.state },
})
const sess = (id, state) => ({ id, state })
const run = (list, self = selfState) => collectTodayCost(services(list), priceDay, self)

console.log('夹具: DSH_HOME=' + home + ' 今日=' + TODAY + '  (' + TTL_SAFE + ')')

// ===== C1 真机场景: 当前会话就在常驻表里 =====
// 旧代码这里 = BUG_SELF_TWICE(自己算两次)。这条就是本次的回归钉子。
const c1 = run([sess(SELF_ID, selfState)])
a('C1 当前会话在常驻表里也只算一次', c1.byCurrency.CNY === OK_SELF_ONCE, 'byCurrency=' + JSON.stringify(c1.byCurrency) + ' 期望 ' + OK_SELF_ONCE)
a('C1 不是「本会话 ×2」那个 bug 值', c1.byCurrency.CNY !== BUG_SELF_TWICE, 'byCurrency=' + JSON.stringify(c1.byCurrency))
a('C1 token 也不翻倍', c1.tokens.uncachedInput === (SELF + OTHER + COLD) * 1000, 'tokens=' + JSON.stringify(c1.tokens))

// ===== C2 常驻表里重复条目 + 夹着别的会话 =====
const sessOther = sess(OTHER_ID, otherState)
const c2 = run([sess(SELF_ID, selfState), sessOther, sessOther])
a('C2 常驻表重复条目去重(自己 1 次 + 别的会话 1 次)', c2.byCurrency.CNY === OK_SELF_ONCE, 'byCurrency=' + JSON.stringify(c2.byCurrency))
a('C2 逐模型金额同样只加一次', c2.byModel['deepseek-flash'].cost === OK_SELF_ONCE, JSON.stringify(c2.byModel))

// ===== C3 常驻表里只有自己, 其余全是冷会话 =====
// 自己那份**缓存文件**必须被 selfId 挡住(否则又变成 2 倍), 另两个冷会话走缓存各算一次。
const c3 = run([sess(SELF_ID, selfState)])
a('C3 自己的缓存文件不再被加一遍', c3.byCurrency.CNY === OK_SELF_ONCE, 'byCurrency=' + JSON.stringify(c3.byCurrency))
a('C3 冷会话按缓存计入', c3.tokens.uncachedInput === (SELF + OTHER + COLD) * 1000, 'tokens=' + JSON.stringify(c3.tokens))

// ===== C4 拿不到 sessionId 的兜底: 按对象身份认自己 =====
// 已知边界: 没有 id 就认不出「哪份缓存是自己」(自己那份缓存会被多计一次), 所以这里只钉
// 「常驻表里那一份不再重复加」—— 即「list 里有自己」与「list 为空」必须得到同一个数。
const noIdSelf = { ...mkState(undefined, SELF), sessionId: undefined }
const c4WithSelf = run([sess('x', noIdSelf)], noIdSelf)
const c4Empty = run([], noIdSelf)
a('C4 无 sessionId 时按对象身份认自己(列表里有自己 == 列表为空)',
  c4WithSelf.byCurrency.CNY === c4Empty.byCurrency.CNY && c4WithSelf.tokens.uncachedInput === c4Empty.tokens.uncachedInput,
  JSON.stringify(c4WithSelf.byCurrency) + ' vs ' + JSON.stringify(c4Empty.byCurrency))
a('C4 值 = 自己 + 自己那份缓存 + 两个冷会话(已知边界)',
  c4Empty.byCurrency.CNY === SELF * 2 + OTHER + COLD, JSON.stringify(c4Empty.byCurrency))

// ===== C5 取不到服务 / 会话列表异常时不许炸 =====
const c5a = collectTodayCost({}, priceDay, selfState)
a('C5a 宿主没给 sessions/projections → 只算自己 + 缓存里的冷会话', c5a.byCurrency.CNY === OK_SELF_ONCE, JSON.stringify(c5a.byCurrency))
const c5b = collectTodayCost({ sessions: { list: () => { throw new Error('boom') } }, projections: { stateOf: () => { throw new Error('boom') } } }, priceDay, selfState)
a('C5b list()/stateOf() 抛异常 → 静默降级, 仍是自己一次', c5b.byCurrency.CNY === OK_SELF_ONCE, JSON.stringify(c5b.byCurrency))
const c5c = run([sess(SELF_ID, selfState), sess('no-state', undefined)])
a('C5c stateOf 返回 undefined 的会话被跳过(不产生 NaN)', Number.isFinite(c5c.byCurrency.CNY) && c5c.byCurrency.CNY === OK_SELF_ONCE, JSON.stringify(c5c.byCurrency))

fs.rmSync(home, { recursive: true, force: true })

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
