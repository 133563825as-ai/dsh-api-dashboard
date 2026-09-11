# 发布流程（维护者）

> 从 README 移出：这属于维护者/代理文档，不是使用者要看的。
> 发版前的红线与坑位仍以仓库根目录 [`AGENTS.md`](../AGENTS.md) 为准。

## 发布方式（维护者）

npm 发布走 **Trusted Publishing (OIDC)**，仓库内不存任何 token：

```sh
# package.json 版本改好并提交后
git tag v1.3.2 && git push origin v1.3.2
```

`.github/workflows/publish.yml` 会校验「tag 与 package.json 版本一致」「dependencies 为空」
「语法」「全套测试全绿」，全过才发布，并附带 provenance 溯源。
首次使用需先在 npm 网页把本仓库配成 Trusted Publisher（详见该 workflow 顶部注释）。

v1.3.3 — **修复「一键更新」按钮无响应**（DSHA webview 拦截 `window.confirm` 导致点击后函数在第一行 return）：去掉确认弹窗，直接执行安装；更新结果改为醒目横幅（成功绿底/失败红底），不再只显示 11px 灰色字；`already up to date` 返回 200 而非 500

v1.3.4 — **DeepSeek 价格表对齐官方 2026-09-10 调价 + 模型名收敛**（对照 [官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) 与 `GET https://api.deepseek.com/models` 实测）：① **Flash 系列降价 60%** —— `deepseek-flash` 高峰 ¥2/¥8、空闲 ¥1/¥4（原 ¥3/¥9、¥1.5/¥4.5），**USD 表同步改为官方直发价**高峰 $0.3/$1.2、空闲 $0.15/$0.6（此前 USD 是 ÷7 近似，官方实际口径约 1 USD ≈ 6.67 CNY，差距不小）；`deepseek-v4-pro` 价未变动（¥9/¥27、¥4.5/¥13.5）。② **模型名收敛** —— 官方现役仅 `deepseek-flash` / `deepseek-v4-pro`（与 `/models` 返回一致），旧名 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 仍可调用但由 V4.1-Flash 服务、按 Flash 价计费，解析层统一映射到 flash 档（故价格卡不再单列旧名）；官方公告 2026-09-14 12:00 后 `deepseek-v4-pro` 请求将全部路由到 V4.1-Flash 并按 Flash 价计费。③ 新增 7 条 DeepSeek 回归断言（新旧名同价、chat/reasoner 不被劫持、缓存读低于输入价）。④ **通用价格表按用户自持中转站实时 `/v1/models` 报价校正**（tokenrhythm / mhsapi 等多平台交叉比对；国内厂商 CNY 价 ÷7 入 USD 基准）：**新增 7 个模型** —— `glm-5.3` / `glm-5.1`（¥8/¥28）、`kimi-k2.7-code`（¥6.5/¥27）、`seed-2.1-turbo` / `seed-2.1-pro`（¥3/¥15、¥6/¥30）、`minimax-m2.7`（¥2.1/¥8.4，无缓存报价→`cacheHit=cacheMiss`）、`longcat-2.0`（¥5/¥20）；**修正 5 处偏差 + 1 处缓存读** —— `glm-5.2`（¥9.8/¥30.8→¥8/¥28）、`glm-5.3-flash`（¥1.05/¥3.5→¥0.8/¥2.8）、`qwen3.8-flash`、`qwen3.8-27b`（输出虚高 43%）、`kimi-k2.6`，另 `qwen3.8-max` 缓存读 1.71→0.2143（实时 ¥1.5，原值缺缓存折扣）；`qwen3.7-max`（5 折促销）与 `qwen3.7-flash`（0-32k 档）保留原值并注明实时报价差异，待官方分档核实。⑤ 🔴 **修复小米 MiMo 系「除两次 7」严重错价** —— `mimo-v2.5` / `mimo-v2.5-pro` 原值（0.020/0.041、0.061/0.122）是把官方 ¥1/¥2、¥3/¥6 **又除了一次 7** 的结果，面板把 MiMo 消耗少算成实际的 **1/7**；经中转站实时报价（mimo-v2.5-pro ¥3/¥6）交叉印证后修正为 0.1429/0.2857 与 0.4286/0.8571。⑥ `DOMESTIC_MODEL_PREFIXES` 补 `seed-` / `longcat`（产地判定），`modelToPlatform` 补 `seed-*` → 豆包映射。全套 10 文件 **208 断言**

