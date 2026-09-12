# 更新日志

> 一个版本一行。改动细节看 `git log`；红线与踩坑记录看 [`AGENTS.md`](AGENTS.md)。

## v1.x

- **v1.5.0-desktop-preview.8**（🧪 预发行，非正式版）— 同一根竖线，**去掉 `.7` 那两层多余条件**。
  `.7` 把抑制规则写成 `@media (min-width:1024px) and (pointer:coarse)`，想当 `dsh-web-mobile` 那条 `(max-width:1023px) and (pointer:coarse)` 的补集 —— 但**平板只要报 `pointer:fine`（接了鼠标/触控板、或桌面模式），这条媒体条件就整段不匹配**，和当初漏掉宽屏触屏是同一个坑。
  现在整条规则不再带任何媒体条件，只挂在 `body:has(.dshadb_scrim)` 上：`body:has(.dshadb_scrim) [class*="sidebarCol"]{border-right-color:transparent !important}` —— **只有我们自己的遮罩打开时才动宿主，平时一个像素都不碰**。
  两处写法也一并校正：① 不再设宽度/指针门槛（作用域本来就只由 `:has(.dshadb_scrim)` 决定）；② 用 `border-right-color:transparent` 取代 `.7` 的 `border-right:none` —— 那个简写会连 0.5px 的边框宽度一起去掉，开关面板时侧栏与内容区会有 0.5px 位移，只让颜色透明则几何完全不变。
  补充取证：维护者确认那条线**能拖**、且**面板一关就没有**。宿主框架里全高的竖向 1px 线只有这一条，而它旁边正好压着 8px 全高、`cursor:col-resize` 的 `DragHandle`（`@deepseek-ai/dsh-client-ui-layout/lib/client.js:306`，`margin-left:-4px` 骑在边上）—— 「竖线」与「能拖」落在同一处，两个特征互相印证。「只有面板开着才出现」则来自我们的 `.dshadb_scrim`：`position:fixed` + `inset:0` + `fadein` 动画会提升合成层并重排整页，把那 0.5px 从混合出的淡线吸附成实心 1px；我们打开面板时**不碰**宿主任何布局（不设 `overflow`、不动 `data-sidebar-*`、不加全局 class，已逐条核对）。
  真机验收：**平板横屏**确认竖线消失、且面板关闭后宿主侧栏分隔线照常；另请做一次**竖屏对照**（宽 < 1024 时 `dsh-web-mobile` 本来就杀了这条边框）—— 竖屏下线消失即确认根因是这条随宽度生效的宿主规则。
- **v1.5.0-desktop-preview.7**（🧪 预发行，非正式版）— 平板横屏那条**贯穿竖线**改到正确的层，并撤掉 `.6` 的无效试验。**已被 `.8` 取代**（媒体条件在报 `pointer:fine` 的平板上整段失效，且 `border-right:none` 会带来 0.5px 位移）。
  现象：平板横屏（1238px）打开看板/设置时，面板内部偏左多出一条贯穿灰竖线。**成因不在本插件**：宿主侧栏 `.pI_x6G_sidebarCol` 带 `border-right:.5px solid var(--dsw-alias-border-l3)`，dpr 2.5 下正好占满 1 个物理像素；`dsh-web-mobile` 已经把它杀掉（`border-right:none !important`），但那条规则整段位于 `@media (max-width:1023px) and (pointer:coarse)` —— **手机档杀了、宽屏触屏档漏了**（已在本机 `dsh-web-mobile/lib/client.js:1613` 核对）。
  本版补上缺口：`@media (min-width:1024px) and (pointer:coarse){ body:has(.dshadb_scrim) [class*="sidebarCol"]{border-right:none !important} }` ——
  ① 媒体条件正好是那条 1023px 规则的补集；② `:has(.dshadb_scrim)` 保证**只在我们面板打开时**抑制，平时完全不动宿主界面；③ 桌面鼠标档（`pointer:fine`）保持宿主官方分隔线。
  ⚠️ 同时**撤销 `.6` 的 `contain:paint` 试验**（改的是我们自己的面板内容层，改错了层，无效；且 `contain:paint` 有裁剪浮层的风险）。
  真机视觉效果仍待平板验收：请确认竖线消失、且面板关闭后宿主侧栏分隔线恢复。
