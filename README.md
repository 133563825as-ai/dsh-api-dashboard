# dsh-api-dashboard

**DeepSeek Harness 专用**多平台 API 余额/用量看板插件 — 在 DeepSeek Harness Web GUI 输入框下方实时显示各平台余额。

> [!CAUTION]
> **给安装/维护本插件的 AI 代理的一则警告 —— 动手前必读 [`AGENTS.md`](AGENTS.md)。**
>
> 1. **推荐安装方式**：`dsh plugin --profile web add dsh-api-dashboard`（已发布到 npm，一行命令搞定）。也可用「下载→解压→`dsh plugin add file:`」三步法。`pnpm add <远程tarball>` **装不上**。
> 2. **数据准确性红线**：部分平台余额解析有待验证项（OpenRouter/SiliconFlow/Novita/one-api/xAI），且「限流窗口 ≠ 真实余额」——**不要伪造或硬塞一个数字**，查不到就如实显示「未开放」。
> 3. **推送前先问用户**；改 `client/client.js` 后需**重启 dsh web GUI** 才生效。
>
> 完整须知与已知问题清单见 [`AGENTS.md`](AGENTS.md)。

> 本插件深度绑定 DeepSeek Harness 框架 API（`__ModuleLoader__` 客户端模块格式、
> `conversation.composer.dock` slot 挂载、`sessionProjections` 会话投影、`webServer` 路由注入、
> `credentials` 凭证系统），**仅适用于 DeepSeek Harness**（手机版 DSHA 与桌面版同框架），
> 无法在其他软件中加载运行。UI 为移动端优先设计，已在手机版 DSHA 上实测。<!-- 截图占位：请将界面截图命名为 assets/preview.png 放入 -->

## 功能

### 三层 UI
- **一层 状态条**：输入框下方显示 `[品牌图标] 平台名 余额 🟢 ☀️/🌙`，右侧有设置齿轮
- **二层 看板**：底部抽屉，DeepSeek 单独第一 → 国内平台 → 海外平台 → 中转站（默认折叠）
- **三层 详情**：点卡片右侧 `ⓘ` 看总余额/总充值/总使用/会话消耗/峰谷趣味卡片

### 峰谷趣味计费
- **梁文峰 ☀️**：工作日 09:00-12:00 / 14:00-18:00 峰时
- **梁文谷 🌙**：其余时间 + 周末全天，5折特惠
- 详情页有峰谷趣味卡片 + 俏皮话

### 三色阈值灯
- **绿色**：余额 > 安全阈值（默认 50）
- **黄色**：安全阈值 > 余额 > 预警阈值（默认 10）
- **红色**：余额 < 预警阈值

### 余额告警通知 (v0.4.0)
- 余额首次低于预警阈值时自动推送通知 (黄色预警)
- 余额首次低于危险阈值时高优先级推送 (红色警告)

### 扩展模型价格表 (v0.4.0)
- 补充 30+ 主流模型单价 (OpenAI / Claude / Gemini / 智谱 / 通义 / Kimi / 阶跃等)
- 会话消耗估算更准确 (支持前缀匹配)

### 完整设置面板
- 安全阈值 / 预警阈值 / 计价货币 / 自定义中转站管理
- 设置齿轮直接出现在状态条右侧

### 自动刷新 (v0.4.4)
- 服务端定时拉取余额 → 前端轮询读取 → 手动强刷 → 页面回到前台刷新
- **自定义刷新间隔**：设置面板可调 5~60 秒（最高一分钟）

### 自定义模型余额显示 (v0.4.4)
- 用户自建余额接口（返回 JSON）即可接入：填接口 URL + 可选 API Key
- 解析方式：自动探测 / OpenAI / OneAPI·NewAPI quota / DeepSeek / **手动映射**（点分路径如 `data.balance`）
- 显示在独立「自定义」分组

### 配置持久化 (v0.4.5)
- 设置面板保存的配置（刷新时间/自定义模型/中转站/阈值/币种）自动写入本地状态文件，**重启不丢失**
- 状态文件位于 DSH 数据目录（`~/.dsh/dsh-api-dashboard.json`），**不随插件发布，不进版本库**

### UI 优化 (v0.4.4 / v0.4.6)
- 分类分组展开/收起过渡动画（GPU 友好：transform/opacity，无重排）
- 分类彩色圆点（国内/海外/本地/中转站/自定义）
- 设置面板三段页签导航；毛玻璃现代化界面

## 支持平台