v1.4.0 — **原生币种价格表 + 一批准确性/事件语义修复 + 子代理消耗可见 + 设置界面控件统一 + 大肥鱼挂件与状态条三处交互修复**（本轮把各厂商官方定价页抓了原文逐条复核：DeepSeek 中英双页、`platform.kimi.com`、`platform.minimaxi.com`、`platform.stepfun.com`、`docs.bigmodel.cn`、`help.aliyun.com`（百炼）、小米 MiMo 官方降价公告）：

① 💱 **价格表不再统一存 USD 基准，改为按「模型原生币种」存储** —— 国内厂商官方页是 CNY 就直接写 CNY 原值，海外是 USD 就写 USD 原值（币种由 `modelRegion` 判定，见新增导出 `nativeCurrencyOf`）。**这从结构上消灭了「÷7 又 ×7」这一类错价**：MiMo 与 glm-4-plus 两次事故都是同一个成因。同时 `overseasCurrency` 默认值由 `'follow'` 改为 `'USD'`，即**国内用国内价（CNY）、海外用海外价（USD）**，默认配置下两边都不做任何换算（想要 v1.2.x 的老行为，显式设成 `'follow'` 即可）。

② 🔴 **修复「历史/参考」段整段被高估 7 倍** —— 该段国内条目历来填的就是官方 **CNY 原值**，在旧的 USD 基准口径下被又 ×7 了一次。已核对样本：`glm-4-plus` ¥2.5/¥5/¥5（旧显示 ¥17.5/¥35/¥35）、`qwen-plus` ¥0.8/¥2、`qwen-turbo` ¥0.3/¥0.6、`qwen2.5-72b` ¥4/¥12 均与官方页逐项吻合。另修 `qwen-max`（官方现价 ¥2.4/¥9.6，旧值 20/60 是远古价）。

③ **按官方页修正现役模型错价**：`glm-5-turbo`（旧值两档都不符 → ≥32K 档 ¥7/¥26/¥1.8）、`kimi-k2.6` 缓存读（误抄 k2.7-code 的 ¥1.3 → 官方 ¥1.1）、`kimi-k3`（全线 +5% → ¥2/¥20/¥100）、`minimax-m2.7` 缓存读（**旧值拿 cacheMiss ¥2.1 顶替，长会话高估 5 倍** → 官方 ¥0.42，同 AGENTS.md 红线 4）、`qwen3.7-max`（删掉查无实据的 5 折值 → 官方 ¥12/¥36）、`qwen3.7-plus`（官方限时 8 折 ¥1.6/¥6.4）、`qwen3.7-flash`（→ 官方 ¥0.2/¥0.8）、`qwen3.8-27b` 缓存读（→ 10% 规则 ¥0.3）。新增 `kimi-k2.7-code-highspeed`、`minimax-m2.7-highspeed`。历史 Claude 缓存读由 50%（OpenAI 口径）改为 10%、Gemini 改为 25%。

④ 🐛 **前缀兜底会吞掉未收录模型** —— 旧实现「取最长前缀」只保证同族内选最长，实测 `gpt-4.1` / `gpt-4.5-preview` 被 `gpt-4` 键吞掉（$15/$30/$60，真价 $0.40/$1.60，**输出虚高约 37 倍**）、`gemini-2.5-flash-lite` 被 `gemini-2.5-flash` 吞掉。改为只接受「安全后缀」（日期/版本/`-latest`/`-preview`/`-exp`），其余落 `defaultPrices`。

⑤ 🐛 **会话消耗漏计重试/失败尝试的 token**（会直接少算钱）—— 旧代码读的 `assistant/chunk` **不在框架 `KNOWN_SESSION_EVENT_TYPES` 里**，是死分支；真正带用量的 `assistant/attempt`（失败/重试/取消的尝试）完全没处理，且 `llm/retry-started` 未清空替换槽位 → 重试时第二次上报**替换**而非累加。已按 `dsh-token-meter` 的 `usage-projection` 语义对齐（实测：20 万 token 的失败尝试原先记为 $0）。

