// v1.4.0: /api-dashboard/balances 的取数策略 + 刷新间隔白名单 —— 纯函数回归。
//
// 为什么单独测: 这两条策略是「体感」问题的根因, 很容易被顺手改回阻塞式:
//   ① 首屏/切回前台曾经走 force=1 → 服务端 await refreshAll() 要等最慢的端点(最长 8s)
//      → 用户看到「插件加载很慢」。现在走 stale=1 → 有缓存就立刻回。
//   ② 刷新间隔下限曾写死 5 秒, 用户要求 1 秒。
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (n, c) => { if (c) { pass++ } else { fail++; console.log('FAIL ' + n) } }
const eq = (n, got, want) => a(n + ' (got ' + JSON.stringify(got) + ')', JSON.stringify(got) === JSON.stringify(want))

const plan = m.planBalancesFetch
a('planBalancesFetch / clampRefreshSec 已导出', typeof plan === 'function' && typeof m.clampRefreshSec === 'function')

// ==== 冷启动: v1.4.1 起**不再阻塞首屏** ====
// 旧行为是 wait —— 服务端刚重启时缓存为空, 第一个请求要 await 一次全量刷新, 而实测
// 全量刷新要 8~13.6 秒(中转站 auto 探测串行试 3 个端点), 用户看到「重启进来等半天」。
// 现在: 立刻回 loading + 后台刷新, 客户端保持骨架屏并 1.5 秒后重问; 只有显式强刷才阻塞。
eq('无缓存 → background (不再阻塞首屏)', plan({ hasData: false, age: 0, intervalMs: 5000 }), 'background')
eq('无缓存 + peek → background', plan({ peek: true, hasData: false, age: 0 }), 'background')
eq('无缓存 + force → wait (用户主动要新数据, 阻塞等)', plan({ force: true, hasData: false, age: 0 }), 'wait')

// ==== 有缓存且够新: 直接用, 不打平台接口 ====
eq('有缓存且新鲜 → none', plan({ hasData: true, age: 1000, intervalMs: 5000 }), 'none')
eq('刚好等于 interval 不算过期 → none', plan({ hasData: true, age: 5000, intervalMs: 5000 }), 'none')

// ==== 首屏 / 切回前台 (peek): 立刻回旧数据, 刷新丢后台 ====
eq('peek + 过期 → background', plan({ peek: true, hasData: true, age: 6000, intervalMs: 5000 }), 'background')
eq('peek + 过期很久 → background (绝不 wait)', plan({ peek: true, hasData: true, age: 999999, intervalMs: 5000 }), 'background')
eq('peek 但 1 秒内刚拉过 → none (不重复打)', plan({ peek: true, hasData: true, age: 800, intervalMs: 100 }), 'none')

// ==== 显式强刷 (force=1 / 手动刷新按钮 / 保存设置后): 阻塞等新数据 ====
eq('force + 有缓存 → wait', plan({ force: true, hasData: true, age: 999999, intervalMs: 5000 }), 'wait')
eq('force 但 2 秒内刚拉过 → none (连点节流)', plan({ force: true, hasData: true, age: 1500, intervalMs: 5000 }), 'none')
// 关键断言: force 与 peek 同时给时, peek 优先 —— 首屏路径绝不能被改成阻塞
eq('force+peek: peek 优先, 不阻塞', plan({ force: true, peek: true, hasData: true, age: 999999, intervalMs: 5000 }), 'background')

// ==== 自动过期 (轮询拉到一半缓存过期) ====
eq('非 force 非 peek + 过期 → wait (老行为: 进页面自动拉)', plan({ hasData: true, age: 6000, intervalMs: 5000 }), 'wait')

// ==== 畸形输入不炸 ====
// 默认参数(无数据) → background: 与上面「冷启动不阻塞首屏」同一条规则
eq('空对象', plan(), 'background')
eq('undefined', plan(undefined), 'background')
eq('intervalMs 缺失 → 5 分钟兜底, 5 秒不算过期', plan({ hasData: true, age: 5000 }), 'none')
eq('intervalMs = 0 → 5 分钟兜底', plan({ hasData: true, age: 60000, intervalMs: 0 }), 'none')
eq('age 为负 (时钟回拨) 不误判过期', plan({ hasData: true, age: -1000, intervalMs: 5000 }), 'none')

// ==== 刷新间隔: 1~60 秒 ====
const c = m.clampRefreshSec
eq('下限放宽到 1 秒', c(1), 1)
eq('0 → 1 (不再被抬到 5)', c(0), 1)
eq('负数 → 1', c(-9), 1)
eq('旧下限 5 照常', c(5), 5)
eq('小数四舍五入', c(2.6), 3)
eq('上限 60', c(60), 60)
eq('超过 60 夹到 60', c(999), 60)
eq('字符串也能吃', c('3'), 3)
eq('垃圾值 → 1', c('abc'), 1)
eq('NaN → 1', c(NaN), 1)
eq('undefined → 1', c(undefined), 1)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
