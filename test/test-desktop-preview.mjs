// v1.5.0-desktop-preview 系列回归钉子 —— 预发行(桌面/平板适配)分支专用。
//
// 这一批钉的是「预览版必须能被认出来、必须不污染正式版」这件事本身:
//   ① 版本号是 semver 预发布形态, 且 package-lock 与 package.json 一致
//   ② 桌面断点只加宽度/居中, 且**不许用 transform 居中**
//      —— .dshadb_drawer 带 slideup 动画(from{translateY(100%)}), 动画会盖掉 transform,
//         用 transform 居中的话开面板那一瞬间会横向跳一下(这是本分支唯一的结构性坑)
//   ③ 预览标识: 服务端下发 version/preview, 客户端只在 preview 为真时渲染横幅
//   ④ 预览版**不参与一键更新** —— 否则一次误点就被 main 的正式版覆盖, 桌面布局无声消失
//   ⑤ install.sh 能用 DSH_DASHBOARD_REF 装预览分支, 默认仍是 main
//
// 注: 手机端行为不变的保证方式是「断点只在 >=768px 生效」, 这一点由 ② 的媒体查询条件钉住。
const fs = await import('node:fs')
const path = await import('node:path')
const { readFileSync } = fs
let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const src = readFileSync(path.join(ROOT, 'src/index.js'), 'utf8')
const cli = readFileSync(path.join(ROOT, 'client/client.js'), 'utf8')
const sh = readFileSync(path.join(ROOT, 'install.sh'), 'utf8')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))

// ==========================================================================
// ① 版本号与锁定文件
// ==========================================================================
a('package.json 是预发行版本号 (X.Y.Z-<tag>.N)',
  /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/.test(pkg.version), pkg.version)
a('预发行标记说明这是桌面预览分支',
  /-desktop-preview\.\d+$/.test(pkg.version), pkg.version)
a('package-lock 顶层 version 与 package.json 一致',
  lock.version === pkg.version, `${lock.version} vs ${pkg.version}`)
a('package-lock packages[""].version 与 package.json 一致',
  lock.packages && lock.packages[''] && lock.packages[''].version === pkg.version,
  lock.packages && lock.packages[''] && lock.packages[''].version)
a('依赖仍然为空 (零依赖是硬约束)',
  !pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
  JSON.stringify(pkg.dependencies))