⑥ 🐛 **余额解析红线修复**：`kimi` 曾把「套餐窗口上限」当余额下发（客户端只看 `total`）→ **配额耗尽仍显示满额 + 绿灯**，改为 `total = remaining`；`glm` 兜底曾把「限流填充度」当余额且方向相反（88% 已用 → 判「绿灯余额充足」），改为返回 `null` 走「未开放」；`openrouter` 守卫由 `&&` 改 `||`（只缺 `total_credits` 时会伪造**负数余额**）；`deepseek` 补 `total_balance` 存在性校验。

⑦ 🐛 **`computeProviderKinds` 不再按 provider 名字猜「官方直连」** —— 该兜底与 AGENTS.md 铁律 9（没写 baseURL 的 provider 不表态、交 `-official` 后缀兜底）冲突，会把同名中转站会话顶上官方余额。客户端抽屉文案硬编码的「· 配额正常」也改为按三色灯 `level` 取标签（原先 GLM 配额耗尽会显示成「…已用完 · 配额正常」）。

⑧ 🆕 **子代理（subagent）消耗现在能看到** —— 此前投影只折叠**本会话**的事件，而子代理跑在自己的子会话里，它烧的 token 完全不在主板数字里。现在输入框下方的主状态条**下面换行**多出一行子代理胶囊，**按创建顺序从左到右**排列（顺序取自父会话的 `subagentCatalog` 投影，即父会话里的 catalog 事件顺序，客户端不重排）。
   金额是「该子代理 **+ 其后代**」的向上汇总（孙代理并进它的直接父代理那一条，深度封顶 4 层、行数封顶 12 条），计价口径与主板数字**完全同一套函数**（`summarize`），因此峰谷、原生币种、缓存读写分桶全部一致；子代理用海外模型时按原生 `$` 显示，不折算合并。
   ⚠️ **主板数字仍是「本会话」**，不含子代理 —— 两者分开展示，避免一个数字混了两种口径。

⑨ 🐛 **修掉一个会让新默认值对老用户失效的坑**：配置持久化在 `~/.dsh/dsh-api-dashboard.json`，老状态文件里写着 `"overseasCurrency": "follow"`（那是**旧默认值**被存下来的，不是用户的显式选择），会把 ① 里的新默认值 `'USD'` 钉死。已引入状态文件结构版本 `configVersion` 并在加载时迁移（1 → 2）：把旧默认值改写成 `'USD'`；迁移后用户再手动选 `follow` 会被正常尊重。

⑩ 🐛 **修掉子代理显示 `~—`**（⑧ 的实测缺陷）：子代理跑完就**由热转冷** —— 框架的 `SubagentListEntry.activity` 只有 `'running' | 'inactive'`，**`inactive` = 只存在于持久化里**，此时它已不在 `ctx.sessions` 的常驻表里，`sessions.get()` 取不到 → 读不到消耗 → 面板显示 `~—`。
   已加**冷路径兜底**：同步读持久化投影缓存 `storages/session_projcache/sessions/<id>.json`（形状取自实测）。热路径仍优先（更新鲜），冷路径只在热路径拿不到数据时启用，带 3 秒 TTL 内存缓存，避免每次投影变化都读盘。
   ✅ 用本机真实缓存验证：同一个子代理从 `~—` 变成 **`~¥0.588`**（13.7 万未缓存输入 + 974 万缓存读 + 6.4 万输出，deepseek-flash）。
   ⚠️ 为什么不用框架自己的 `listChildren()`：它走投影缓存读、能处理冷会话，但是 **async**，而投影的 `view()` 契约要求**同步**。

⑪ 🎨 **设置界面控件统一**（此前用的是浏览器默认控件，与整体风格不搭；**只动外观、不动结构**）：去掉 `<select>` 的系统外观换自绘箭头（`.dshadb_field_select`）、去掉数字框的系统上下箭头、滑块由「只设 accent-color」改为自绘轨道 + 滑块，并**补齐深色模式** —— 设置面板的输入框/开关/Tab、状态条、子代理胶囊此前**一律硬编码白底**（深色模式下就是一块白）。
   ⚠️ 曾把「计价货币」「海外模型计价」这几处 2~3 选项的 `<select>` 换成插件自己的分段按钮（`.dshadb_segbtn`）—— 在 2 列网格里「人民币」被截成「人民…」，**观感反而更差**（用户原话「还不如不改」），**已回退成 `<select>`**。教训：**窄容器里优先保证文字完整**，改控件外观前先确认最长的那个文案放得下。

