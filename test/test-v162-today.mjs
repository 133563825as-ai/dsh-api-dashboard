// v1.6.2: 「今日花销」—— 投影的**日桶**折叠 + 跨会话汇总。
//
// 为什么要有这个: 挂件要弹的是「老大，今天花销已经超过 ¥# 啦」, 而投影原本只折叠**本会话**,
// 也**没有任何按日期切分的数据**。所以这条链路是新增的: 事件 → byDay 日桶 → summarizeDay → view.todayByCurrency。
//
// 两个最容易错的点, 各钉一条:
//   ① **回退**: 重试用 llm/retry-started 关闭替换槽位, 日桶必须跟着回退, 否则同一笔算两次;
//   ② **归日**用北京时间(与峰谷同一套口径), 否则跨日界那 8 小时会和峰谷对不上。
const fs = await import('node:fs')
const os = await import('node:os')
const path = await import('node:path')

// ⚠️ 必须先把 DSH_HOME 指到临时目录: view() 会去读 projcache 缓存目录做跨会话汇总,
//    不隔离的话同一份断言会读到**运行机器上别人的会话数据**(AGENTS 铁律 8: 测试不许读私有文件)。
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dshadb-today-'))
process.env.DSH_HOME = TMP_HOME

const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const CFG = { currency: 'CNY', overseasCurrency: 'USD' }
const hdr = (model) => ({ type: 'request/header', data: { header: { config: { model } } } })
const msg = (turn, step, usage) => ({ type: 'assistant/message', data: { turn, step, message: {}, stream: [], usage } })
const retry = (turn, step) => ({ type: 'llm/retry-started', data: { retryId: 'r1', turn, step, retry: 1 } })
const at = (ev, time) => ({ ...ev, time })

const run = (events) => {
  const proj = m.makeCostProjection(() => CFG)
  let st = proj.init()
  for (const ev of events) st = proj.apply(st, ev)
  return { state: st, view: proj.wire.view(st) }
}

const flatOf = (st, day, model) => st?.byDay?.[day]?.[model]?.flat
const dayOf = (st, day) => st?.byDay?.[day] ?? null

// 北京时间 11:00 = UTC 03:00(峰) / 13:00 = UTC 05:00(谷); 2026-09-22 是周二, 不落周末。
const D21 = Date.UTC(2026, 8, 21, 3, 0, 0)   // 北京 2026-09-21 11:00
const D22 = Date.UTC(2026, 8, 22, 3, 0, 0)   // 北京 2026-09-22 11:00
const D22_OFF = Date.UTC(2026, 8, 22, 5, 0, 0) // 北京 2026-09-22 13:00

