// v1.6.8 告警通道/判定的钉子。
//
// 真机背景（2026-09-29，维护者反馈「余额告警通知怎么没反应」）：
//   · 15:30 那条余额告警其实发出去了，但 App 正在前台 → 桥回 200 + FOREGROUND_SKIP（跳过），
//     旧实现只看 HTTP 200 → 记成 sent，面板显示「已送达」，用户屏幕上什么都没有。
//     排查时正是这个「假成功」把人往系统设置方向带偏。
//   · 跨档只提醒一次 → 错过那一条就彻底安静（维护者：「没反应」）。
//
// 这里钉三件事：
//   ① planAlert      —— 跨档立即提醒 / 同一个低档按间隔重复提醒 / 回到正常不再提醒
//   ② classifyBridgeReply —— 200 + FOREGROUND_SKIP 必须单独归类，绝不能算「已送达」
//   ③ clampAlertRepeatHours —— 间隔消毒(防脏值进状态文件、防 0/负值/NaN)
import { planAlert, classifyBridgeReply, clampAlertRepeatHours } from '../src/index.js'

let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const HOUR = 3600_000
const T0 = 1790667000000

// ===== ① planAlert =====
a('P1 正常档(ok)永不提醒', planAlert({ level: 'err', at: T0 }, 'ok', T0 + 99 * HOUR, 6 * HOUR) === null)
a('P2 首次见到低档(prev 为空)按跨档提醒 —— 冷启动重新上膛', planAlert(undefined, 'err', T0, 6 * HOUR) === 'cross')
a('P3 偏低 → 不足 是跨档, 立即提醒', planAlert({ level: 'warn', at: T0 }, 'err', T0 + 1000, 6 * HOUR) === 'cross')
a('P4 不足 → 偏低(仍是低档)也是跨档, 立即提醒', planAlert({ level: 'err', at: T0 }, 'warn', T0 + 1000, 6 * HOUR) === 'cross')
a('P5 间隔 0 = 关闭重复: 同一个低档不再提醒', planAlert({ level: 'err', at: T0 }, 'err', T0 + 100 * HOUR, 0) === null)
a('P6 冷却未到不提醒', planAlert({ level: 'err', at: T0 }, 'err', T0 + 5 * HOUR, 6 * HOUR) === null)
a('P7 冷却刚好到点就提醒', planAlert({ level: 'err', at: T0 }, 'err', T0 + 6 * HOUR, 6 * HOUR) === 'repeat')
a('P8 冷却早已过也提醒', planAlert({ level: 'err', at: T0 }, 'err', T0 + 30 * HOUR, 6 * HOUR) === 'repeat')
a('P9 有档位但没有时刻记录时宁可再提醒一次(不静默)',
  planAlert({ level: 'err' }, 'err', T0, 6 * HOUR) === 'repeat')
a('P10 脏 level 不崩也不提醒', planAlert({ level: 'err', at: T0 }, 'weird', T0 + 100 * HOUR, 6 * HOUR) === null)

// ===== ② classifyBridgeReply =====
// 真机抓到的两种 200 响应体就是下面前两条 —— 差别全在 body 里，只看 status 分不出来。
a('B1 200 + {"result":"OK"} = 已送达', classifyBridgeReply(200, '{"result":"OK"}') === 'delivered')
a('B2 200 + FOREGROUND_SKIP = 前台跳过(不是送达!)',
  classifyBridgeReply(200, '{"result":"FOREGROUND_SKIP"}') === 'foreground-skip')
a('B3 非 2xx 一律 failed', classifyBridgeReply(500, '{"result":"OK"}') === 'failed')
a('B4 200 但响应体认不出 = failed(宁可不报成功)', classifyBridgeReply(200, '{"result":"[ERR] 无障碍服务未开启"}') === 'failed')
a('B5 空响应体 = failed', classifyBridgeReply(200, '') === 'failed')
a('B6 body 不是字符串也不崩', classifyBridgeReply(200, undefined) === 'failed')

// ===== ③ clampAlertRepeatHours =====
a('H1 正常值原样通过', clampAlertRepeatHours(6) === 6)
a('H2 小数四舍五入', clampAlertRepeatHours(3.6) === 4)
a('H3 0 保留为 0(关闭)', clampAlertRepeatHours(0) === 0)
a('H4 负数 → 0', clampAlertRepeatHours(-3) === 0)
a('H5 NaN/字符串 → 0', clampAlertRepeatHours('abc') === 0 && clampAlertRepeatHours(Number.NaN) === 0)
a('H6 超上限夹到 168 小时(一周)', clampAlertRepeatHours(9999) === 168)
a('H7 undefined → 0(不猜默认值, 默认值由 Schema/runtimeConfig 给)', clampAlertRepeatHours(undefined) === 0)

// ===== ④ 源码级钉子: 客户端与服务端的字段/文案必须成对存在 =====
const fs = await import('node:fs')
const path = await import('node:path')
const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const cli = fs.readFileSync(path.join(ROOT, 'client/client.js'), 'utf8')
const srv = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8')

a('C1 客户端有「重复提醒间隔」输入框', cli.includes('t("settings.alertRepeat")') && cli.includes('className: "dshadb_field", type: "number", min: 0, max: 168'))
a('C2 客户端把 alertRepeatHours 一起保存(用规范化后的值)', /alertRepeatHours:\s*nextAlertRepeat/.test(cli) && /const nextAlertRepeat = settleNumber\(alertRepeat, 0, 168, 6\)/.test(cli))
a('C3 客户端有「发送测试提醒」按钮并打 /alerts/test', cli.includes('settings.alertTest') && cli.includes('"/api-dashboard/alerts/test"'))
a('C4 客户端有系统通知开关引导(含"提醒方式"这句)', cli.includes('settings.alertPermHint') && cli.includes('提醒方式'))
a('C5 面板如实分开展示 已送达/前台转内提示/失败', cli.includes('settings.alertDeliveryToast') && cli.includes('settings.alertStats'))
a('C6 中英字典都有新增的告警键', ['settings.alertPermHint', 'settings.alertRepeat', 'settings.alertRepeatHint', 'settings.alertTest', 'settings.alertStats', 'settings.alertDeliveryToast'].every(k => (cli.split('"' + k + '"').length - 1) >= 2))
a('C7 服务端有 /api-dashboard/alerts/test 路由', srv.includes("path: '/api-dashboard/alerts/test'"))
a('C8 服务端 alerts 响应含 skipped(不能混进 sent)', /skipped:\s*alertStatus\.skipped/.test(srv))
a('C9 服务端前台跳过改发 App 内提示', srv.includes('ALERT_BRIDGE_TOAST') && srv.includes("first.kind === 'foreground-skip'"))
a('C10 alertState 已登记进持久化形状消毒表', /OBJECT_FIELDS = \[[^\]]*'alertState'/.test(srv))
a('C11 alertRepeatHours 已登记进数字字段消毒表', /NUMBER_FIELDS[\s\S]{0,600}'alertRepeatHours'/.test(srv))
// v1.6.9: 「接口没打到」和「投递失败」必须分开报 —— 前者是插件文件已更新、dsh 还没重启
// （服务端仍是旧版本, 那个路由根本不存在）, 后者才是通知发不出去要去查系统权限。
a('C12 客户端区分「没打到接口」与「投递失败」', cli.includes('settings.alertTestStale') && /if \(!d\) setAlertTest\("stale"\)/.test(cli) && /r\.status === 404 \? "stale"/.test(cli))
a('C13 stale 文案中英成对', (cli.split('"settings.alertTestStale"').length - 1) >= 2)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
