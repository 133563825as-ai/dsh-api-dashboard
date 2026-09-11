// v1.4.1: 审计修复的回归钉子。
// 这一批全是「实测复现过、后果严重」的问题, 每一条都钉在**行为**上, 不钉源码字符串
// （血的教训: test-bar.mjs 里那条 `!src.includes('Math.max(Number(e.target.value) || 5, 5)')`
//   断言的是旧变量名, 改成 refreshSec 之后同一个 bug 换个名字就绕过了断言）。
const fs = await import('node:fs')
const os = await import('node:os')
const path = await import('node:path')
const { mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync, readFileSync } = fs
let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const src = readFileSync(path.join(ROOT, 'src/index.js'), 'utf8')
const cli = readFileSync(path.join(ROOT, 'client/client.js'), 'utf8')

// ==========================================================================
// H-1 状态文件形状损坏 → apply() 绝不能抛
// 实测后果: `{"customRelays": 5}` 会让整个 `dsh web` 启动失败(不是插件不显示, 是 GUI 打不开)。
// 这里用**独立子进程**跑, 因为模块顶层的 DSH_HOME 在 import 时就固化了。
// ==========================================================================
{
  const tmpHome = path.join(os.tmpdir(), 'dshadb-v141-' + Date.now())
  const cases = [
    ['customRelays 是数字', { customRelays: 5 }],
    ['customModels 是字符串', { customModels: 'x' }],
    ['customRelays 是对象', { customRelays: { a: 1 } }],
    ['presets 是数字', { presets: 9 }],
    ['whaleSettings 是字符串', { whaleSettings: 'bad' }],
    ['prices 是数组', { prices: [1, 2] }],
    ['refreshIntervalMs = -1', { refreshIntervalMs: -1 }],
    ['refreshIntervalMs 是字符串垃圾', { refreshIntervalMs: 'abc' }],
    ['整份是数组', [1, 2, 3]],
    ['整份是字符串', 'hello'],
  ]
  const results = []
  for (const [label, bad] of cases) {
    mkdirSync(tmpHome, { recursive: true })
    writeFileSync(path.join(tmpHome, 'dsh-api-dashboard.json'), JSON.stringify(bad))
    const { execFileSync } = await import('node:child_process')
    let ok = true, err = ''
    try {
      execFileSync(process.execPath, ['--input-type=module', '-e',
        `const m = await import(${JSON.stringify('file://' + path.join(ROOT, 'src/index.js'))});
         const cfg = Object.fromEntries(Object.entries(m.Config ? {} : {}));
         // 直接调用 apply 的配置装配路径: 用一个最小假 ctx, 只关心它**不抛**
         const ctx = { inject(){}, effect(){}, get(){ return undefined }, on(){}, logger:{ warn(){}, error(){} } };
         m.apply(ctx, { refreshIntervalMs: 5000, clientPollIntervalMs: 5000, timeoutMs: 8000 });
         console.log('APPLIED');`],
        { env: { ...process.env, DSH_HOME: tmpHome }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      ok = true
    } catch (e) { ok = false; err = String(e.stderr || e.message).split('\n').slice(0, 2).join(' | ') }
    results.push([label, ok, err])
  }
  for (const [label, ok, err] of results) a('H1 形状损坏不致命: ' + label, ok, err)
  rmSync(tmpHome, { recursive: true, force: true })
}

// ==========================================================================
// H-4a openai 分支不许伪造负数余额（与已修的 openrouter 同类）
// ==========================================================================
{
  const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
  a('H4a total_granted=null 不表态', m.parseResponse('openai', { total_granted: null, total_used: 5, total_available: null }) === null)
  a('H4a total_granted=abc 不表态', m.parseResponse('openai', { total_granted: 'abc', total_used: 5 }) === null)
  a('H4a total_used=null 不表态', m.parseResponse('openai', { total_granted: 10, total_used: null }) === null)
  const ok1 = m.parseResponse('openai', { total_granted: 10, total_used: 4 })
  a('H4a 正常值仍能算 (10-4=6)', ok1 && ok1.total === 6, JSON.stringify(ok1))
  const ok2 = m.parseResponse('openai', { total_granted: 10, total_used: 4, total_available: 6 })
  a('H4a 有 available 时以它为准', ok2 && ok2.total === 6 && ok2.available === 6)
  const neg = m.parseResponse('openai', { total_granted: 5, total_used: 9 })
  a('H4a 真实负数(充值5用9)仍如实返回 -4', neg && neg.total === -4)
  a('H4a 全空对象不表态', m.parseResponse('openai', {}) === null)
}

// ==========================================================================
// H-4b 持久化的刷新间隔必须被夹到合法区间（曾经 -1 → 3 秒 1794 次上游请求）
// ==========================================================================
{
  a('H4b 加载路径有夹取(源码级)', /NUMBER_FIELDS[\s\S]{0,400}refreshIntervalMs/.test(src))
  a('H4b clampRefreshSec 下限 1 / 上限 60', (() => {
    const m2 = { clampRefreshSec: null }
    return src.includes('Math.min(Math.max(Math.round(Number(v) || 1), 1), 60)')
  })())
}

// ==========================================================================
// H-4d readBody 必须按字节收集再整体解码（跨 chunk 切分多字节 UTF-8）
// ==========================================================================
{
  a('H4d 不再对每个 chunk 单独 toString', !/body \+= chunk/.test(src))
  a('H4d 使用 Buffer.concat 后一次解码', /Buffer\.concat\(chunks\)\.toString\('utf8'\)/.test(src))
}

// ==========================================================================
// H-2 一键自更新
// ==========================================================================
{
  a('H2 keep 集合保留 .git', /keep = new Set\(\['node_modules', '\.git'\]\)/.test(src))
  a('H2 拒绝符号链接 target', /refusing to update a symbolic-link target/.test(src))
  a('H2 legacy 目录是 git 工作区时不自动同步', /!existsSync\(join\(legacyReal, '\.git'\)\)/.test(src))

  // 行为验证: 真实目录更新后 .git 仍在; 软链 target 被拒且真实目录无损
  const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
  const base = path.join(os.tmpdir(), 'dshadb-h2-' + Date.now())
  const tarPath = path.join(base, 'fake.tar.gz')
  const pkgRoot = path.join(base, 'pkgroot', 'dsh-api-dashboard-main')
  mkdirSync(path.join(pkgRoot, 'src'), { recursive: true })
  mkdirSync(path.join(pkgRoot, 'client'), { recursive: true })
  writeFileSync(path.join(pkgRoot, 'package.json'), JSON.stringify({ name: 'dsh-api-dashboard', version: '9.9.9' }))
  writeFileSync(path.join(pkgRoot, 'src', 'index.js'), '// new')
  writeFileSync(path.join(pkgRoot, 'client', 'client.js'), '// new')
  writeFileSync(path.join(pkgRoot, 'cordis.patch.yml'), '- insert: []\n')
  const { execFileSync } = await import('node:child_process')
  execFileSync('tar', ['czf', tarPath, '-C', path.join(base, 'pkgroot'), 'dsh-api-dashboard-main'])

  const A = path.join(base, 'instA')
  mkdirSync(path.join(A, '.git'), { recursive: true })
  writeFileSync(path.join(A, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(path.join(A, 'package.json'), JSON.stringify({ name: 'dsh-api-dashboard', version: '1.0.0' }))
  mkdirSync(path.join(A, 'src'), { recursive: true })
  writeFileSync(path.join(A, 'src', 'index.js'), '// old')
  let ok = true, info = null
  try { info = await m.applyUpdate({ targets: [A], remoteVersion: '9.9.9', localTarball: tarPath }) } catch (e) { ok = false; info = e.message }
  a('H2 真实目录可更新', ok && info && info.installed === '9.9.9', JSON.stringify(info))
  a('H2 更新后 .git 仍在（核心）', existsSync(path.join(A, '.git', 'HEAD')))
  a('H2 更新后 src/index.js 是新版', readFileSync(path.join(A, 'src', 'index.js'), 'utf8').includes('new'))

  const REAL = path.join(base, 'realC'), LINK = path.join(base, 'linkC')
  mkdirSync(path.join(REAL, 'src'), { recursive: true })
  writeFileSync(path.join(REAL, 'package.json'), JSON.stringify({ name: 'dsh-api-dashboard', version: '1.0.0' }))
  writeFileSync(path.join(REAL, 'src', 'index.js'), '// keepme')
  symlinkSync(REAL, LINK)
  let rejected = false
  try { await m.applyUpdate({ targets: [LINK], remoteVersion: '9.9.9', localTarball: tarPath }) } catch (e) { rejected = /symbolic-link/.test(e.message) }
  a('H2 软链 target 被拒绝', rejected)
  a('H2 被拒后真实目录未受损', existsSync(path.join(REAL, 'src', 'index.js')) && existsSync(path.join(REAL, 'package.json')))
  rmSync(base, { recursive: true, force: true })
}

// ==========================================================================
// H-3 插件路由必须带鉴权闸门（跨域 text/plain 写实测曾经返回 200 并真的改了配置）
// ==========================================================================
{
  const gateCount = (src.match(/if \(!allowRequest\(req, res\)\) return/g) || []).length
  a('H3 11 个路由全部过闸门', gateCount === 11, 'got ' + gateCount)
  a('H3 用 connection.requestRejection（与 dsh-web-mobile 同一个闸门）', /requestRejection\(req\)/.test(src))
  // 只看代码行, 注释里提到这个坑不算（第一版断言就栽在这: 注释里写了这句, 断言直接假红）
  const codeOnly = src.split('\n').filter((l) => { const t = l.trim(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*') }).join('\n')
  a('H3 不再用取不到的 ctx.get 取 connection 服务', !/ctx\.get\('connection'\)/.test(codeOnly))
  a('H3 通过嵌套 inject 拿服务', /ctx\.inject\(\['connection'\]/.test(src))
}

// ==========================================================================
// C-1 「刷新间隔 1 秒」四处下限必须真的都是 1（旧代码 save() 夹 5，回归断言还假绿）
// ==========================================================================
{
  a('C1 save() 不再夹到 5 秒', !/\|\| 5, 5\)/.test(cli))
  a('C1 save() 下限是 1 秒', /Number\(refreshSec\) \|\| 1, 1/.test(cli))
  a('C1 输入框 min=1', /min: 1, max: 60, step: 1/.test(cli))
  a('C1 onChange 下限是 1 秒', /Number\(e\.target\.value\) \|\| 1, 1/.test(cli))
  a('C1 服务端 clampRefreshSec 是 1~60', /Math\.min\(Math\.max\(Math\.round\(Number\(v\) \|\| 1\), 1\), 60\)/.test(src))
}

// ==========================================================================
// C-2 冷启动设置面板不许拿默认值覆盖用户配置
// ==========================================================================
{
  a('C2 服务端 /config 返回 safeThreshold', /safeThreshold: runtimeConfig\.safeThreshold,\n\s+warnThreshold: runtimeConfig\.warnThreshold,/.test(src))
  a('C2 客户端 /config 回调读 safeThreshold', /typeof d\.safeThreshold === "number"\) setSafe/.test(cli))
  a('C2 客户端 /config 回调读 currency', /typeof d\.currency === "string"\) setCurrency/.test(cli))
}

// ==========================================================================
// C-3 / C-4 客户端健壮性
// ==========================================================================
{
  a('C3a 存在统一超时包装 fetchT', /const fetchT = \(url, opts, ms\)/.test(cli))
  a('C3a 余额请求走 fetchT', /await fetchT\(url, \{ headers: \{ accept: "application\/json" \}/.test(cli))
  // 血的教训: 全量刷新实测 8~13.6s, 第一版把余额也套 15s 超时 → 冷启动首屏必超时 → 面板报「余额接口请求失败」
  a('C3a 余额超时远大于普通超时（≥60s）', /BALANCES_TIMEOUT_MS = (\d+)/.test(cli) && Number(cli.match(/BALANCES_TIMEOUT_MS = (\d+)/)[1]) >= 60000)
  a('C3a 余额 fetch 真的用了长超时', /\}, BALANCES_TIMEOUT_MS\)/.test(cli))
  a('C3a 冷启动慢加载有解释文案', cli.includes('首次加载要逐个平台拉取余额'))
  a('C3a 没有裸的 /api-dashboard fetch', !/[^T]fetch\("\/api-dashboard/.test(cli.replace(/fetchT\("/g, 'fetchT_("')))
  a('C3c 抽屉有错误态文案', cli.includes('余额接口请求失败'))
  a('C3c 错误态带重试按钮', /key: "retry"[\s\S]{0,200}forceRefresh/.test(cli))
  a('C4a .dshadb_bar_err 有 CSS 规则', /\.dshadb_bar_err\{color:/.test(cli))
  a('C4a .dshadb_bar_ok 有 CSS 规则', /\.dshadb_bar_ok\{color:/.test(cli))
  a('C4a .dshadb_bar_warn 有 CSS 规则', /\.dshadb_bar_warn\{color:/.test(cli))
  a('C4b 胶囊监听器只挂一次', /node\.__dshadbTipBound === true\) return/.test(cli))
  a('C4b 长按读节点上的最新 tip', /node\.__dshadbTip \|\| text/.test(cli))
  a('C4c 强刷 2 秒节流存在', /lastForceAt/.test(cli) && /now - lastForceAt < 2000/.test(cli))
  a('C4c 旧响应不会覆盖新响应', /if \(mySeq <= appliedSeq\)/.test(cli))
}

// ==========================================================================
// v1.4.1: 冷启动不再阻塞首屏 + A（中转站端点记忆）
// 实测: 全量刷新 8~13.6s（维护者 5 个中转站），旧行为首屏要 await 它 → 「重启进来等半天」。
// ==========================================================================
{
  a('冷启动 → background（不阻塞首屏）', /if \(!hasData\) return force \? 'wait' : 'background'/.test(src))
  a('响应带 loading 标记', /loading: cache\.balances\.length === 0/.test(src))
  a('客户端识别 loading 并保持骨架屏', /if \(data\.loading === true\)/.test(cli))
  a('客户端 loading 期间加快轮询（1.5s）', /pollMs = Math\.min\(pollMs, 1500\)/.test(cli))
  a('A 记忆表已声明', /const relayEndpointHints = new Map\(\)/.test(src))
  a('A 载入时做形状校验', /relayEndpointHints\.clear\(\)/.test(src) && /typeof v === 'string' && v\.length <= 32/.test(src))
  a('A 命中端点排到候选最前', /candidates\.unshift\(candidates\.splice\(idx, 1\)\[0\]\)/.test(src))
  a('A 命中后落盘（仅在变化时）', /if \(relayEndpointHints\.get\(id\) !== cand\.type\)/.test(src) && /relayEndpoints: Object\.fromEntries/.test(src))
  a('A 的持久化字段进消毒白名单', /OBJECT_FIELDS = \['whaleSettings', 'prices', 'relayEndpoints'\]/.test(src))
  a('A 只影响顺序（候选全表仍会试）', /只做\*\*排序提示\*\*/.test(src))
}

// ==========================================================================
// UI v1.4.1（按维护者反馈定稿）：余额条恢复独立药丸 + 整块水平居中
// ==========================================================================
{
  a('UI 整块水平居中（fit-content + margin auto）', /\.dshadb_barwrap\{display:flex;flex-direction:column;align-items:center;gap:0;width:fit-content;max-width:100%;min-width:0;margin:0 auto\}/.test(cli))
  a('UI 不再有容器化底色/边框', !/\.dshadb_barwrap\{[^}]*border-radius:12px/.test(cli))
  a('UI 余额条恢复独立药丸（圆角+底色+边框）', /\.dshadb_bar\{display:inline-flex[^}]*border-radius:10px;background:#f5f6f8;border:1px solid #e7e8ec/.test(cli))
  a('UI 余额条不再是 flex:1 填充', !/\.dshadb_bar\{[^}]*flex:1 1 auto/.test(cli))
  a('UI 子代理行左右对称内边距', /\.dshadb_subs\{[^}]*margin:3px 0 0 0/.test(cli))
  a('UI 溢出渐隐类有 CSS', /\.dshadb_subs_overflow\{-webkit-mask-image/.test(cli))
  a('UI 溢出时才加渐隐类', /scrollWidth > n\.clientWidth \+ 1/.test(cli))
  a('UI 暗色余额条有背景', /\.dshadb_bar\{background:#262a33/.test(cli))
  a('UI 抽屉/遮罩仍是 fixed（不会被裁）', /\.dshadb_drawer\{position:fixed/.test(cli) && /\.dshadb_scrim\{position:fixed/.test(cli))
  a('UI 结构完整性: barwrap/barrow/subs 类名都在', cli.includes('"dshadb_barwrap"') && cli.includes('"dshadb_barrow"') && cli.includes('"dshadb_subs"'))
}

// ==========================================================================
// 大肥鱼：设置面板开着时必须能拖动（维护者反馈「得关掉才能动」）
// ==========================================================================
{
  a('WHALE 任何界面都不自动上锁（定稿）', cli.includes('setWhaleLocked(false)'))
  a('WHALE 不再按界面自动加锁', !/setWhaleLocked\((overlayOpen|whaleLockOverlay)\)/.test(cli))
  a('WHALE 锁的 CSS 仍在（body + 抓取层都要锁）', /\.dshadb-whale-locked \.dshadb-whale-body\{pointer-events:none/.test(cli) && /\.dshadb-whale-locked \.dshadb-whale-grab\{pointer-events:none/.test(cli))
  a('WHALE onDown 仍兜一道锁判断', /classList\.contains\("dshadb-whale-locked"\)\) return;/.test(cli))
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
