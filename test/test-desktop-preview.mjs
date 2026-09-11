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
// ② 桌面/平板断点: 三档形态, 且必须真的覆盖平板、不误伤手机横屏
// ==========================================================================
// 从源码里把**每一条**作用于 .dshadb_drawer 的媒体查询解出来, 再拿它们去跑设备矩阵
// —— 断言的是「768×1024 得到居中面板、1024×768 得到居中对话框、844×390 还是手机全宽」
// 这种**行为**, 而不是「源码里有某个字符串」。改断点数值时, 矩阵会立刻指出谁的观感被改了。
// 每一档写成一行 `@media (min-width:...){...}`，所以按行切最稳（块里有嵌套花括号，正则贪心到行尾才完整）
const TIERS = cli.split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('@media (min-width:'))
  .map((line) => {
    const m = line.match(/^@media\s+([^{]+)\{([\s\S]*)\}\s*$/)
    const cond = m ? m[1].trim() : '', body = m ? m[2] : ''
    return {
      cond, body,
      minW: Number((cond.match(/min-width:\s*(\d+)px/) || [])[1] || 0),
      minH: Number((cond.match(/min-height:\s*(\d+)px/) || [])[1] || 0),
    }
  })
  .sort((x, y) => x.minW - y.minW)
a('抽屉上挂着多条尺寸断点 (手机 / 平板 / 桌面三档)', TIERS.length >= 2, `tiers=${TIERS.length}`)
const sheet = TIERS.find((t) => t.minW === 768)
const dialog = TIERS.find((t) => t.minW === 1024)
a('有 768 档(平板: 居中面板)', !!sheet)
a('有 1024 档(桌面: 居中对话框)', !!dialog)
a('最窄的那一档限宽 (.dshadb_drawer + width:min(...); 更宽的档继承它)',
  sheet ? /width\s*:\s*min\(/.test(sheet.body) : false)
a('最窄的那一档用 margin auto 横向居中 (更宽的档继承它)',
  sheet ? /margin\s*:\s*0\s+auto/.test(sheet.body) : false)
a('这两档断点里不许留冗余的 calc() (min() 里可以直接写 100vw - 48px)',
  TIERS.every((t) => !/calc\(/.test(t.body)))
a('min() 里的算式确实没写 calc 也照样是合法写法 (lightningcss 规范化后的形态)',
  /width\s*:\s*min\(560px,\s*100vw\s*-\s*48px\)/.test(sheet ? sheet.body : ''))
a('平板档不许用 transform 居中 (会被 slideup 动画覆盖 → 开面板横向跳动)',
  sheet ? !/transform/.test(sheet.body) : false)
a('slideup 动画确实还在用 transform (上面那条禁令的前提)',
  /@keyframes dshadb-slideup\s*\{\s*from\s*\{\s*transform:\s*translateY\(100%\)/.test(cli))
a('桌面档用 transform 竖着居中', dialog ? /translateY\(-50%\)/.test(dialog.body) : false)
a('桌面档因此必须换掉带 transform 的入场动画, 改用纯淡入',
  dialog ? /animation\s*:\s*dshadb-fadein/.test(dialog.body) : false)
a('fadein 关键帧里确实没有 transform (换动画才安全)',
  /@keyframes dshadb-fadein\s*\{\s*from\s*\{\s*opacity:0\s*\}\s*to\s*\{\s*opacity:1\s*\}\s*\}/.test(cli))
a('桌面档给了高度上限 min(720px,80vh)', dialog ? /max-height\s*:\s*min\(720px,\s*80vh\)/.test(dialog.body) : false)
a('桌面档的 max-height 带 !important (否则被内联 style 的 70vh/86vh 盖掉)',
  dialog ? /max-height\s*:\s*min\(720px,\s*80vh\)\s*!important/.test(dialog.body) : false)
a('两个抽屉的内联 max-height 确实还在 (所以 !important 是必需的, 不是随手加的)',
  (cli.match(/style: \{ maxHeight: "\d+vh" \}/g) || []).length === 2)

// --- 评审第 ② 条「平板空间利用率」的中间档: 桌面档加宽面板 + 卡片两列 ---
a('桌面档把面板加宽到 720px (560px 单列在 10 寸以上左右全是空的)',
  dialog ? /width\s*:\s*min\(720px,\s*100vw\s*-\s*64px\)/.test(dialog.body) : false)
a('卡片容器有独立类名 (否则没法只对看板卡片做网格)',
  cli.includes('className: "dshadb_cards"'))
a('桌面档把卡片排成两列', dialog ? /\.dshadb_cards\s*\{\s*display:grid;grid-template-columns:1fr 1fr/.test(dialog.body) : false)
a('卡片自带的 margin-bottom 在网格里必须归零 (否则行距翻倍)',
  dialog ? /\.dshadb_cards \.dshadb_card\s*\{\s*margin-bottom:0\s*\}/.test(dialog.body) : false)
a('平板/手机档不许动卡片布局 (两列只在桌面档出现)',
  sheet ? !/dshadb_cards/.test(sheet.body) : false)
a('网格容器用 align-items:start (卡片高度不一时不被拉平)',
  dialog ? /\.dshadb_cards\s*\{[^}]*align-items:start/.test(dialog.body) : false)
a('抽屉本体仍带 dshadb_drawer 类名 (断点才有东西可作用)',
  cli.includes('className: "dshadb_drawer"'))
a('手机端不受影响: 断点条件是 min-width/min-height, 没有 max-width 反写',
  !/@media\s*\(max-width/.test(cli))
a('每一档都同时约束高度 (挡手机横屏的唯一办法)',
  TIERS.every((t) => t.minH >= 500), TIERS.map((t) => t.minH).join('/'))

// 真实设备矩阵: [设备, 宽, 高, 期望形态]
const layoutFor = (w, h) => {
  const hit = TIERS.filter((t) => (!t.minW || w >= t.minW) && (!t.minH || h >= t.minH)).pop()
  if (!hit) return 'phone'
  return /translateY\(-50%\)/.test(hit.body) ? 'dialog' : 'sheet'
}
const DEVICES = [
  ['iPhone 14 竖屏', 390, 844, 'phone'],
  ['iPhone 14 横屏', 844, 390, 'phone'],   // 宽过 768 但很矮 —— 必须仍走手机全宽
  ['Pixel 7 横屏', 915, 412, 'phone'],
  ['小安卓平板 竖屏', 600, 960, 'phone'],   // 没到 768, 手机形态
  ['iPad mini 竖屏', 768, 1024, 'sheet'],  // 768 正好卡在门槛上
  ['iPad 10.9 竖屏', 820, 1180, 'sheet'],
  ['安卓平板 竖屏', 800, 1280, 'sheet'],
  ['1023×700 窄窗口', 1023, 700, 'sheet'], // 宿主手机壳 MOBILE_QUERY 的上界, 差 1px
  ['iPad mini 横屏', 1024, 768, 'dialog'],
  ['iPad 10.9 横屏', 1180, 820, 'dialog'],
  ['iPad Pro 12.9 竖屏', 1024, 1366, 'dialog'],
  ['iPad Pro 12.9 横屏', 1366, 1024, 'dialog'],
  ['安卓平板 横屏', 1280, 800, 'dialog'],
  ['笔记本 1366×768', 1366, 768, 'dialog'],
  ['台式 1920×1080', 1920, 1080, 'dialog'],
]
const LAYOUT_LABEL = { phone: '手机全宽', sheet: '居中 560px 面板', dialog: '居中对话框' }
for (const [name, w, h, want] of DEVICES) {
  const got = layoutFor(w, h)
  a(`${name} (${w}×${h}) → ${LAYOUT_LABEL[want]}`, got === want, `实际=${LAYOUT_LABEL[got] || got}`)
}

// ==========================================================================
// ②b 无障碍: 只加 role="dialog", 绝不加 aria-modal (手机壳红线)
// ==========================================================================
a('三个抽屉都标了 role="dialog"',
  (cli.match(/className: "dshadb_drawer", role: "dialog"/g) || []).length === 3,
  String((cli.match(/className: "dshadb_drawer", role: "dialog"/g) || []).length))
a('每个 dialog 都带 aria-label (否则无障碍只多了个空壳)',
  (cli.match(/className: "dshadb_drawer", role: "dialog", "aria-label":/g) || []).length === 3,
  String((cli.match(/className: "dshadb_drawer", role: "dialog", "aria-label":/g) || []).length))
a('绝不设置 aria-modal 属性 (手机壳有 46 条以它为前缀的结构性 CSS 会重排我们面板)',
  !/["\[]aria-modal["\]:]/.test(cli))
a('源码里留了「为什么不用 aria-modal」的说明 (免得后人"顺手补上")',
  /绝不加 aria-modal/.test(cli))

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
