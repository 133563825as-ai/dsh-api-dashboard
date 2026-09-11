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
// ⚠️ preview.5 起每条断点可以有**多个并列条件**(逗号分隔的 OR)，因为补了 `(pointer:fine)` 分支：
//    `(min-width:768px) and (min-height:600px),(min-width:768px) and (pointer:fine)`
//    所以这里解出 conds[] 而不是单个 minW/minH —— 矩阵求值时任一条件命中即算命中。
//    同时只收「body 里真的出现 .dshadb_drawer」的媒体查询，免得把纯 .dshadb_handle 那条也算成一档。
const parseCond = (c) => ({
  minW: Number((c.match(/min-width:\s*(\d+)px/) || [])[1] || 0),
  minH: Number((c.match(/min-height:\s*(\d+)px/) || [])[1] || 0),
  fine: /pointer:\s*fine/.test(c),
})
const TIERS = cli.split('\n')
  .map((l) => l.trim())
  .filter((l) => l.startsWith('@media (min-width:'))
  .map((line) => {
    const m = line.match(/^@media\s+([^{]+)\{([\s\S]*)\}\s*$/)
    const cond = m ? m[1].trim() : '', body = m ? m[2] : ''
    const conds = cond ? cond.split(',').map((c) => parseCond(c)) : []
    return {
      cond, body, conds,
      minW: conds.length ? conds[0].minW : 0,
      minH: conds.length ? conds[0].minH : 0,
    }
  })
  .filter((t) => t.body.includes('.dshadb_drawer'))
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
a('这两档断点里 width:min() 不许套冗余的 calc() (min() 里可以直接写 100vw - 48px)',
  TIERS.every((t) => !/width\s*:\s*min\([^)]*calc\(/.test(t.body)))
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
a('桌面档给了高度上限 min(720px,80vh,...)', dialog ? /max-height\s*:\s*min\(720px,\s*80vh/.test(dialog.body) : false)

// --- v1.5.0-desktop-preview.5 (报告 §2.5): 内联 max-height → CSS 变量, !important 退场 ---
// 旧形态是「两个抽屉内联 style 写死 70vh/86vh → 桌面档必须挂 !important 才压得住」。
// 三个后果: ① 各档行为不一致且没写进变更记录; ② 键盘动态 max-height 会先撞上自己的 !important。
// 现在高度走 --dshadb-max-h, 内联样式没了, !important 也就不需要了。
a('两个抽屉都改用 --dshadb-max-h 变量表达高度 (内联 maxHeight 必须为 0 处)',
  (cli.match(/style: \{ maxHeight: "\d+vh" \}/g) || []).length === 0 &&
  (cli.match(/"--dshadb-max-h":\s*"\d+vh"/g) || []).length === 2,
  `内联=${(cli.match(/style: \{ maxHeight: "\d+vh" \}/g) || []).length} 变量=${(cli.match(/"--dshadb-max-h":\s*"\d+vh"/g) || []).length}`)
a('平台详情与设置各自的高度值没被改动 (70vh / 86vh, 与 v1.4.2 一致)',
  /"--dshadb-max-h":\s*"70vh"/.test(cli) && /"--dshadb-max-h":\s*"86vh"/.test(cli))
a('基础 .dshadb_drawer 用 var(--dshadb-max-h, 85vh) 兜底 (看板面板没设变量 → 仍是 85vh)',
  /max-height\s*:\s*min\(var\(--dshadb-max-h,\s*85vh\)/.test(cli))
// 断言要对准「我们自己的面板」——preview.7 起给宿主侧栏竖线补了一条 scoped !important，
// 那是**抑制宿主样式**的必要手段，与这里禁止的「用 !important 压自己内联高度」是两回事。
// 先剥掉 CSS 注释，免得注释里的示例文本被当成真声明。
const cssClean = cli.replace(/\/\*[\s\S]*?\*\//g, '')
const bangLines = cssClean.split('\n').filter((l) => /!important\s*[;}]/.test(l))
a('我们自己的面板声明里不再有 !important (只剩宿主侧栏竖线那一条 scoped 抑制)',
  bangLines.length === 1 && bangLines[0].includes('sidebarCol'),
  `${bangLines.length} 处: ` + bangLines.map((l) => l.slice(0, 60)).join(' | '))
a('说明里写清了「!important 会挡住键盘动态收窄」这个理由',
  cli.includes('--dshadb-max-h') && /!important 又会挡住/.test(cli))

// --- v1.5.0-desktop-preview.5 (报告 §2.4): 居中不许跨规则承重 ---
a('桌面档自己写了一份 margin:0 auto (不再靠 768 档跨规则承重)',
  dialog ? /margin\s*:\s*0\s+auto/.test(dialog.body) : false)
a('说明里写清了「哪天给 768 档补 max-width 就会贴左边缘」这个风险',
  /对话框贴左边缘/.test(cli))

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
// --- v1.5.0-desktop-preview.5 (报告 §2.1): 置顶卡满宽是**设计**, 不是待修的缺陷 ---
// 报告说「同一面板并存两种卡片宽度」并给出修法「包进 .dshadb_cards + grid-column:1/-1」——
// 跨两列后宽度还是 692px, 现象一条都没消掉。真"一致"就得把它压成 336px 的普通格子, 720px 对话框里反而更挤。
// 所以结论写进注释, 免得后人反复"修"。
a('置顶卡仍然是满宽 hero (没被改成普通网格格子)',
  /selectedBalance \? card\(selectedBalance\) : null,/.test(cli))
a('注释里写死了「故意不进网格」+ 为什么报告的修法无效 (免得后人反复修)',
  /置顶卡\*\*故意\*\*不进 \.dshadb_cards 网格/.test(cli) && /grid-column:1\/-1/.test(cli) && /现象一条都没消掉/.test(cli))
a('抽屉本体仍带 dshadb_drawer 类名 (断点才有东西可作用)',
  cli.includes('className: "dshadb_drawer"'))
a('手机端不受影响: 我们的断点条件只有 min-width/min-height, 没有 max-width 反写',
  !/@media\s*\(max-width/.test(cssClean))
// preview.5 起「挡手机横屏」有两条路: 要么限高度(min-height:600px), 要么要精确指针(pointer:fine)。
// 两者都没有 = 无条件的手机档 —— 那是不允许的(会把手机也套进居中面板)。
a('每一档都同时约束高度, 或者要求精确指针 (挡手机横屏的两条路至少走一条)',
  TIERS.every((t) => t.conds.every((c) => c.minH >= 500 || c.fine)),
  TIERS.map((t) => t.cond).join(' | '))

// --- v1.5.0-desktop-preview.5 (报告 §2.3): 宽而矮的鼠标窗口不再掉回通栏 ---
a('两档都补了 (pointer:fine) 并列分支 (报告 §2.3 的 600px 硬悬崖)',
  !!(sheet && sheet.conds.some((c) => c.fine)) && !!(dialog && dialog.conds.some((c) => c.fine)))
a('(pointer:fine) 分支不带 min-height (有精确指针就一定是窗口, 不是手机横屏)',
  [...sheet.conds, ...dialog.conds].filter((c) => c.fine).every((c) => c.minH === 0))
a('安全性依据写在注释里: 宿主自己用 (pointer: coarse) 认手机 (coarse/fine 互斥, 不会误伤手机)',
  /coarse 与 fine 互斥/.test(cli) && /pointer: coarse\) 认手机/.test(cli))

// 真实设备矩阵: [设备, 宽, 高, 期望形态, 是否精确指针(默认 false = 触摸)]
// 求值: 任一并列条件命中即算命中该档; 都没命中 → 手机全宽。
const layoutFor = (w, h, fine = false) => {
  const hit = TIERS.filter((t) => t.conds.some((c) =>
    (!c.minW || w >= c.minW) && (!c.minH || h >= c.minH) && (!c.fine || fine))).pop()
  if (!hit) return 'phone'
  return /translateY\(-50%\)/.test(hit.body) ? 'dialog' : 'sheet'
}
const DEVICES = [
  ['iPhone 14 竖屏', 390, 844, 'phone', false],
  ['iPhone 14 横屏', 844, 390, 'phone', false],   // 宽过 768 但很矮 —— 必须仍走手机全宽
  ['Pixel 7 横屏', 915, 412, 'phone', false],
  ['小安卓平板 竖屏', 600, 960, 'phone', false],   // 没到 768, 手机形态
  ['iPad mini 竖屏', 768, 1024, 'sheet', false],  // 768 正好卡在门槛上
  ['iPad 10.9 竖屏', 820, 1180, 'sheet', false],
  ['安卓平板 竖屏', 800, 1280, 'sheet', false],
  ['1023×700 窄窗口', 1023, 700, 'sheet', false], // 宿主手机壳 MOBILE_QUERY 的上界, 差 1px
  ['iPad mini 横屏', 1024, 768, 'dialog', false],
  ['iPad 10.9 横屏', 1180, 820, 'dialog', false],
  ['iPad Pro 12.9 竖屏', 1024, 1366, 'dialog', false],
  ['iPad Pro 12.9 横屏', 1366, 1024, 'dialog', false],
  ['安卓平板 横屏', 1280, 800, 'dialog', false],
  ['笔记本 1366×768', 1366, 768, 'dialog', false],
  ['台式 1920×1080', 1920, 1080, 'dialog', false],
  // ↓ 报告 §2.3 的悬崖: 同宽同设备, 只差 1px 高度
  ['鼠标窗口 1600×600', 1600, 600, 'dialog', true],
  ['鼠标窗口 1600×599', 1600, 599, 'dialog', true],  // 旧代码这里是 100vw 通栏
  ['鼠标窗口 1200×560', 1200, 560, 'dialog', true],
  ['鼠标窗口 1100×520', 1100, 520, 'dialog', true],
  ['窄而矮的鼠标窗口 700×500', 700, 500, 'phone', true], // 没过 768, 仍然是手机形态
  ['触摸平板竖屏 800×1280 (无鼠标)', 800, 1280, 'sheet', false],
]
const LAYOUT_LABEL = { phone: '手机全宽', sheet: '居中 560px 面板', dialog: '居中对话框' }
for (const [name, w, h, want, fine] of DEVICES) {
  const got = layoutFor(w, h, fine)
  a(`${name} (${w}×${h}${fine ? ', 精确指针' : ''}) → ${LAYOUT_LABEL[want]}`, got === want, `实际=${LAYOUT_LABEL[got] || got}`)
}
// 悬崖本身: 599 → 600 必须同形, 不能一个通栏一个对话框
a('悬崖已消除: 1600×599 与 1600×600 得到同一种形态 (旧代码 599 掉回通栏)',
  layoutFor(1600, 599, true) === layoutFor(1600, 600, true))
a('悬崖只在「有精确指针」时被抹平 —— 触摸的 844×390 仍然必须是手机全宽',
  layoutFor(844, 390, false) === 'phone' && layoutFor(844, 390, true) === 'sheet')

// ==========================================================================
// ②c v1.5.0-desktop-preview.5 (报告 §2.2): 软键盘避让
//   宿主 viewport meta 没有 interactive-widget=resizes-content → 键盘只收缩 visual viewport,
//   layout viewport(100vh / position:fixed) 不动 → 面板原地不动, 底部被盖住(真机实测 242px / 630px = 26%)。
//   ⚠️ 报告建议的 "只加 max-height: min(720px, calc(var(--vvh) - 24px))" **不够** —— 面板还是贴底边,
//      必须连锚点一起改, 所以这里把三处(抽屉 bottom / 对话框 top / 两处 max-height)都钉住。
// ==========================================================================
const nos = cli.replace(/\s+/g, '')
a('基础抽屉按 --dshadb-kb 抬底 (抽屉档: 面板整体升到键盘上方)',
  /\.dshadb_drawer\{[^}]*bottom:var\(--dshadb-kb,0px\)/.test(nos))
a('基础抽屉的 max-height 也跟着键盘收窄 (否则抬上去的仍是超高面板)',
  /max-height:min\(var\(--dshadb-max-h,85vh\),calc\(100vh-var\(--dshadb-kb,0px\)-12px\)\)/.test(nos))
a('桌面档改在「可视区」里重新居中, 而不是布局视口的 50%',
  dialog ? /top:calc\(\(100vh-var\(--dshadb-kb,0px\)\)\/2\)/.test(dialog.body.replace(/\s+/g, '')) : false)
a('桌面档 max-height 是三项 min(), 第三项按键盘收窄',
  dialog ? /max-height:min\(720px,80vh,calc\(100vh-var\(--dshadb-kb,0px\)-12px\)\)/.test(dialog.body.replace(/\s+/g, '')) : false)
a('抬底带过渡 (键盘弹出时不硬跳)',
  /transition:bottom\.18sease-out/.test(nos))
a('客户端把键盘高度写进 --dshadb-kb (纯函数 + 安装器)',
  /function keyboardInset\(m\)/.test(cli) && /function installKeyboardInsetVar\(\)/.test(cli) &&
  /setProperty\("--dshadb-kb"/.test(cli) && /removeProperty\("--dshadb-kb"\)/.test(cli))
a('监听 visualViewport 的 resize + scroll (键盘弹出/收起/偏移都覆盖)',
  /vv\.addEventListener\("resize", schedule\)/.test(cli) && /vv\.addEventListener\("scroll", schedule\)/.test(cli))
a('用 rAF 合并高频 resize (键盘动画期间每帧都来), 且 pending 标记不依赖 rAF 的同步/异步',
  /if \(pending\) return;/.test(cli) && /raf = requestAnimationFrame\(apply\)/.test(cli) &&
  /pending 与 rAF 的同步\/异步无关/.test(cli))
a('插件级注册一次 (三个抽屉共用, 不随抽屉开关反复装卸)',
  /ctx\.effect\(\(\) => installKeyboardInsetVar\(\), "dsh-api-dashboard: 软键盘避让"\)/.test(cli))
a('没有 visualViewport 的环境静默退回 v1.4.2 行为 (不报错、不改变布局)',
  /!window\.visualViewport/.test(cli) && /return \(\) => \{\};/.test(cli))
a('说明了为什么必须自己算 (宿主 viewport meta 没有 interactive-widget)',
  /interactive-widget=resizes-content/.test(cli))

// --- v1.5.0-desktop-preview.5 (报告 §2.8): 居中对话框里的下滑把手 ---
const ptrTier = cli.split('\n').map((l) => l.trim())
  .filter((l) => l.startsWith('@media (min-width:1024px) and (pointer:fine)'))[0] || ''
a('桌面档(精确指针)隐藏下滑把手 (抽屉语汇在对话框里多余)',
  /\.dshadb_handle\{display:none\}/.test(ptrTier))
a('隐藏把手**只**对精确指针生效 —— 触摸的 iPad 横屏(1366×1024)也在这档里, 而看板抽屉没有关闭按钮, 把手是唯一看得见的抓手',
  !/min-height:600px\)[^\n]*dshadb_handle\{display:none\}/.test(cli) && /pointer:fine\)\{\.dshadb_handle\{display:none\}/.test(cli))

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
const { semverCompare, UPDATE_REF, PREVIEW_CHANNEL, assertHostLockFree } = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
a('semverCompare: 预发行版本号仍能比较 (1.5.0-… > 1.4.2)',
  semverCompare('1.5.0-desktop-preview.1', '1.4.2') === 1)
a('semverCompare: 预发行 < 同版本号的正式版 (semver §11, 否则预览版会被当成"已是最新")',
  semverCompare('1.5.0-desktop-preview.1', '1.5.0') === -1)

// --- v1.5.0-desktop-preview.4: 预览频道自更新 ---
// 「预览版能不能更新到新预览版」当年的两个拦路虎:
//   ① 比较函数忽略预发布后缀 → preview.3 与 preview.2 比出来是 0 → 永远"已是最新";
//   ② 更新源写死 main + 客户端一刀切禁用按钮 → 用户只能重跑 install.sh。
// 这里把两条都钉住: 顺序要对, 频道要来自 package.json 的 dsh.updateRef。
a('semverCompare: 同一基线的预发布按 .N 递增 (preview.3 > preview.2)',
  semverCompare('1.5.0-desktop-preview.3', '1.5.0-desktop-preview.2') === 1)
a('semverCompare: 预发布的数字标识符按数值比, 不是字典序 (preview.10 > preview.9)',
  semverCompare('1.5.0-desktop-preview.10', '1.5.0-desktop-preview.9') === 1)
a('semverCompare: 字母数字标识符按字典序 (preview.b > preview.a)',
  semverCompare('1.5.0-a.b', '1.5.0-a.a') === 1)
a('semverCompare: 数字标识符 < 字母数字标识符 (1.5.0-1 < 1.5.0-a)',
  semverCompare('1.5.0-1', '1.5.0-a') === -1)
a('semverCompare: 标识符少的那串更小 (1.5.0-a < 1.5.0-a.1)',
  semverCompare('1.5.0-a', '1.5.0-a.1') === -1)
a('semverCompare: 相同版本仍相等 (不误报更新)', semverCompare('1.5.0-preview.4', '1.5.0-preview.4') === 0)
a('semverCompare: 主版本号优先于预发布 (1.6.0-a > 1.5.9)',
  semverCompare('1.6.0-a', '1.5.9') === 1)

// --- v1.5.0-desktop-preview.5 (报告 §2.7): 前导 v ---
// semver.valid('v1.5.0') 为真, 而旧正则 ^(\d+)\.(\d+)\.(\d+) 会把 'v1.5.0' 当成 0.0.0。
// 当前不可达(远端版本取自 package.json.version, 不带 v), 但本仓库 release tag 是带 v 的 ——
// 将来若有人把 tag 名喂进来, 会静默判成"没有更新"。
a('semverCompare: 认前导 v (v1.5.0 == 1.5.0)',
  semverCompare('v1.5.0', '1.5.0') === 0)
a('semverCompare: v1.5.0 > v1.4.2 (带 v 不再退化成 0.0.0)',
  semverCompare('v1.5.0', 'v1.4.2') === 1)
a('semverCompare: 带 v 的预发布也正确 (v1.5.0-preview.5 > v1.5.0-preview.4)',
  semverCompare('v1.5.0-desktop-preview.5', 'v1.5.0-desktop-preview.4') === 1)
a('semverCompare: 带 v 与不带 v 混比一致 (v1.5.0-preview.5 > 1.5.0-preview.4)',
  semverCompare('v1.5.0-desktop-preview.5', '1.5.0-desktop-preview.4') === 1)
a('semverCompare: 前后空白也认 (v 与 trim 一起处理)',
  semverCompare('  v1.5.0  ', '1.5.0') === 0)
a('semverCompare: 大写 V 仍按非法处理 (与 semver 包本身一致, 它的正则只认小写 v)',
  semverCompare('V1.5.0', '0.0.0') === 0 && semverCompare('V1.5.0', '1.5.0') === -1)

a('package.json 声明了更新频道 dsh.updateRef',
  pkg.dsh && pkg.dsh.updateRef === 'preview/desktop', JSON.stringify(pkg.dsh && pkg.dsh.updateRef))
a('服务端从自身 package.json 读频道 (跟着 tarball 走, 不靠状态文件也不猜命名规则)',
  /pkg\?\.dsh\?\.updateRef/.test(src))
a('频道值走白名单校验 (会被拼进 URL 与 codeload 路径)',
  /\^\[A-Za-z0-9\]\[A-Za-z0-9\._\/-\]\{0,99\}\$/.test(src) && /!ref\.includes\('\.\.'\)/.test(src))
a('更新检查与 tarball 都用频道 ref, 不再写死 main',
  /\?ref=\$\{UPDATE_REF\}/.test(src) && /refs\/heads\/\$\{UPDATE_REF\}/.test(src) && !/REPO_BRANCH/.test(src))
a('实测: 这个构建的频道就是预览分支', UPDATE_REF === 'preview/desktop', String(UPDATE_REF))
a('实测: 这个构建判定为「预览频道」(因此允许一键更新)', PREVIEW_CHANNEL === true)
a('实测: 同频道的新预览会被识别为可更新 (preview.5 > preview.4)',
  semverCompare('1.5.0-desktop-preview.5', '1.5.0-desktop-preview.4') > 0)
a('updateRef / previewChannel 下发到客户端 (3 处 config 载荷)',
  (src.match(/updateRef:\s*UPDATE_REF,/g) || []).length === 3 &&
  (src.match(/previewChannel:\s*PREVIEW_CHANNEL,/g) || []).length === 3,
  `${(src.match(/updateRef:\s*UPDATE_REF,/g) || []).length}/${(src.match(/previewChannel:\s*PREVIEW_CHANNEL,/g) || []).length}`)
a('客户端只在「预览版但拿不到频道」时才禁用更新 (两种情形分开)',
  /const previewUpdateLocked = !!\(config && config\.preview && !config\.previewChannel\)/.test(cli))
a('两个更新按钮都用 previewUpdateLocked, 不再用一刀切的 config.preview',
  (cli.match(/previewUpdateLocked/g) || []).length >= 4 && !/disabled:.*\|\| !!\(config && config\.preview\)/.test(cli))
a('面板会告诉用户「更新只在本分支内、不会被正式版覆盖」',
  (cli.match(/"update\.previewChannelHint"\s*:/g) || []).length === 2 && /config\.updateRef/.test(cli))

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
// ④ 预览版的更新边界: **频道内可更新, 但绝不被正式版覆盖**
//    （.1~.3 是一刀切禁用; .4 起改成频道机制 —— 所以这里钉的是「两种情形分开」,
//      以及「一旦没有频道字段就必须退回禁用」这条兜底。）
// ==========================================================================
a('有频道时不禁用「检查更新」(否则预览用户每版都得重跑 install.sh)',
  /disabled: upd\.phase === "checking" \|\| upd\.phase === "installing" \|\| previewUpdateLocked/.test(cli))
a('「一键更新」按钮的显示条件是 hasUpdate **且** 未被锁, 不再看 config.preview',
  /upd\.info\?\.hasUpdate && !previewUpdateLocked/.test(cli))
a('锁的条件必须是「预览版 **且** 没有预览频道」(没有频道才退回禁用兜底)',
  /previewUpdateLocked = !!\(config && config\.preview && !config\.previewChannel\)/.test(cli))
a('面板里说明了两种情形 (不是静默失效)',
  cli.includes('t("update.previewHint")') && cli.includes('t("update.previewChannelHint")') &&
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

// ==========================================================================
// ⑦ v1.5.0-desktop-preview.5 (报告 §2.6): 与宿主插件管理器的互斥 —— **尽力而为**
//   宿主那把锁是 Python 的 fcntl.flock(<DSH_HOME 的父目录>/.dsha-data.lock)
//   (register-builtin-plugins.py 的 operation_lock)。Node 没有 flock API, 插件**无法持有**它,
//   所以只能"交换前探一次"。这里钉的是「探测本身可靠 + 探测失败绝不挡住更新」这两件事。
// ==========================================================================
const os = await import('node:os')
const { spawn, execFileSync } = await import('node:child_process')
a('applyUpdate 在交换前真的调用了预检 (不是只在测试里存在)',
  /^  assertHostLockFree\(\)$/m.test(src))
a('预检从 DSH_HOME 的父目录取锁 (与宿主 operation_lock 的 data_root 一致)',
  /function hostLockPath\(\)/.test(src) && /process\.env\.DSH_HOME \|\| join\(homedir\(\), '\.dsh'\)/.test(src) &&
  /join\(dirname\(dshHome\), '\.dsha-data\.lock'\)/.test(src))
a('说明里写清了这不是真互斥 (Node 没有 flock, 无法持有宿主锁)',
  /Node 没有 flock API/.test(src) && /尽力而为/.test(src) && /毫秒级/.test(src))

const lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dshadb-lock-'))
const lockFile = path.join(lockDir, '.dsha-data.lock')
fs.writeFileSync(lockFile, '')
const tryLock = (p) => { try { assertHostLockFree(p); return '' } catch (e) { return e.message } }
a('锁空闲时放行', tryLock(lockFile) === '')
a('锁文件不存在时放行 (非 DSHA 环境不因为探测失败挡住更新)',
  tryLock(path.join(lockDir, 'nope.lock')) === '')

let hasFlock = true
try { execFileSync('flock', ['--version'], { stdio: 'ignore' }) } catch { hasFlock = false }
if (hasFlock) {
  const holder = spawn('flock', [lockFile, 'sleep', '10'], { stdio: 'ignore' })
  let held = false
  for (let i = 0; i < 100 && !held; i++) {
    try { execFileSync('flock', ['-n', lockFile, 'true'], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 20)) }
    catch (e) { if (e && e.status === 1) held = true }
  }
  a('测试前置: 宿主锁确实被另一个进程占住了', held)
  const msg = tryLock(lockFile)
  a('锁被占时抛错拦截 (提示稍后重试, 而不是硬写坏目录)', /宿主/.test(msg) && /稍后重试/.test(msg), msg)
  holder.kill('SIGKILL')
} else {
  console.log('注意: 本机没有 flock(1), 跳过"锁被占"两条 (探测失败时插件按放行处理, 这是设计)')
}
fs.rmSync(lockDir, { recursive: true, force: true })

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