⑫ 🎨 **子代理那一行：固定单行 + 横向滑动 + 长按详情浮层**
   - 原先自动换行，子代理一多（比如 4 个）会把输入框往上顶。现在 `flex-wrap:nowrap` + `overflow-x:auto`（隐藏滚动条）+ 名字截断到 72px，**无论几个子代理都只占一行约 20px**。
   - 完整名字/模型/精确金额**不再依赖 `title`** —— 手机上 `title` 根本不显示，长按弹的是系统「选择/复制」菜单（用户实测反馈「长按只能复制」）。改为 `pointerdown` 计时器（420ms，位移 >8px 取消）弹 `.dshadb_subtip` 浮层，配 `user-select:none` + `-webkit-touch-callout:none` 压掉系统菜单；浮层挂 `document.body`（挂在胶囊里会被 `.dshadb_subs` 的 `overflow-x:auto` 裁掉），点别处/滚动/5 秒自动收起。完整详情同时写进 `data-tip`（浮层读它，也是单测抓手）。

> ⚠️ **未取到官方原文的条目已在代码注释里逐条标注「未核实」**：豆包 Seed 2.0 全系、腾讯混元、`kimi-k2.5`、`moonshot-v1-*`、`step-1-*` 与 DeepSeek 已退役的三条占位价（本轮按 `×7` 保号迁移，仅保证显示值不跳变）。海外三家（OpenAI / Anthropic / Gemini）官方定价页在容器环境被 403 / 地域封锁，亦未复核。

> 🔎 **「自动判定」现在是真的了**（完整实测结论见 `AGENTS.md` 第六节）。原先半真半假：**provider 官方/中转判定、API Key 发现、端点/格式探测都是真的，但「平台余额清单是硬编码的」—— 插件根本不认 DSH 的 provider 列表**。本轮补齐了这块（见 ⑬）。仍**故意**保留的一处「不自动」：没写 `baseURL` 的 provider 一律不表态、按中转站显示「—」—— 这是铁律 9 的设计（内置目录指向官方域名 ≠ 用户的 key 来自官方，`xiaomi` 就是反例），不是 bug，也别去「修」。

⑬ 🆕 **「自动判定」补上最后一块短板：插件开始读 DSH 的 `settings.yaml` provider 列表** —— 此前插件只查自己的 `customRelays`，用户在 DSH 里配好的中转站**一个都查不到余额**，必须在插件设置里手抄一遍 baseUrl + key（这是整个插件最大的体验断点）。
   现在服务端直接解析 `llm-pi-ai.providers.<name>` 的 `baseURL` + `apiKeyEnv`，**自动合成中转站条目**并纳入轮询；key 走与预设平台**同一套三层兜底**（环境变量 → DSH `credentials` 服务 → `~/.dsh/.credentials.yaml` 的 `refs:`）。三个过滤条件都对应既有铁律：**没写 `baseURL` 的跳过**（铁律 9 不表态）、**判成 official 的跳过**（官方直连归预设平台管，别重复成一条中转站）、**用户关掉的跳过**。与手填的 `customRelays` 合并时**手填优先**（同 id 或同 `baseUrl` 不重复查）。
   设置面板新增「来自 DSH 的中转站（自动）」区块：**默认全部启用、每个可单独关**，关掉的记进状态文件 `dshProviderOptOut`，下次自动发现**不会再打开**；官方直连与没写 baseURL 的只展示不可开。下发给客户端的只有名字/baseURL/开关状态，**绝不含 key**。
   ✅ 本机实测（8 个 provider）：自动发现 5 条中转站（`dshzuoxhe` / `jiyuan` / `jiyuanlvdong` / `mimov` / `new`），`zhipu` 因判为 official 跳过，`xiaomi` / `opencode` 因没写 baseURL 跳过 —— 与铁律 9 的设计完全一致。
   🔧 顺带把 `settings.yaml` 的解析抽成通用取值器 `collectProviderFields`（原先只取 `baseURL` 一个字段），`parseProviderBaseURLs` 的返回语义**保持不变**（有回归断言盯着），新增 `parseProviderEntries` 与纯函数 `selectDshProviders`（过滤规则可单测）。