- **v1.5.0-desktop-preview.6**（🧪 试验修复，根因未确认）— 仅大屏设置内容层增加绘制隔离，尝试消除面板内部局部灰竖线；不隐藏宿主侧栏边框，不改滚动条、阴影、键盘或锁逻辑。**已被 `.7` 撤销**（改错层，实测无效）。详见 `docs/preview6-experiment.md`。

- **v1.5.0-desktop-preview.5**（🧪 预发行，非正式版）— 响应第三方真机验证报告（对 `preview.4` 逐条复核后：6 条属实、1 条修法无效、1 条在 Node 里做不到真修）：
  **① 软键盘避让**（§2.2，实测键盘 242px、盖住面板 26%）—— 宿主 viewport meta 没有 `interactive-widget=resizes-content`，键盘只收缩 visual viewport、`vh` 与 `position:fixed` 纹丝不动，所以插件自己算：`keyboardInset()` 把键盘高度写进 `:root` 的 `--dshadb-kb`，抽屉档按它抬底、对话框档在**可视区**里重新居中、两处 `max-height` 同步收窄（三个守卫：缩放中不算、差值 < 80px 当噪声、offsetTop 参与计算）。报告只建议改 `max-height` —— 那不够，面板还是贴底边；
  **② 宽而矮的鼠标窗口**（§2.3）两档断点补 `(pointer:fine)` 并列分支：1600×599 原先在 1 像素上从通栏跳成对话框，现在 599/600 同形。安全性来自宿主自己用 `(pointer: coarse)` 认手机（coarse/fine 互斥），触摸设备一律不受影响；
  **③ 内联高度退场**（§2.5）—— 两个抽屉的内联 `maxHeight`（70vh/86vh）改成 `--dshadb-max-h`，桌面档的 `!important` 随之删除（它本来就是为了压内联样式，留着反而挡住 ① 的动态收窄）；
  **④ 居中不再跨规则承重**（§2.4）—— 桌面档自己写一份 `margin:0 auto`，避免哪天有人给 768 档补 `max-width:1023px` 后对话框贴左边缘；
  **⑤ `semverCompare` 认前导 `v`**（§2.7）—— 当前不可达但便宜（仓库 release tag 是带 `v` 的），只认小写以与 semver 包一致；
  **⑥ 对话框档隐藏下滑把手**（§2.8）—— 但**限定 `(pointer:fine)`**：iPad Pro 横屏也落在对话框档，而看板抽屉没有关闭按钮，触摸设备上把手是唯一看得见的抓手；
  **⑦ 与宿主插件管理器互斥（尽力而为）**（§2.6）—— 宿主那把锁是 Python 的 `fcntl.flock`，Node 没有 flock API、无法持有，所以只在交换前探一次，把窗口从整个交换过程缩到毫秒级；探测失败一律放行；
  **⑧ 置顶卡满宽判为设计**（§2.1）—— 报告建议的「包进网格 + `grid-column:1/-1`」跨两列后宽度仍是 692px，现象一条都没消掉，故保持满宽 hero 并把结论写进注释与测试
