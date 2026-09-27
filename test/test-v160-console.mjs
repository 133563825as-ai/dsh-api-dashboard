// v1.6.0: 「去充值」—— 平台开放平台入口。
//
// 两件事各自钉住:
//   ① 客户端怎么"开": 手机 DSHA 的 GUI 在 webview 里, window.open 开不出系统浏览器 ——
//      必须先请服务端用 App 桥 /app/open 开, 桥不在(桌面/浏览器)才自己开。
//      这里把 openConsole **抠出来实跑**三个分支, 不是正则匹配。
//   ② 服务端给哪些地址: consoleUrl 必须 https、必须属于该平台自己的域名(防串台)、
//      证据等级必须写在行尾注释里(已核实 / 未核实 / 仅首页) —— 拿不到就留空, 不许联想路径。
//
// 同类插件对照(2026-09-27 调研): dsh-balance-monitor / dsh-llm-balance / dsh-quota
// **全都没有**任何手机 webview 处理, 一律裸 window.open —— 所以 ① 这条是本插件特有的回归点。
const fs = await import('node:fs')
const path = await import('node:path')
let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const src = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8')
const cli = fs.readFileSync(path.join(ROOT, 'client/client.js'), 'utf8')

/** 按大括号配平抠函数声明(支持 async)。 */
const grab = (name) => {
  const start = Math.max(
    cli.indexOf('    function ' + name + '('),
    cli.indexOf('    async function ' + name + '('))
  if (start < 0) throw new Error('client.js 里找不到函数 ' + name)
  let i = cli.indexOf('{', start), depth = 0, end = -1
  for (; i < cli.length; i++) {
    if (cli[i] === '{') depth++
    else if (cli[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  if (end < 0) throw new Error(name + ' 大括号不配平')
  return cli.slice(start, end)
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const OC = await new AsyncFunction([grab('openConsole'), 'return { openConsole }'].join('\n'))()

/** 假 window: 只记 open 调用。 */
const mkWin = () => ({ calls: [], open(u, t, f) { this.calls.push([u, t, f]) } })
const jsonOnce = (body) => async () => ({ json: async () => body })

// ===== ① 三种打开分支 =====
{
  // 手机: 服务端用 App 桥开成功 → 客户端**不该**再自己开一次(否则会开两个浏览器)
  const w = mkWin()
  const r = await OC.openConsole(jsonOnce({ ok: true, via: 'app-bridge', url: 'https://platform.deepseek.com/top_up' }),
    'deepseek', 'https://fallback.example/', w)
  a('#1 桥开成功 → via=app-bridge 且客户端不自己 open', r === 'app-bridge' && w.calls.length === 0, JSON.stringify(w.calls))
}
{
  // 桌面/浏览器: 服务端没桥 → 回 via=browser + 白名单地址, 客户端用 window.open
  const w = mkWin()
  const r = await OC.openConsole(jsonOnce({ ok: false, via: 'browser', url: 'https://platform.deepseek.com/top_up' }),
    'deepseek', 'https://fallback.example/', w)
  a('#1 无桥 → 客户端自己 open 服务端给的地址',
    r === 'browser' && w.calls.length === 1 && w.calls[0][0] === 'https://platform.deepseek.com/top_up')
  a('#1 新窗口必须带 noopener,noreferrer', w.calls[0][2] === 'noopener,noreferrer')
}
{
  // 老服务端没有 /open 端点(fetch 抛错) → 用快照里的地址兜底
  const w = mkWin()
  const boom = async () => { throw new Error('404') }
  const r = await OC.openConsole(boom, 'deepseek', 'https://fallback.example/', w)
  a('#1 老服务端(端点不存在) → 用快照地址兜底', r === 'browser-fallback' && w.calls[0][0] === 'https://fallback.example/')
}
{
  // 服务端明确说"这个平台没有可靠地址" → 什么都不开, 别乱跳
  const w = mkWin()
  const r = await OC.openConsole(jsonOnce({ ok: false, via: 'none', error: 'no-console-url' }), 'xai', '', w)
  a('#1 服务端说没有地址且无兜底 → 不开任何窗口', r === 'none' && w.calls.length === 0)
}
{
  // 没有 window(非浏览器环境) 也不能抛
  const r = await OC.openConsole(jsonOnce({ ok: false, via: 'browser', url: 'https://x.example/' }), 'deepseek', '', null)
  a('#1 没有 window 时不抛异常', r === 'browser')
}
a('#1 只认平台键: 客户端请求体里不带 url', !/JSON\.stringify\(\{ url/.test(cli) && /JSON\.stringify\(\{ platform: platform \}\)/.test(cli))
a('#1 详情页有「去充值」按钮且仅在服务端给了地址时渲染',
  /b\.consoleUrl \? react\.createElement\("button"/.test(cli) && /t\("detail\.recharge"\)/.test(cli))
a('#1 中英文都有 recharge 文案', /"detail\.recharge": "去充值 ↗"/.test(cli) && /"detail\.recharge": "Recharge ↗"/.test(cli))

// ===== ② 地址表 =====
const pairs = [...src.matchAll(/\{ id: '([a-z]+)',[\s\S]{0,700}?consoleUrl: '([^']+)'([^\n]*)/g)]
  .map(m => ({ id: m[1], url: m[2], tail: m[3] }))
a('#2 至少 14 个平台有充值入口', pairs.length >= 14, 'got ' + pairs.length)

// 域名归属: 防串台(把 A 平台的地址挂到 B 平台上)
const HOST_OK = {
  deepseek: /(^|\.)deepseek\.com$/, zhipu: /(^|\.)bigmodel\.cn$/,
  moonshot: /(^|\.)kimi\.com$/, stepfun: /(^|\.)stepfun\.com$/,
  siliconflow: /(^|\.)siliconflow\.cn$/, minimax: /(^|\.)minimaxi\.com$/,
  openrouter: /(^|\.)openrouter\.ai$/, novita: /(^|\.)novita\.ai$/,
  xai: /(^|\.)x\.ai$/, openai: /(^|\.)openai\.com$/, claude: /(^|\.)claude\.com$/,
  gemini: /(^|\.)google\.com$/, qwen: /(^|\.)aliyun\.com$/,
  mimo: /(^|\.)xiaomimimo\.com$/, doubao: /(^|\.)volcengine\.com$/, hunyuan: /(^|\.)tencent\.com$/,
}
for (const { id, url } of pairs) {
  let host = ''
  try { host = new URL(url).host } catch { /* 下面判定会兜住 */ }
  a('#2 ' + id + ' 的地址是 https', url.startsWith('https://'), url)
  a('#2 ' + id + ' 的域名属于它自己(' + host + ')', !!(HOST_OK[id] && HOST_OK[id].test(host)), url)
}

// 证据等级必须写清, 三种之一 —— 这条是"不许造假"的可执行版本:
// 拿不到官方证据就得在注释里承认, 而不是混在一堆已核实里冒充。
for (const p of pairs) {
  const m = src.slice(src.indexOf(p.url)).match(/^\d*[^\n]*\/\/\s*(已核实|未核实|仅首页)/)
  a('#2 ' + p.id + ' 标了证据等级', !!m, JSON.stringify(p.tail.slice(0, 40)))
}

// 没有证据的平台必须留白或只给首页 —— 不许出现"猜的充值路径"
const stepfunLine = (src.match(/id: 'stepfun'[\s\S]{0,400}?consoleUrl: '([^']+)'/) || [])[1] || ''
a('#2 stepfun 只给首页(它的 /finance /account 全是 404, 不编路径)',
  stepfunLine === 'https://platform.stepfun.com/', stepfunLine)
const geminiLine = (src.match(/id: 'gemini'[\s\S]{0,400}?consoleUrl: '([^']+)'/) || [])[1] || ''
a('#2 gemini 只给一级域名首页', geminiLine === 'https://aistudio.google.com/', geminiLine)

// 服务端下发: 客户端得拿得到
a('#2 /platforms 下发 consoleUrl', /consoleUrl: p\.consoleUrl \|\| ''/.test(src))
a('#2 balances 里逐平台挂 consoleUrl(客户端卡片直接读)', /b\.consoleUrl = u/.test(src))
a('#2 挂 consoleUrl 的那段只从预设表取地址, 不吃客户端输入',
  /const consoleUrlOf = new Map\(PLATFORM_PRESETS/.test(src))

// 没地址的平台不挂字段 → 卡片自然不显示按钮
a('#2 空 consoleUrl 不挂到 balance 上(避免渲染一个点了 404 的按钮)',
  !/b\.consoleUrl = u \|\| ''/.test(src) && /if \(u\) b\.consoleUrl = u/.test(src))

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail > 0) process.exitCode = 1