// ===== ① 按日分桶 =====
{
  const { state } = run([
    at(hdr('glm-5.3'), D21), at(msg(1, 1, { inputTokens: 100 }), D21),
    at(msg(2, 1, { inputTokens: 200 }), D22),
  ])
  a('#1 两个日期各自成桶', dayOf(state, '2026-09-21') !== null && dayOf(state, '2026-09-22') !== null)
  a('#1 两天的用量不串味',
    flatOf(state, '2026-09-21', 'glm-5.3')?.uncachedInputTokens === 100 &&
    flatOf(state, '2026-09-22', 'glm-5.3')?.uncachedInputTokens === 200,
    JSON.stringify(state.byDay))
  a('#1 不走峰谷表的模型落在 flat 槽(它本来就没有相)',
    flatOf(state, '2026-09-21', 'glm-5.3') !== undefined &&
    (state.byDay['2026-09-21']['glm-5.3'].peak === undefined))
}
// ===== ② 归日按北京时间(跨日界) =====
{
  // UTC 2026-09-22 17:30 → 北京 2026-09-23 01:30。按 UTC 归日会错到 09-22 去。
  const late = Date.UTC(2026, 8, 22, 17, 30, 0)
  const { state } = run([at(hdr('glm-5.3'), late), at(msg(1, 1, { inputTokens: 50 }), late)])
  a('#2 跨日界按北京时间归日 (UTC 09-22 17:30 → 北京 09-23)',
    flatOf(state, '2026-09-23', 'glm-5.3')?.uncachedInputTokens === 50 && dayOf(state, '2026-09-22') === null,
    JSON.stringify(Object.keys(state.byDay)))
}
// ===== ③ 峰谷模型在日桶里也分相 =====
{
  const { state } = run([
    at(hdr('deepseek-flash'), D22),
    at(msg(1, 1, { outputTokens: 1_000_000 }), D22),
    at(msg(2, 1, { outputTokens: 1_000_000 }), D22_OFF),
  ])
  const slots = state.byDay['2026-09-22']?.['deepseek-flash'] ?? {}
  a('#3 峰/谷各自成槽(不是全塞 flat)',
    slots.peak?.outputTokens === 1_000_000 && slots.offPeak?.outputTokens === 1_000_000 && slots.flat === undefined,
    JSON.stringify(slots))
}
// ===== ④ 🔴 替换槽位时, 日桶也要回退 =====
{
  // 同一 turn/step 重复上报 = 替换语义 → 只算一次
  const { state } = run([
    at(hdr('glm-5.3'), D21),
    at(msg(1, 1, { inputTokens: 1000 }), D21),
    at(msg(1, 1, { inputTokens: 1000 }), D21),
  ])
  a('#4 替换槽位时日桶回退 (同 turn/step 重复上报只算一次)',
    flatOf(state, '2026-09-21', 'glm-5.3')?.uncachedInputTokens === 1000,
    JSON.stringify(flatOf(state, '2026-09-21', 'glm-5.3')))
}
{
  // retry-started 关闭槽位 → 下一次是**新增**, 两次都要留下
  const { state } = run([
    at(hdr('glm-5.3'), D21),
    at(msg(1, 1, { inputTokens: 1000 }), D21),
    at(retry(1, 1), D21),
    at(msg(1, 1, { inputTokens: 1000 }), D21),
  ])
  a('#4 重试后是累加 (2000, 不被替换掉一次)',
    flatOf(state, '2026-09-21', 'glm-5.3')?.uncachedInputTokens === 2000,
    JSON.stringify(flatOf(state, '2026-09-21', 'glm-5.3')))
}
{
  // 跨日替换: 槽位属于昨天、新事件在今天 —— 回退必须退到**昨天那个桶**
  const { state } = run([
    at(hdr('glm-5.3'), D21), at(msg(1, 1, { inputTokens: 1000 }), D21),
    at(msg(1, 1, { inputTokens: 700 }), D22),
  ])
  a('#4 跨日替换回到"事件当时那一天"的桶, 不污染今天',
    flatOf(state, '2026-09-21', 'glm-5.3')?.uncachedInputTokens === 0 &&
    flatOf(state, '2026-09-22', 'glm-5.3')?.uncachedInputTokens === 700,
    JSON.stringify(state.byDay))
}
// ===== ⑤ 今日计价 (与主板同一套口径) =====
{
  const { view } = run([hdr('glm-5.3'), msg(1, 1, { inputTokens: 1_000_000 })])
  a('#5 今日花销: 1M glm-5.3 输入 = ¥8 (原生币种, 不 ×7)',
    Math.abs((view.todayByCurrency?.CNY ?? 0) - 8) < 1e-9,
    JSON.stringify(view.todayByCurrency))
  a('#5 view 带上归属日', view.todayDay === new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10), String(view.todayDay))
}
{
  const { view } = run([hdr('gpt-5.6-sol'), msg(1, 1, { inputTokens: 1_000_000 })])
  a('#5 海外模型今日花销单独走 USD 分组(不做汇率折算合并)',
    (view.todayByCurrency?.USD ?? 0) > 0 && (view.todayByCurrency?.CNY ?? 0) === 0,
    JSON.stringify(view.todayByCurrency))
}
{
  const { view } = run([hdr('deepseek-flash'), msg(1, 1, { outputTokens: 1_000_000 })])
  a('#5 峰谷模型今日花销按当下相计价(能算出数就行, 相由时刻决定)',
    (view.todayByCurrency?.CNY ?? 0) > 0, JSON.stringify(view.todayByCurrency))
}
// ===== ⑥ 冷启动/空环境不能炸 =====
{
  const { view } = run([])
  a('#6 没有事件时 waiting=true 且今日花销不为 undefined', view.waiting === true && view.todayByCurrency !== undefined)
}
a('#6 缓存目录不存在时今日花销退化成空对象(不抛)',
  (() => { try { const { view } = run([hdr('glm-5.3'), msg(1, 1, { inputTokens: 1 })]);
    return typeof view.todayByCurrency === 'object' } catch { return false } })())
// ===== ⑦ 版本 =====
a('#7 stateVersion 升到 5 (byDay 是新状态字段, 老状态必须重放)',
  m.makeCostProjection(() => CFG).stateVersion === 5,
  String(m.makeCostProjection(() => CFG).stateVersion))


// ===== ⑧ 超限提醒的接线 (客户端 + 配置项) =====
const cli = fs.readFileSync(path.join(new URL('..', import.meta.url).pathname, 'client/client.js'), 'utf8')
const src = fs.readFileSync(new URL('../src/index.js', import.meta.url).pathname, 'utf8')

