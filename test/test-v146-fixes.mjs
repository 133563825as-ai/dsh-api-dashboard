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
a('#2-3 改走 DSHA App 桥(127.0.0.1:3090/app/notify)',
  /const ALERT_BRIDGE_URL = 'http:\/\/127\.0\.0\.1:3090\/app\/notify'/.test(src) && /function notifyViaAppBridge/.test(src))
a('#2-3 桥 token 从 $DSH_HOME/.bridge_token 读(不再硬编码 /root)',
  /process\.env\.DSH_HOME \|\| join\(homedir\(\), '\.dsh'\)/.test(src) && /\.bridge_token/.test(src))
a('#2-3 桥调用带超时, 不拖住余额轮询', /AbortSignal\.timeout\(\d+\)/.test(src))
a('#2-3 拿不到通道时记状态(可见降级), 不静默吞掉',
  /alertStatus\.channel = 'none'/.test(src) && /alertStatus\.failed\+\+/.test(src))
a('#2-3 /api-dashboard/alerts 暴露通道状态与最近一条告警',
  /path: '\/api-dashboard\/alerts'/.test(src) && /channel: alertStatus\.channel/.test(src) && /last: alertStatus\.last/.test(src))
a('#2-3 告警状态端点同样过鉴权闸门', /path: '\/api-dashboard\/alerts',[\s\S]{0,220}?if \(!allowRequest\(req, res\)\) return/.test(src))
a('#2-3 只在跨档且非回到正常时告警(与旧行为一致)',
  /if \(level === prev \|\| level === 'ok'\) continue/.test(src))

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
// v1.3.2: 断言失败时以非 0 退出, 否则 CI 拦不住回归
if (fail > 0) process.exitCode = 1