⑭ 🐛/🎨 **四项实测反馈修复**

   ① 🐛 **在自己面板里横滑，会被手机壳判成「开侧边栏」** —— 调大肥鱼的「身体大小 / 探出多少」滑块时，侧边栏会被拉出来（维护者两次反馈「滑动的时候容易把侧边栏拉过来」）。
   **真根因（读 `dsh-web-mobile` 源码确认，不是挂件抢触摸）**：手机壳插件 `dsh-web-mobile` 的 `sidebar-swipe` 手势层在 **document 捕获阶段**吃 `pointerdown` —— 起手点在**屏幕左侧 45%** 以内（`START_ZONE_RATIO = 0.45`）且横向位移占优（`LOCK_PX = 8`），就判成「左边缘滑入打开侧边栏」。滑块在左半屏起手往右拖，正好全中；捕获阶段**先于**我们的监听器，插件里拦不住。
   修法：它的 `beginStroke` 留了一条**让路规则** —— 起手元素若属于「真·横向滚动容器」（`overflow-x` 为 `auto/scroll` 且 `scrollWidth > clientWidth + 1`）就直接放弃识别。于是给遮罩 `.dshadb_scrim` 补 **2px 不可见横向溢出**（由 0 高度的 `.dshadb_swipeguard` 提供），让整块面板都落进让路条件。抽屉自身是 `position:fixed`，遮罩滚动**不会**移动面板 —— 视觉与布局零影响。
   ⚠️ **别想着改用 `aria-modal="true"` 去命中另一条让路规则**（`modalOpen()`）：手机壳把 `[aria-modal="true"]` 当自家对话框，用 `[class*="_header"]` / `[class*="_row"]` / `[class*="_section"]` / `[class*="_tabs"]` 这类**子串选择器**重排里面的元素，而 `dshadb_header` / `dshadb_settings_row` / `dshadb_settings_section` / `dshadb_tabs` 全都会命中 —— 面板会被改烂。
   🛡️ 同时**保留挂件锁**（`.dshadb-whale-locked`，`overlayOpen` 时 `pointer-events:none`）作为加固：挂件是 `body` 的直接子元素（`z-index:9600`），面板嵌在 DSH 的 composer dock 里 —— 面板一旦被某个祖先关进更低的层叠上下文，挂件就会盖在面板上抢触摸。**只关交互、不隐藏**（调大小时要看实时预览），`onDown` 里再兜一道。顺带把滑块触摸区 24px → **34px**、圆点 20→24px。

   ② ⚡ **首屏/切回前台不再阻塞**（用户反馈「切掉后台重新进来，插件加载有点慢」）。根因在服务端：客户端首屏和 `visibilitychange` 都走 `force=1`，而那条路底下是 `await refreshAll()` —— 一次全量轮询要等**最慢**的端点，最长能拖满 `timeoutMs`（默认 8s）。
   现在新增 `?stale=1`（stale-while-revalidate）：**有缓存就立刻回旧数据，刷新丢后台**，由下一次轮询把新数据带上来；只有「服务端刚重启、缓存为空」时才真的需要等（那时确实没东西可显示）。显式强刷（手动刷新按钮、保存设置后）仍然阻塞等新数据。取数策略抽成纯函数 `planBalancesFetch`（`wait`/`background`/`none`）并单独回归 —— 这策略太容易被顺手改回阻塞式。
   ℹ️ 另一半原因是 **DSH 自己的行为**：应用切回前台时 webview 可能整页重载，所有插件都要重新 init，这一段不归插件管。

   ③ 🎨 **刷新间隔下限 5 秒 → 1 秒**（用户要求）。客户端输入框 `min`/`step` 与轮询接受阈值、服务端 `clampRefreshSec` 三处一起改；上限仍是 60 秒。
   ⚠️ 1 秒会把请求量放大 5 倍，**平台接口可能有速率限制**；插件本身已有 2 秒强刷节流兜底，但建议只在自己可控的中转站上用 1 秒。

   ④ 🎨 **「来自 DSH 的中转站」列表收进折叠层**（维护者要求「跟首页一样的折叠方法」）—— 直接复用首页的分组组件 `GroupSection`（表头 + 条数 + 箭头 + `max-height` 过渡），**默认收起**，点开才看到各条中转站与开关。
   ⚠️ 上一轮曾误把「自动判定结果」折叠起来，维护者澄清「那个不需要改，应该折叠的是来自 DSH 中转站下面的那一罗列」—— 已改回平铺，`.dshadb_kinds_head` 样式与 `showKinds` 状态一并删掉。