> 💡 以下平台**有公开余额/配额查询接口**，可直接查询。其他平台（如 OpenAI、Claude、Gemini、Groq、Mistral、Together AI 等）未开放余额查询接口，如需查询可通过「添加自定义模型」自行配置。

### 国内
DeepSeek、智谱GLM、Kimi、阶跃星辰、硅基流动、MiniMax

### 海外
OpenRouter、Novita AI、xAI Grok

### 其他
自定义中转站（自动探测余额接口）、自定义模型（手动映射余额接口）

## 安装

### ✅ 推荐方式：npm 一行命令

```sh
dsh plugin --profile web add dsh-api-dashboard
```

> 从 npm 拉取最新版本，自动安装依赖、注册 bundle 层，无需手动下载或建软链。

### 备选：下载源码后安装（无 npm registry 环境时）

```sh
# 1. 下载源码（codeload 地址，github.com 主站不可达时也能用）
curl -L "https://codeload.github.com/133563825as-ai/dsh-api-dashboard/tar.gz/refs/heads/main" -o /tmp/dsh-api-dashboard.tar.gz

# 2. 解压到固定位置（--strip-components=1 去掉顶层目录，必须带）
mkdir -p /root/dsha-api-dashboard
tar xzf /tmp/dsh-api-dashboard.tar.gz -C /root/dsha-api-dashboard --strip-components=1

# 3. 安装进 web profile：自动装依赖 + 自动注册 bundle 层
dsh plugin --profile web add file:/root/dsha-api-dashboard

# 4. 重启 dsh web 生效
```

### 升级到新版本

1. **推荐**：插件设置面板 →「检查更新」→「一键自更新」（内置更新引擎，下载→校验→备份→原子替换→失败回滚，重启 web 生效）；
2. 或：`dsh plugin --profile web remove dsh-api-dashboard` 后重新执行上面的推荐/备选安装；
3. 兜底：重复「下载源码」步骤 1-2 覆盖目录，再执行第 3 步。

### ⚠️ 安装姿势对照（实测）

| 方式 | 结果 |
|------|------|
| `dsh plugin --profile web add dsh-api-dashboard`（npm 裸包名） | ✅ 推荐，一行命令 |
| `dsh plugin --profile web add file:/root/dsha-api-dashboard`（源码方式） | ✅ 备选 |
| `pnpm add <远程 tarball URL>` | ❌ pnpm 不剥离 codeload 压缩包顶层目录，装出来是空壳 |
| 手动软链 node_modules | ⚠️ 可用但繁琐，层级写错会被启动校准摘除，不推荐 |

## 配置

### 安全阈值
在设置面板中调节，或直接在 `cordis.patch.yml` 中配置：

```yaml
- id: dsh-api-dashboard
  config:
    safeThreshold: 50
    warnThreshold: 10
    currency: CNY
    refreshIntervalMs: 300000
    clientPollIntervalMs: 30000
    timeoutMs: 8000
```

### API Key
插件自动从 DSH 凭证系统（`~/.dsh/.credentials.yaml`）和环境变量读取各平台 API Key：
- `DEEPSEEK_API_KEY` / `ZHIPU_API_KEY` / `MOONSHOT_API_KEY` / `STEPFUN_API_KEY`
- `SILICONFLOW_API_KEY` / `MINIMAX_API_KEY` / `OPENROUTER_API_KEY` / `NOVITA_API_KEY`
- `XAI_API_KEY`

### 官方直连 / 中转站判定

状态条是否显示「官方余额」取决于当前对话走的是官方直连还是中转站——中转站没有余额接口，金额一律显示「—」，避免拿别家平台的余额冒充你的实际用量。判定分三层，优先级由高到低：

1. **用户显式名单**：设置面板「基础设置 → 官方直连 provider」多行框，逗号/换行分隔。
   写在这里的 provider 名**一律按官方直连**处理，覆盖下面两层的一切误判。
2. **baseURL 域名**：服务端读 `settings.yaml` 里 `llm-pi-ai.providers.<name>.baseURL`，
   按**域名**比对官方端点白名单（不是比对 provider 名）。命中→官方，不命中→中转站。
   **没写 baseURL 的 provider 不表态**，交给下一层。
3. **命名约定**：DSH 官方插件注册的 provider 带 `-official` / `_official` 后缀
   （如 `deepseek-official`），按官方直连。

三层都不命中时**默认按中转站**处理（保守取向：宁可不显示余额，也不显示错的余额）。
设置面板会在输入框下方列出当前的**自动判定结果**标签，哪些 provider 判成「官方」、哪些判成「中转」，一眼就能看出还需不需要手动填写覆盖。