// ==========================================================================
// ② 桌面/平板断点: 只改宽度/居中、不能用 transform, 且必须真的覆盖平板
// ==========================================================================
// 从源码里把作用于 .dshadb_drawer 的那条媒体查询**解出来**, 再拿它去跑设备矩阵
// —— 断言的是「这个断点在 768×1024 上生效、在 844×390 上不生效」这种**行为**,
// 而不是「源码里有某个字符串」。改断点数值时, 下面矩阵会立刻告诉你谁的观感被改了。
const mq = cli.match(/@media\s+([^{]+)\{\s*\.dshadb_drawer\s*\{([^}]*)\}/)
a('存在作用于 .dshadb_drawer 的尺寸断点', !!mq)
const mqCond = mq ? mq[1].trim() : ''
const mqBody = mq ? mq[2] : ''
const minW = Number((mqCond.match(/min-width:\s*(\d+)px/) || [])[1] || 0)
const minH = Number((mqCond.match(/min-height:\s*(\d+)px/) || [])[1] || 0)
const hitsBreakpoint = (w, h) => (!minW || w >= minW) && (!minH || h >= minH)
a('断点里限了抽屉宽度 (.dshadb_drawer + width:min(...))',
  /width\s*:\s*min\(/.test(mqBody), mqBody.slice(0, 120))
a('断点里用 margin auto 居中', /margin\s*:\s*0\s+auto/.test(mqBody))
a('断点里不许用 transform 居中 (会被 slideup 动画覆盖 → 开面板横向跳动)',
  !/transform/.test(mqBody))
a('slideup 动画确实还在用 transform (上面那条禁令的前提)',
  /@keyframes dshadb-slideup\{from\{transform:translateY\(100%\)\}/.test(cli.replace(/\s+/g, '')) ||
  /@keyframes dshadb-slideup\s*\{\s*from\s*\{\s*transform:\s*translateY\(100%\)/.test(cli))
a('抽屉本体仍带 dshadb_drawer 类名 (断点才有东西可作用)',
  cli.includes('className: "dshadb_drawer"'))
a('手机端不受影响: 断点条件是 min-width/min-height, 没有 max-width 反写',
  !/@media\s*\(max-width/.test(cli))
a('断点同时约束高度 (挡手机横屏的唯一办法)',
  minH >= 500, `min-height=${minH || '(缺)'}`)

// 真实设备矩阵: [设备, 宽, 高, 是否应该走桌面/平板布局]
const DEVICES = [
  ['iPhone 14 竖屏', 390, 844, false],
  ['iPhone 14 横屏', 844, 390, false],   // 宽过 768 但很矮 —— 必须仍走手机全宽
  ['Pixel 7 横屏', 915, 412, false],
  ['iPad mini 竖屏', 768, 1024, true],   // 768 正好卡在门槛上, 必须命中
  ['iPad mini 横屏', 1024, 768, true],
  ['iPad 10.9 竖屏', 820, 1180, true],
  ['iPad 10.9 横屏', 1180, 820, true],
  ['iPad Pro 12.9 竖屏', 1024, 1366, true],
  ['iPad Pro 12.9 横屏', 1366, 1024, true],
  ['安卓平板 竖屏', 800, 1280, true],
  ['安卓平板 横屏', 1280, 800, true],
  ['笔记本 1366×768', 1366, 768, true],
  ['台式 1920×1080', 1920, 1080, true],
]
for (const [name, w, h, want] of DEVICES) {
  a(`${name} (${w}×${h}) → ${want ? '居中抽屉' : '手机全宽'}`,
    hitsBreakpoint(w, h) === want)
}

// ==========================================================================
// ③ 预览标识: 服务端下发 + 客户端只在 preview 为真时渲染
// ==========================================================================
const { semverCompare } = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
a('semverCompare: 预发行版本号仍能比较 (1.5.0-… > 1.4.2)',
  semverCompare('1.5.0-desktop-preview.1', '1.4.2') === 1)
a('semverCompare: 同一基线的预发行视为相等 (不会自我提示更新)',
  semverCompare('1.5.0-desktop-preview.1', '1.5.0') === 0)

a('服务端从自身 package.json 取版本 (PLUGIN_VERSION)',
  /const\s+PLUGIN_VERSION\s*=\s*readVersionAt\(SELF_ROOT\)/.test(src))
a('服务端用版本号里有没有 "-" 判定预览 (单一事实来源, 不另加配置项)',
  /const\s+IS_PREVIEW\s*=\s*PLUGIN_VERSION\.includes\('-'\)/.test(src))
a('version 下发到客户端 (3 处 config 载荷)',
  (src.match(/version:\s*PLUGIN_VERSION,/g) || []).length === 3,
  String((src.match(/version:\s*PLUGIN_VERSION,/g) || []).length))
a('preview 下发到客户端 (3 处 config 载荷)',
  (src.match(/preview:\s*IS_PREVIEW,/g) || []).length === 3,
  String((src.match(/preview:\s*IS_PREVIEW,/g) || []).length))

a('客户端横幅只在 config.preview 为真时渲染', /\(config && config\.preview\)\s*\?\s*react\.createElement\("div", \{ className: "dshadb_preview_banner"/.test(cli))
a('横幅显示真实版本号 (config.version)',
  /config\.version/.test(cli))
a('中英双语都补了预览文案',
  (cli.match(/"preview\.title"\s*:/g) || []).length === 2 &&
  (cli.match(/"preview\.body"\s*:/g) || []).length === 2,
  `title=${(cli.match(/"preview\.title"\s*:/g) || []).length} body=${(cli.match(/"preview\.body"\s*:/g) || []).length}`)
a('横幅样式有深色模式分支',
  /prefers-color-scheme:dark\)\{\.dshadb_preview_banner/.test(cli.replace(/\s+/g, '')))

// ==========================================================================
// ④ 预览版不参与一键更新
// ==========================================================================
a('「检查更新」按钮在预览版下被禁用',
  /disabled:\s*upd\.phase === "checking" \|\| upd\.phase === "installing" \|\| !!\(config && config\.preview\)/.test(cli))
a('「一键更新」按钮在预览版下不渲染',
  /upd\.info\?\.hasUpdate && !\(config && config\.preview\)/.test(cli))
a('面板里说明了为什么不给更新 (不是静默失效)',
  cli.includes('t("update.previewHint")') &&
  (cli.match(/"update\.previewHint"\s*:/g) || []).length === 2)
a('更新成功后的 DSHA Toast 未被预览改动波及 (仍是容错调用)',
  /\/app\/toast\?text=/.test(cli))

// ==========================================================================
// ⑤ install.sh 支持装预览分支, 默认仍是正式版 main
// ==========================================================================
a('install.sh 有 DSH_DASHBOARD_REF 且默认 main',
  /REF="\$\{DSH_DASHBOARD_REF:-main\}"/.test(sh))
a('install.sh 的下载地址用的是该 ref',
  /refs\/heads\/\$\{REF\}/.test(sh))
a('install.sh 会提示这是预发行分支',
  /预发行分支/.test(sh))

// ==========================================================================
// ⑥ 预发行 tag 不许把预览版发到 npm (否则 latest 会被预览版顶掉)
// ==========================================================================
const wf = readFileSync(path.join(ROOT, '.github/workflows/publish.yml'), 'utf8')
a('publish.yml 有预发行守卫步骤', /id:\s*prerelease_guard/.test(wf))
a('publish.yml 的发布步骤挂了守卫条件',
  /- name:\s*发布到 npm\n\s*if:\s*steps\.prerelease_guard\.outputs\.skip != 'true'/.test(wf))
a('守卫用「版本号里有没有 -」判定预发行',
  /case "\$PKG" in\s*\n\s*\*-\*\)/.test(wf))
a('守卫对正式版本仍放行 (skip=false 分支存在)', /skip=false/.test(wf))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