⑯ 🐛 **大肥鱼挂件两处交互修复**（维护者实测反馈）

   ① **台词气泡压在头顶** —— 素材 `DSniang1.png` 是 610×610，不透明像素从 `y=10` 就开始（头顶呆毛几乎顶到画布上沿），而 `object-fit:contain` 在正方形盒子里等于铺满，所以**盒子顶 ≈ 呆毛顶**。原 `bottom:calc(100% - 6px)` 让气泡**下沿落进盒顶往下 6px**，尾巴（`::after` 再 8px）扎到 14px —— 鱼只有 64.8px（scale 0.6）时那是整条鱼的 **21%**，看着就是顶在头上。
   已改为 `bottom:calc(100% + 6px)`：气泡与尾巴整体移到盒子上方，**尾尖正好点在呆毛尖端**；下方兜底分支同步改为 `top:calc(100% + 6px)`，上下对称。翻转阈值 `r.top - bh - 6` 本来就是这个口径，**JS 一行没动**。

   ② **在鱼身上往右拖会被手机壳判成「开侧边栏」** —— 与 ⑭① 是**同一条**手势层，但挂件本体此前**完全没有守卫**（⑭① 只覆盖了我们自己的面板）。
   复现位置是**鱼停在屏幕左侧 45% 以内时**（典型 = 左边缘吸附位）：按本机 360px 视口、scale 0.6 的 64.8px 鱼算，贴左边时可见区 ≈ `x∈[0,32]`，正落在识别带 `[0,162]` 里；贴右边时 ≈ `x∈[328,360]`，**不会**被判定。（维护者先报「从右往左滑」，核实后更正为「从左往右滑」—— 与源码规则 `if (dx <= 0) return 'none'` 一致，也印证了根因。）
   ⚠️ 挂件自己的拖拽**同时也照常执行**（捕获阶段只判手势、不拦事件），所以现象是「鱼被拖走了 + 抽屉也被拉出来」。
   修法：在 `.dshadb-whale-body` **内部**垫一层透明抓取层 `.dshadb-whale-grab`（`overflow-x:auto` + 0 高度 `width:calc(100% + 2px)` 守卫子元素 + `touch-action:none` + 隐藏滚动条），起手点落在它身上 → 手机壳的 `findHorizontalScroller` 命中 → 放弃识别。
   ⚠️ 挂在 body **内部**（不是 root 下）是为了让 `pointerdown` 照常冒泡到 body 上已有的拖拽处理器 —— **拖拽逻辑一行未改**；挂 root 下同样能让路，但鱼也拖不动了。
   ⚠️ `touch-action:none` 必须写在这一层：滚动容器是浏览器判定可触摸行为的终点，漏了它横向 pan 会被这个滚动容器自己抢走（`pointercancel`）→ 鱼直接拖不动。
   ⚠️ 别改成直接给 `.dshadb-whale-body` 加 `overflow` —— 那会把它里面 `img` 的 `drop-shadow` 裁掉，鱼会显平。另：`pointer-events` **不是「继承即锁」**，抓取层自己写了 `auto`，所以 `.dshadb-whale-locked` 必须**单独**把抓取层也锁上。
   代价：鱼压在左边缘时，它盖住的那 ~32×65px 不能再作为「左边缘开抽屉」的起手点（与面板守卫同一取舍，把鱼拖走即可）。

   ③ **冷启动「抽搐一下」**（维护者反馈「每次重启首次进入界面时会抽搐一下」，后更正为「打开设置界面才抖动」）—— **真机埋点定位出来的**，不是猜的：用 `PerformanceObserver({type:'layout-shift', buffered:true})` 的 attribution 直接点名「哪个节点位移了多少」，并把「打开设置面板」那一刻的时间点一起上报，真机（360×754、dpr=4）拿到三条位移：
   - `div.uV2eYG_scroll` [0,0,0,0]→[16,580,322,36]，**CLS 0.01725** —— 外壳自己的会话滚动容器首帧，**不归我们**；
   - `span.dshadb_barwrap` 124×26 → 230×**28**，CLS 0.00094+0.00053 —— 钱数/平台名进来时**状态条高了 2px**，把上面的会话区顶了一下；
   - `div.dshadb-whale-grab` **[306,467,54,108] → [327,160,33,65]**，**CLS 0.01193** —— **挂件往上跳 307px 且从 108px 缩到 65px**，这是我们这边最大的一笔。
   两个成因与修法：
   - **挂件**：`ensureWhaleWidget()` 先用默认值（`scale=1` → 108px、贴右边、`top=62%` 屏高）画出来，等 `/whale/settings` 回来才改成保存值 → 那一帧默认值被用户看见，紧接着就是硬跳（`transition` 此刻还是 `none`，所以是跳不是滑）。改为**首帧 `visibility:hidden`**、设置到位才 `reveal()`（幂等；成功/失败/提前 return **三条分支都接** `.then(reveal)`，另有 **2s 兜底**，否则请求异常会让鱼永远不出现）。真机那笔 0.01193 就是从这里来的。
     ⚠️ **为什么它看起来像「打开设置界面才抖」**：`whaleEnabled` 搭在 `/api-dashboard/balances` 响应的 `config` 里，而服务端对「刚重启、无缓存」的 `?stale=1` 仍走 `wait` → `await refreshAll()`（最长 8s）→ 冷启动时配置 **~10s** 才到，挂件那时才被创建、随即跳一下；用户正好在那几秒里开着设置面板看，就归因到了设置面板上。真机时间线：`settings-opened` t=8357 → `whale-created` t=10394 → `whale-settings-applied` t=10433 → 位移 t=10908。
     ℹ️ 另外顺手否掉了一个**看似合理但错的**假设：设置面板自己「先空壳后填充」（`relays:[]`/`dshProviders:[]`/`wf.scale=1` 起手，两个接口回来才填）**并不会**造成位移 —— 抽屉是 `position:fixed` + `max-height:86vh`，高度五次采样全是 648（=0.86×754），内容在内部滚动，所以它不登记 layout-shift。（首次打开那两个请求很慢：3 秒内没回来；暖了之后 35ms。）
   - **状态条**：空态内容 18px、有数据态 20px → 26px 变 28px。给 `.dshadb_bar` 加 `min-height:28px;box-sizing:border-box`（28 = 有数据态的实测总高，所以有数据时外观不变）。**用 `min-height` 而不是 `height`**：系统字体放大时仍能自然增高，不会裁字。