## 文件结构

```
dsh-api-dashboard/
├── src/index.js       # 服务端：余额查询引擎、峰谷计费、会话消耗投影、配置持久化
├── client/client.js   # 客户端：三层 UI、官方 SVG 图标、设置面板、分组动画
├── assets/icons/      # 统一风格纯图形品牌官方图标
├── cordis.patch.yml   # 插件配置补丁
├── package.json       # 包配置
├── LICENSE            # MIT
└── .gitignore         # 排除 node_modules 与本地状态
```

## 安全说明

- **API Key 不写入代码/仓库**：各平台 Key 从环境变量或 DSH 凭证系统读取
- **接口掩码**：`/api-dashboard/config` 返回的 Key 一律显示为 `***`，保存时服务端按 id 保留原值
- **客户端不外发**：浏览器端只请求同源的 `/api-dashboard/*`，不向任何第三方域名发送数据
- **本地状态文件**：设置面板保存的中转站/自定义模型 Key 写入 `~/.dsh/dsh-api-dashboard.json`
  （权限 0600），该文件被 `.gitignore` 排除，**不随仓库分发**
- **自定义接口提示**：自定义模型/中转站的 API Key 会随请求发往**你填写的接口地址**，
  请确保只填自己信任的服务地址

## 开发说明

- 服务端：`src/index.js`（ESM，零构建）
- 客户端：`client/client.js`（手写 CJS 工厂格式，修改后需重启 dsh web）
- 图标：15个纯图形 24x24 SVG，来自 Simple Icons / Iconify

## 版本