- **v1.5.0-desktop-preview.4**（🧪 预发行，非正式版）— **预览版可以在预览频道内自更新了**（此前 .1~.3 是一刀切禁用一键更新，于是每发一版都得让用户重跑 `install.sh`）。做法是把「这份代码从哪个 ref 装来的」写进 `package.json` 的 `dsh.updateRef`（本分支 = `preview/desktop`），更新检查与 tarball 下载都跟着它走 —— 于是「能被同频道的新预览更新」与「绝不被 main 的正式版覆盖」同时成立，不靠禁用按钮。同时 **`semverCompare` 补上预发布优先级**（semver §11：`…preview.2 < …preview.3 < …preview.10 < 1.5.0`）—— 旧实现 `split('-')[0]` 把 `preview.3` 和 `preview.2` 比成相等，是「预览版更新不到新预览版」的另一半原因
- **v1.5.0-desktop-preview.3**（🧪 预发行，非正式版）— 响应外部评审四条：① **≥1024px 桌面档**改成**居中对话框**（四角圆角 + 上下留边 + `max-height:min(720px,80vh)`，动画换成纯淡入以避开 transform 与 slideup 冲突；`max-height` 必须 `!important`，因为两个抽屉用内联 `style` 写死了 70vh/86vh）；② 桌面档**面板加宽到 720px、平台卡片排成两列**（560px 单列在 10 寸以上两侧全空；卡片自带的 `margin-bottom:9px` 在网格里归零，否则行距翻倍）；③ 三个抽屉补 **`role="dialog"` + `aria-label`** —— 但**明确不加 `aria-modal="true"`**（手机壳有 46 条以它为前缀的结构性 CSS 会把面板改烂，见 `AGENTS.md`）；④ 去掉 `min()` 里冗余的 `calc()`（lightningcss 规范化后正是 `min(560px, 100vw - 48px)`）。档位对齐宿主手机壳的 `MOBILE_QUERY = max-width:1023px`
- **v1.5.0-desktop-preview.2**（🧪 预发行，非正式版）— 平板覆盖：断点从「只看宽度」改成 **`min-width:768px` + `min-height:600px`**。iPad mini 竖屏(768×1024)、所有平板横竖屏、笔记本与台式都拿到居中 560px 面板；**手机横屏**(844×390 这类宽度过 768 但很矮的视口)被 min-height 挡住，仍走原来的全宽抽屉。正式版仍是 **v1.4.2**
- **v1.5.0-desktop-preview.1**（🧪 预发行，非正式版）— 桌面宽屏适配：设置/看板抽屉在 ≥768px 收成**居中的 560px 面板**（原先横铺整屏），手机端行为与 v1.4.2 完全一致；预览版带醒目横幅标识，且**不参与一键更新**（避免被 main 的正式版覆盖）
- **v1.4.2** — 修复 DeepSeek 余额读错钱包：`balance_infos` 多币种且顺序不保证，旧代码盲取第一条，会把有余额的账户随机显示成「$0.00 · 异常」
- **v1.4.1** — 审计修复：状态文件损坏不再拖死整个 dsh web；一键自更新不再删 `.git`；插件路由补鉴权；冷启动不再阻塞首屏；「1 秒刷新」真正生效；错误路径补出口；UI 居中
- **v1.4.0** — 价格表改原生币种（消灭 ÷7 错价）；会话消耗漏计与「前缀吞模型」修复；子代理消耗可见；DSH 中转站自动入列
- **v1.3.3** — 修复「一键更新」按钮无响应（DSHA webview 拦截 `window.confirm`）
- **v1.3.2** — 海外模型可独立选计价货币（修 ¥1285 被读成 $1285）；混合币种两段显示、不折算
- **v1.2.6** — 智谱四类账户分流固化 + 套餐用户回归测试
- **v1.2.5** — 智谱按量付费改为中性「未开放」，不再标红
- **v1.2.4** — 透传接口业务错误消息，不再笼统报「无法解析」
- **v1.2.3** — 修复 `glm-5.3-flash` 缓存读价误标（长会话估算虚高约 5 倍）
- **v1.2.2** — 豆包 / 混元换官方品牌图标
- **v1.2.1** — 三处面板支持把手下滑关闭；豆包 / 混元入列模型品牌分组
- **v1.2.0** — 价格表扩充（仅采纳无分歧条目）；修正 `claude-opus-5` 缓存价
- **v1.1.3** — 开源化改造：provider 官方/中转三层判定；承接 28 项 bug 修复；新增无余额模型品牌分组
- **v1.1.2** — 大肥鱼交互打磨：独立设置页签、停手 3 秒缩回、气泡避让、吸附收窄到左右边缘
- **v1.1.0** — 🐋 新增「收养大肥鱼」互动挂件（可拖拽 / 吸附 / 台词 / 音效，纯娱乐）
- **v1.0.3** — 文档更新，无功能变更
- **v1.0.2** — 余额字段存在性校验；智谱配额解析重写；价格表更新
- **v1.0.0** — 正式版：改名「哦鲸鲸」、自定义图标、全量 UI 改版

## v0.x

- **v0.7.x** — 玻璃 UI 改造；负余额红显；新增 `AGENTS.md`
- **v0.6.x** — 内置检查更新 + 一键自更新；修复设置页签被轮询拽回
- **v0.5.x** — 手机端性能适配（去 backdrop-filter、ETag 协商缓存）；峰谷价格卡；详情页重设计
- **v0.4.x** — 余额告警通知；自定义模型余额；配置持久化；三色阈值；分组动画
- **v0.3.0** — 完整三层 UI、国内外分组
- **v0.2.x** — 最初版本；DeepSeek 峰谷计费
