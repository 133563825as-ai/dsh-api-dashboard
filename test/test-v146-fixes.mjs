// v1.4.6: issue #2 三个问题的回归钉子。
// issue: https://github.com/133563825as-ai/dsh-api-dashboard/issues/2  (Qinruiy, 2026-09-17)
//   ① 低于预警线显示「异常」措辞易误解
//   ② 同屏口径不一致(标题数服务端 status / 卡片按阈值分级)
//   ③ 余额告警在 DSH >= 0.1.5 上永远弹不出来(两条通知通道都不存在)
//
// 按 test-v141-fixes 的规矩: 能钉**行为**的就别钉源码字符串 ——
// ①里的分级逻辑是从 client/client.js 把 getLevel / statusLabel / statusTextFor
// **抠出来实跑**的, 不是正则匹配。
const fs = await import('node:fs')
const path = await import('node:path')
let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const src = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8')
const cli = fs.readFileSync(path.join(ROOT, 'client/client.js'), 'utf8')

/** 从 client.js 抠一个函数声明(按大括号配平), 只为在测试里实跑其逻辑。 */
const grab = (name) => {
  const start = cli.indexOf('    function ' + name + '(')
  if (start < 0) throw new Error('client.js 里找不到函数 ' + name)
  let i = cli.indexOf('{', start), depth = 0, end = -1
  for (; i < cli.length; i++) {
    if (cli[i] === '{') depth++
    else if (cli[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
  }
  if (end < 0) throw new Error(name + ' 大括号不配平')
  return cli.slice(start, end)
}
const F = new Function([
  grab('getLevel'), grab('statusLabel'), grab('statusTextFor'),
  'return { getLevel, statusLabel, statusTextFor }',
].join('\n'))()
const T = (k) => k   // 假 t(): 直接回 key, 便于断言
const cfg = { safeThreshold: 50, warnThreshold: 10 }
const lvl = (b) => F.getLevel(b, cfg)
const txt = (b) => F.statusTextFor(b, lvl(b), T)

// ===== ① 措辞分档 =====
// 维护者复现场景: DeepSeek ¥4.64 + 默认 safe=50/warn=10 —— 接口是好的, 只是余额低于预警线
const lowBalance = { status: 'ok', total: 4.64, currency: 'CNY' }
a('#2-1 低于预警线(¥4.64/阈 50,10) → 红灯, 但文案是「不足」', lvl(lowBalance) === 'err' && txt(lowBalance) === 'status.insufficient')
a('#2-1 百分比型同样分档(剩 5% < warn)',
  txt({ status: 'ok', percent: 5, currency: '%' }) === 'status.insufficient')
a('#2-1 余额 ≤ 0 仍是「异常」(耗尽不是"不足")',
  txt({ status: 'ok', total: 0, currency: 'CNY' }) === 'status.err' &&
  txt({ status: 'ok', total: -3, currency: 'CNY' }) === 'status.err')
a('#2-1 接口失败仍是「异常」(不因分档而软化)',
  txt({ status: 'error', error: 'HTTP 500' }) === 'status.err' &&
  txt({ status: 'auth-error' }) === 'status.err' &&
  txt({ status: 'parse-error' }) === 'status.err')
a('#2-1 正常 / 偏低两档不受影响',
  txt({ status: 'ok', total: 100, currency: 'CNY' }) === 'status.ok' &&
  txt({ status: 'ok', total: 20, currency: 'CNY' }) === 'status.warn')
a('#2-1 卡片/详情全部改走 statusTextFor(不再有裸 statusLabel 调用)',
  !/descText = statusLabel\(level, t\)/.test(cli) &&
  /descText = statusTextFor\(b, level, t\)/.test(cli) &&
  /className: "dshadb_detail_name_sub", key: "sub" \}, statusTextFor\(b, level, t\)/.test(cli))
a('#2-1 中英文都有 insufficient 文案', /"status\.insufficient": "不足"/.test(cli) && /"status\.insufficient": "Insufficient"/.test(cli))

// ===== ② 同屏口径 =====
a('#2-2 标题计数改用阈值分级(与卡片同源)', /const okCount = countByLevel\("ok"\)/.test(cli))
a('#2-2 不再按服务端 status 数「正常」', !/const okCount = balances\.filter\(b => b\.status === "ok"\)/.test(cli))
a('#2-2 标题补「需关注」汇总', /const attentionCount = countByLevel\("err"\)/.test(cli) && /all\.attention/.test(cli))
a('#2-2 中英文都有 all.attention 文案', /"all\.attention": "\{n\} 需关注"/.test(cli) && /"all\.attention": "\{n\} need attention"/.test(cli))

// ===== ③ 告警通道 =====
a('#2-3 不再调用不存在的 ctx.notify', !/typeof ctx\.notify === 'function'/.test(src))
a('#2-3 不再调用不存在的 webServer.notify', !/ctx\.get\('webServer'\)\?\.notify/.test(src))
// v1.6.8: 桥调用收敛到通用 bridgeCall; 且**前台跳过(FOREGROUND_SKIP)要改发 App 内提示**。
// 真机(2026-09-29, 维护者反馈「余额告警没反应」): App 在前台时 /app/notify 回 200 +
// FOREGROUND_SKIP(桥主动跳过), 旧实现只看 res.ok → 记成 sent, 面板显示"已送达"而屏幕上什么都没有。
a('#2-3 改走 DSHA App 桥(127.0.0.1:3090/app/notify)',
  /const ALERT_BRIDGE_URL = 'http:\/\/127\.0\.0\.1:3090\/app\/notify'/.test(src) && /async function bridgeCall\(/.test(src))
a('#2-3 前台被桥跳过(FOREGROUND_SKIP)时改发 App 内提示',
  /const ALERT_BRIDGE_TOAST = 'http:\/\/127\.0\.0\.1:3090\/app\/toast'/.test(src) && /if \(first\.kind === 'foreground-skip'\)/.test(src))
a('#2-3 桥响应体按分类函数判定, 不能只看 HTTP 200',
  /export const classifyBridgeReply = \(status, body\) => \{/.test(src) && /includes\('FOREGROUND_SKIP'\)/.test(src))
a('#2-3 投递结果如实分三档计数(进通知栏 / 前台转内提示 / 失败)',
  /alertStatus\.sent\+\+/.test(src) && /alertStatus\.skipped\+\+/.test(src) && /alertStatus\.failed\+\+/.test(src))
a('#2-3 桥 token 从 $DSH_HOME/.bridge_token 读(不再硬编码 /root)',
  /process\.env\.DSH_HOME \|\| join\(homedir\(\), '\.dsh'\)/.test(src) && /\.bridge_token/.test(src))
a('#2-3 桥调用带超时, 不拖住余额轮询', /AbortSignal\.timeout\(\d+\)/.test(src))
a('#2-3 拿不到通道时记状态(可见降级), 不静默吞掉',
  /alertStatus\.channel = 'none'/.test(src) && /alertStatus\.failed\+\+/.test(src))
a('#2-3 /api-dashboard/alerts 暴露通道状态与最近一条告警',
  /path: '\/api-dashboard\/alerts'/.test(src) && /channel: alertStatus\.channel/.test(src) && /last: alertStatus\.last/.test(src))
a('#2-3 告警状态端点同样过鉴权闸门', /path: '\/api-dashboard\/alerts',[\s\S]{0,220}?if \(!allowRequest\(req, res\)\) return/.test(src))
// v1.6.8: 告警策略从「只在跨档发一次」升级为「跨档立即发 + 停在低档时按间隔重复」。
// 旧判定 `if (level === prev || level === 'ok') continue` 已随之下线 —— 真机反馈
// 「错过那一条就彻底安静了」。判定收敛到纯函数 planAlert（test-alert-plan.mjs 另有 10 条行为断言），
// 这里只钉"契约没变味": 回到正常不提醒 / 跨档立即提醒 / 低档按间隔重复 / 间隔 0 = 关闭重复。
a('#2-3 告警判定收敛到纯函数 planAlert(跨档立即提醒 + 低档按间隔重复)',
  /export const planAlert = \(prev, level, now, repeatMs\) => \{/.test(src) &&
  /if \(level !== 'warn' && level !== 'err'\) return null/.test(src) &&
  /if \(prevLevel !== level\) return 'cross'/.test(src) &&
  /return now - at >= repeatMs \? 'repeat' : null/.test(src))
a('#2-3 旧的「只发一次」判定已下线(改由 planAlert 决定)', !/if \(level === prev \|\| level === 'ok'\) continue/.test(src))
a('#2-3 告警状态跟着状态文件走(重启不再把所有低余额重新轰炸一遍)',
  /lastAlertState = \(persisted\.alertState/.test(src) && /saveAlertState\(newState\)/.test(src))
a('#2-3 重复提醒间隔可配(0 = 关闭)且进消毒表',
  /alertRepeatHours = clampAlertRepeatHours\(body\.alertRepeatHours\)/.test(src) && /'alertRepeatHours', 0, ALERT_REPEAT_MAX_HOURS/.test(src))
a('#2-3 设置面板有「发送测试提醒」端点',
  /path: '\/api-dashboard\/alerts\/test'/.test(src) && /async handler\(req, res\) \{\n\s+if \(!allowRequest\(req, res\)\) return/.test(src))

// ===== ③b 可见降级必须真的落到界面上 (v1.5.1) =====
// 端点存在 ≠ 用户看得见。v1.5.0 只注册了 /api-dashboard/alerts, 客户端一次都没引用 ——
// 于是一个"能查到通道状态"的接口, 在用户眼里等同于没有。这里钉住界面那一格。
const A = new Function([grab('alertChannelState'), 'return { alertChannelState }'].join('\n'))()
a('#2-3 UI: 还没拉到/拉取失败 → checking, 不误报「通知不可用」',
  A.alertChannelState(null) === 'checking' && A.alertChannelState(undefined) === 'checking')
a('#2-3 UI: 桥可用 → bridge', A.alertChannelState({ channel: 'app-bridge' }) === 'bridge')
a('#2-3 UI: 桥不可用 → none', A.alertChannelState({ channel: 'none' }) === 'none')
a('#2-3 UI: 服务端初始的 unknown → idle(尚未触发过告警, 不等于坏了)',
  A.alertChannelState({ channel: 'unknown' }) === 'idle' && A.alertChannelState({}) === 'idle')
a('#2-3 UI: 客户端真的去拉 /api-dashboard/alerts 了', /fetchT\("\/api-dashboard\/alerts"/.test(cli))
a('#2-3 UI: 设置面板真的渲染了这一行', /t\("settings\.alertChannel"\)/.test(cli) && /ALERT_SUB_KEY\[alertState\]/.test(cli))
a('#2-3 UI: 四档文案中英文齐全',
  ['alertChannelChecking', 'alertChannelBridge', 'alertChannelNone', 'alertChannelIdle']
    .every(k => (cli.match(new RegExp('"settings\\.' + k + '":', 'g')) || []).length === 2))
a('#2-3 UI: 不可用时是红点、桥可用是绿点',
  /none: " dshadb_bar_dot_err"/.test(cli) && /bridge: " dshadb_bar_dot_ok"/.test(cli))
a('#2-3 UI: 拉取失败不写进 alertInfo(保持 null → checking)',
  /if \(d && d\.ok\) setAlertInfo\(d\)/.test(cli))

// v1.5.1: 光有 channel 字段还不够 —— 旧行为要**真发过一次告警**才知道通道有没有,
// 在那之前恒为 'unknown', 面板只能说"待首次告警确认"。改成懒探测: 面板一问就有结论。
const pStart = src.indexOf('async function probeAlertChannel')
const pBody = pStart < 0 ? '' : src.slice(pStart, src.indexOf('\n}', pStart))
a('#2-3 通道可主动探测, 用只读的 /app/version',
  /const ALERT_BRIDGE_PROBE = 'http:\/\/127\.0\.0\.1:3090\/app\/version'/.test(src) && pBody.length > 0)
a('#2-3 探测不拿 /app/notify 去试通知(那会在用户手机上真弹一条)', !/ALERT_BRIDGE_URL/.test(pBody))
a('#2-3 探测不污染 sent/failed(那是告警统计, 探测不是告警)', pBody.length > 0 && !/alertStatus\.(sent|failed)/.test(pBody))
a('#2-3 探测有超时兜底', /AbortSignal\.timeout\(\d+\)/.test(pBody))
a('#2-3 /alerts 端点第一次被问到时懒探测', /await probeAlertChannel\(\)/.test(src))
a('#2-3 已发过告警时探测不覆盖真实结果', /alertStatus\.channel !== 'unknown'/.test(src))
a('#2-3 探测只做一次(失败不重试, 别拿面板开启时机做重试循环)',
  /let alertChannelProbed = false/.test(src) && /if \(alertChannelProbed \|\|/.test(src))

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
// v1.3.2: 断言失败时以非 0 退出, 否则 CI 拦不住回归
if (fail > 0) process.exitCode = 1