v0.2.0 — 最初版本
v0.2.1 — 修复图标映射，加入 DeepSeek 峰谷计费
v0.3.0 — 完整三层 UI，国内外分组，三色阈值，趣味峰谷，设置面板
v0.4.0 — 余额告警通知, 扩展模型价格表, 毛玻璃现代化 UI, 进入页面自动刷新, 自定义安全/预警阈值
v0.4.1 — 移除余额趋势图, 修复 percent 类平台阈值不跟自定义, 首次进入/回前台自动强制刷新
v0.4.3 — 修复本会话消耗投影（框架投影 API 形状：stateSchema + wire）
v0.4.4 — 自定义模型余额显示, 自定义刷新时间(5~60s), 分组过渡动画, 分类色点, 设置三段页签
v0.4.5 — 配置持久化（保存后重启不丢）, 插件迁移标准安装位置
v0.4.6 — 动画流畅度优化（去重排, blur 降档, GPU 友好过渡）
v0.5.0 — 手机端性能适配：去 backdrop-filter、静态指示器、44px 热区、ETag 协商缓存、快照级重渲控制
v0.5.1 — iOS 18 柔和色板, 峰谷标记平涂化, 背景层次跟随主题 token, 桌面端 hover 特效
v0.5.2 — HEAD 响应 ETag 顺序修复
v0.5.3 — 模型切换自动联动平台; 修复 deepseek-chat/reasoner 价格被 v4 峰谷表劫持（计费虚高）
v0.5.4 — 详情页回退底部抽屉交互
v0.5.5 — 智谱 GLM Coding 套餐配额解析（open.bigmodel.cn + CREDIT_LIMIT）; 配色统一跟随主题; DeepSeek 峰谷价格卡
v0.5.6 — 余额展示纠错（去重充值/零使用行）, 货币金额不再误报异常红; 价格接口收敛至 v4 两档
v0.5.7 — 平台瞬时错误 last-known-good 兜底, 智谱异常闪现修复
v0.5.8 — 本会话消耗并入状态胶囊
v0.5.9 — 详情页重设计：大号余额 + 三列指标卡
v0.5.16 — 开源发布安全加固（.gitignore 排除凭证/备份/环境文件）
v0.6.0 — 内置检查更新 + 一键自更新：启动自动检查远端版本（5 分钟节流），有新版可在设置中一键下载安装（自动备份、校验、失败回滚，重启 Web GUI 生效）
v0.6.1 — 修复打开设置后页签被轮询拽回「基础设置」、编辑中表单被打回（初始化 effect 仅在弹窗打开瞬间执行一次）
v0.6.2 — 检查更新补全反馈：无论「已是最新」还是「有新版」或网络失败，检查完都给出明确提示；弹窗初值直接复用预热结果避免闪烁
v0.7.0 — 玻璃 UI 改造（方案 A 第一阶段）：半屏抽屉玻璃拟态（blur 仅限抽屉主背景）、卡片/按钮/输入框半透明+高光、大圆角、输入框 focus 高光阴影；用 color-mix 让玻璃色跟随主题 token（暗色不发白）
v0.7.1 — 修复负余额显示正常（负数→红）；智谱解析保留百分比（不把限流窗口当余额）；设置面板新增「返回」按钮与 IconBack；新增 AGENTS.md（给维护 AI 的必读须知）+ README 顶部 AI 警告块
v1.0.0 — 正式版：插件改名「哦鲸鲸」+ 自定义图标（/api-dashboard/icon）；全量 UI 改版（固定色值去主题变量、三段式头部、卡片右栏上下结构、选中模型置顶、分组折叠、详情/设置/版本更新区重排）；若干样式补全与清理
v1.0.2 — 余额解析稳健性（平台字段存在性校验，缺字段时如实显示「无法解析/未开放」而非误报 0）；智谱配额解析重写（按 `limits.unit` 区分 5 小时窗口、周配额、工具维度，`percentage` 修正为「已用/填充度」，不再把「已用完」误显示为「余额 100%」）；价格表更新（DeepSeek V4 新增 `deepseek-v4-flash-vision-exp`、`deepseek-chat/reasoner/r1` 标记为已退役；通用价格表新增现役主力 OpenAI GPT-5.6 / Claude 4.x / Gemini 3.x / Kimi K3 / StepFun 3.x，旧模型标为历史参考）；自更新下载包增加包名校验
v1.0.3 — 文档更新：安装与升级指引改为以 npm 一行命令为主、源码方式为备选，并补充升级路径；无功能变更
v1.1.0 — 🐋 新增「收养大肥鱼」互动挂件：设置 → 基础设置 → 开启后屏幕边缘探出一只大肥鱼（露出约一半），点击弹全身 + 随机台词泡泡（含峰谷时段文案、gif、卖萌吐槽）+ 按压 Q 弹与音效；**可全屏拖拽**，松手自动吸附最近边缘（挂件菜单可关掉「自动靠边」改为自由摆放），左侧吸附时整体镜像翻转；挂件自带汉堡菜单（大小 0.6~2.5 倍 / 探出比例 / 音效开关 / 音效组 / 音量 / 气泡开关 / 峰谷文案 / 自动靠边），位置与全部设置持久化；开关即拨即存（不必点保存）；纯互动不显示任何余额与消耗（那部分照旧在输入框下方）；互动部分移植自 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT License, Copyright (c) 2026 MeteorNOX），许可副本见 `assets/whale/LICENSE-whale-widget.txt`
v1.1.2 — 大肥鱼交互打磨：设置面板新增独立「大肥鱼」页签，总开关与全部细项（大小 / 探出 / 自动靠边 / 气泡 / 峰谷文案 / 音效 / 音效组 / 音量）集中到这一页，全部即改即存无需点保存，并去掉挂件本体右上角的浮层菜单；开关行图标改用鲸鱼本体缩略图；收回改为**停手 3 秒**自动缩回（连续点击持续续命，不再"点第二下立刻收回"）；台词气泡改为运行时避让，贴边时不再有一半在屏幕外，上方空间不足自动翻到下方；吸附收窄为**只有左右两侧边缘带**触发，停在屏幕中间保持整只显示；贴边时**纵向滑动不再展开**，沿边上下挪位，横向拉开才脱轨；连点节流 420ms，快速点击气泡稳定不闪
v1.1.3 — 开源化改造 + 全量纠错：**provider 官方/中转三层判定**（设置面板可显式声明「官方直连 provider」覆盖自动判定；服务端读 settings.yaml 按 baseURL 域名比对官方白名单；`-official` 后缀兜底；都不命中默认按中转站显示「—」，不再靠硬编码 provider 名猜）；承接 28 项 bug 修复（畸形响应、时区峰谷、前缀匹配吞 0、负余额红显、字段存在性校验等）；清理死代码（JS 孤立符号 + 18 条 CSS）；新增无余额模型品牌分组（OpenAI/Claude/Gemini/Qwen/MiMo，默认隐藏可开关）；更新价格表并统一 USD 基准（GPT-5.6 系列 / Claude 5 / Gemini 3.x / Qwen3.x / GLM-5 / Kimi K3 / MiMo；StepFun/MiMo/Qwen3.8 官方 CNY 价 ÷7 换算并标注；qwen3.8-max 免费额度超出按 ¥12/¥36 计入）；通用模型消耗按「计价货币」自动换算（选 CNY ×7、选 USD 原样，与 DeepSeek 峰谷表口径一致）；模型→平台映射扩充且认不出不再默认落 DeepSeek；会话投影新增 currentProvider；大肥鱼位置跳动根治（位置缓存 / 键盘不吸附 / 禁用初始化过渡）；状态文件路径改用 DSH_HOME 而非硬编码
v1.2.0 — 价格表扩充（对照 [modelradar.cn](https://modelradar.cn) 2026-09-03 快照，仅采纳官方定价页无分歧条目）：新增 `gpt-5.3-codex`、`gemini-3.8-flash`、`gemini-2.5-flash`、Kimi `k2.6`/`k2.5`、通义 `qwen3.8-flash`/`qwen3.8-27b`/`qwen3.6-plus`、豆包 Seed 2.0 全 12 档（pro/lite/mini/code × 32k/128k/256k）、混元 `2.0-instruct-128k`/`2.0-think-128k`/`turbo-s`；修正 `claude-opus-5` 缓存读价 5.0→0.5（Anthropic 缓存读=0.1×输入，原误标「无缓存折扣」）；radar 的 GPT-5.6 系输出价（输入×1.25 异常模式）与 qwen3.7-max 促销原价**未采纳**，原可信值保留并注明；官方品牌图标替换字母兜底：MiniMax（#E73562 官方紫红）、xAI（X logo）、小米 MiMo（Xiaomi logo），stepfun/novita 无官方 SVG 仍用文字图标
v1.2.1 — **把手下滑关闭**：看板抽屉 / 平台详情 / 设置面板三处顶部把手支持下滑手势关闭（pointer 事件跟手拖拽整个抽屉，位移 >72px 或快速轻扫即播滑出动画后关闭，不足则回弹；`touch-action:none` 防滚动冲突，触屏/鼠标通用）；**豆包/混元入列模型品牌分组**（v1.2.0 只进了价格表未显示，现与 OpenAI/Claude/Gemini/Qwen/MiMo 同列「模型品牌」，`modelToPlatform` 增加 `doubao-*`/`hunyuan*` 映射，会话消耗按对应品牌计价）；豆包用字节跳动官方 logo（#3C8CFF），混元暂无官方 SVG 沿用文字图标（品牌蓝 #0052D9）
v1.2.2 — **豆包/混元换官方品牌图标**：豆包改用豆包官方 64×64 图标（官网 favicon PNG 转 data URI 内嵌，替换此前借用的字节跳动 logo）；混元改用腾讯混元官方 logo.svg（hunyuan.tencent.com 官方矢量，净化后内嵌，多色圆弧标），移出 TEXT_ONLY 文字图标列；两者均自官网/官方 CDN 获取
v1.2.3 — **修复 GLM-5.3-flash 缓存读价误标**（用户实测反馈：长会话估算 ¥9.93 vs 真实账单 ¥5.19）：原表把 `glm-5.3-flash` 标为「无缓存折扣」（cacheHit=cacheMiss=0.15），但 GLM 系缓存读=输入×20%（同表 glm-5.2 0.26/1.4、glm-5-turbo 0.24/1.2 交叉佐证），多轮长会话数百万缓存读 token 全按全价计导致估算虚高 ~5 倍；修正 cacheHit→0.03 并新增回归断言（GLM 系 cacheHit 必须低于 cacheMiss）；其余「无缓存折扣」条目（qwen3.7/3.8-max 促销价、混元等）因缺官方缓存价佐证维持原值
v1.2.4 — **parse-error 透传接口业务错误消息**：智谱套餐过期实测返回 HTTP 200 + `{"code":500,"msg":"当前用户不存在coding plan","success":false}`，原逻辑只显示笼统的「无法解析余额数据」，误导用户以为是解析代码坏了；现在识别业务层错误（`success:false` 或 `code≠200` 且带 `msg`）并透传原始消息（显示为「无法解析余额数据 (接口返回: 当前用户不存在coding plan)」），适用于全部预设平台

## License

[MIT](./LICENSE)

本项目「收养大肥鱼」挂件的互动部分（拖拽吸附、Q 弹按压、台词气泡、音效、菜单）移植自
[MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)，
原作者 Copyright (c) 2026 MeteorNOX，MIT License，许可全文见 `assets/whale/LICENSE-whale-widget.txt`。
鲸鱼形象与音效素材同样来自该项目。