a('#8 挂件暴露 warn(能主动弹指定台词, 不是只能随机)',
  /warn: function \(lines\) \{/.test(cli) && /renderLines\(lines \|\| whalePickLines\(st\)\)/.test(cli))
a('#8 提醒文案就是维护者要的那三行',
  /老大，今天花销/.test(cli) && /已经超过 " \+ money \+ " 啦/.test(cli) && /再花要变成穷光蛋啦/.test(cli))
a('#8 同一天只弹一次(存 localStorage —— 切前台重载 webview 后内存变量挡不住)',
  /localStorage\.getItem\(WHALE_WARN_KEY\)/.test(cli) && /localStorage\.setItem\(WHALE_WARN_KEY, day\)/.test(cli))
a('#8 🔴 挂件没就绪时不打"今天已提示"的戳记(否则永远弹不出来)',
  /if \(!whaleWidget \|\| typeof whaleWidget\.warn !== "function"\) return;/.test(cli) &&
  cli.indexOf('typeof whaleWidget.warn') < cli.indexOf('localStorage.setItem(WHALE_WARN_KEY'))
a('#8 阈值默认关闭(0), 不打扰存量用户', /dailyLimit: 0/.test(cli) && /n > 0 \? n : 0/.test(src))
a('#8 远端只支持数字阈值, 脏值(负数/NaN)一律当关闭',
  /Number\.isFinite\(body\.dailyLimit\) && body\.dailyLimit >= 0/.test(src))
a('#8 新持久化字段登记进了消毒白名单(AGENTS 要求)',
  /\['dailyLimit', 0, Number\.MAX_SAFE_INTEGER\]/.test(src))
a('#8 配置项在 schema / runtimeConfig / 三处下发 / POST 都在',
  (src.match(/dailyLimit/g) || []).length >= 6)
a('#8 设置面板有输入框且中英文案齐全',
  /t\("settings\.dailyLimit"\)/.test(cli) && /t\("settings\.dailyLimitHint"\)/.test(cli) &&
  (cli.match(/"settings\.dailyLimit":/g) || []).length === 2)
a('#8 挂件同步依赖用 JSON 串(投影 view 每次刷新都是新引用)',
  /const todayKey = \(cost && cost\.todayByCurrency\) \? JSON\.stringify\(cost\.todayByCurrency\) : ""/.test(cli))


// ===== ⑨ 今日总结: token 总量 + 逐模型 (模型占比的数据源) =====
{
  const { view } = run([hdr('glm-5.3'), msg(1, 1, { inputTokens: 1000, cacheReadTokens: 200, outputTokens: 50 })])
  a('#9 今日 token 按四类分桶',
    view.todayTokens?.uncachedInput === 1000 && view.todayTokens?.cacheRead === 200 && view.todayTokens?.output === 50,
    JSON.stringify(view.todayTokens))
  a('#9 逐模型今日用量 + 币种(占比按 token, 不按金额)',
    view.todayByModel?.['glm-5.3']?.tokens === 1250 && view.todayByModel?.['glm-5.3']?.currency === 'CNY',
    JSON.stringify(view.todayByModel))
}
// ===== ⑩ 🔴 峰谷标记只能给走峰谷表的模型 =====
// 维护者实测反馈: glm/claude 这类没有峰谷价的面板, 状态条上也挂了 ☀️/🌙。
// 旧判定只看了全局的 config.isPeak(恒真的时段布尔), 没看当前模型本身。
{
  const g = run([hdr('glm-5.3'), msg(1, 1, { inputTokens: 10 })])
  const d = run([hdr('deepseek-flash'), msg(1, 1, { inputTokens: 10 })])
  const c = run([hdr('claude-opus-5'), msg(1, 1, { inputTokens: 10 })])
  a('#10 非峰谷模型 peakValley=false (glm / claude)',
    g.view.peakValley === false && c.view.peakValley === false)
  a('#10 峰谷模型 peakValley=true (deepseek)', d.view.peakValley === true)
  a('#10 状态条按 peakValley 决定显示, 不再只看 config.isPeak',
    /hasPeakInfo = typeof config\?\.isPeak === "boolean" && peakValley === true/.test(cli))
}
// ===== ⑪ 法定节假日全天算谷时 (维护者问的) =====
{
  a('#11 2026 国庆/春节等在表内', m.isCnHoliday('2026-10-01') === true && m.isCnHoliday('2026-02-17') === true)
  a('#11 普通工作日不在表内', m.isCnHoliday('2026-09-22') === false)
  // 节假日当天的北京 11:00 本来是峰时, 必须被判成谷时
  const holidayNoon = Date.UTC(2026, 9, 1, 3, 0, 0)   // 北京 2026-10-01 11:00
  a('#11 节假日 11:00 判为谷时', m.isPeakTime(holidayNoon) === false)
  const workNoon = Date.UTC(2026, 8, 22, 3, 0, 0)     // 北京 2026-09-22 11:00 (普通工作日)
  a('#11 普通工作日同一时刻仍是峰时(防误伤)', m.isPeakTime(workNoon) === true)
  a('#11 节假日全天计谷时确实接在峰谷判定里', /if \(isCnHoliday\(ymd\)\) return false/.test(src))
}
// ===== ⑫ 去 UI emoji (☀️/🌙 按维护者要求保留) =====
a('#12 状态条/抽屉里的 emoji 已清(💰📊💡 与「✓」)',
  !/"💰"/.test(cli) && !/"📊"/.test(cli) && !/"💡/.test(cli) && !/已是最新版本 ✓/.test(cli))
a('#12 通知标题不再带 emoji', !/`🔔 \$/.test(src) && !/`🚨 \$/.test(src))
a('#12 峰谷的 ☀️/🌙 保留(维护者明确要求不动)', /"peak.now": "梁文峰 ☀️ 峰时计费"/.test(cli) && /"valley.now": "梁文谷 🌙 谷时 5 折"/.test(cli))

fs.rmSync(TMP_HOME, { recursive: true, force: true })
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail > 0) process.exitCode = 1