⑰ 测试由 **10 文件 208 断言**扩到 **15 文件 456 断言**：新增 `test-cost-projection.mjs`（重试/attempt 事件语义）、`test-balance-guards.mjs`（余额红线）、`test-subagents.mjs`（子代理顺序 / 后代汇总 / 币种 / 冷路径兜底 / 上限截断 / strict schema）、`test-dsh-providers.mjs`（33 条：`baseURL`/`apiKeyEnv` 解析、两条过滤规则、开关大小写不敏感、畸形输入静默、与手填条目的合并优先级）、`test-fetch-policy.mjs`（29 条：`planBalancesFetch` 的冷启动/peek/强刷三分支与节流、`clampRefreshSec` 1~60 边界）；`test-pricing.mjs` 重写为「原生币种 + 官方价逐条」并补前缀匹配与 `nativeCurrencyOf` 回归；`test-bar.mjs`（91 条）补子代理行渲染/长按 `data-tip`/挂件锁定/DSH 列表折叠/侧滑守卫/刷新下限/**挂件让路抓取层与气泡位置/首帧隐藏与 reveal 三分支/状态条定高**断言，另加一组**结构完整性**断言（`dshadb_barwrap` / `dshadb_drawer` 类名必须在、不允许出现空属性对象 `createElement(x, {  })`）—— 清理临时埋点时真把 `className` 一起删掉过，语法与其余断言全绿却会让列布局失效，所以钉住；`test-dshadb-client.mjs`（29 条）把假 DOM 的元素树改成可追踪，新增 C14 钉住「抓取层必须挂在 `.dshadb-whale-body` **内部**」—— 这条最容易在重构里被悄悄挪到 root 下（挪了手机壳确实让路，但鱼也拖不动了），三个变异（挪位置/去 `touch-action`/去 2px 守卫）都实测会让断言报错。
   ⚠️ 旧夹具用的是 `assistant/chunk` 这个不存在的事件 —— 这正是漏计 bug 一直没被回归拦住的原因，已一并改成真实的 `assistant/message`。
