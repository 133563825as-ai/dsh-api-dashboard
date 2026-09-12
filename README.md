# dsh-api-dashboard · 哦鲸鲸

[![npm](https://img.shields.io/npm/v/dsh-api-dashboard?color=4f7cff)](https://www.npmjs.com/package/dsh-api-dashboard)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**开源**（MIT）的 **DeepSeek Harness 专用**插件：多平台 API 余额 / 用量看板 —— 在 Web GUI 输入框下方实时显示各平台余额与**本会话估算消耗**。

> ⚠️ **安装或维护本插件之前，请先读 [`AGENTS.md`](AGENTS.md)** —— 数据准确性红线、踩过的坑、安装姿势对照都在那里。
> 本插件深度绑定 DeepSeek Harness 的客户端与宿主 API，**只能在 DSH 里运行**（手机版 DSHA 与桌面版同框架）。

> 🧪 **你现在看的是预发行分支 `preview/desktop`** —— 版本 `v1.5.0-desktop-preview.8`（宿主侧栏竖线抑制去掉多余的媒体条件，待平板实测）。
> 相对正式版只多一件事：**桌面 / 平板适配**。抽屉按三档走（档位对齐宿主手机壳自己的
> `MOBILE_QUERY = max-width:1023px`）：
>
> | 视口 | 形态 |
> |---|---|
> | < 768px 宽，或高 < 600px（手机竖屏 / **手机横屏**） | 原样全宽底部抽屉 —— 与 v1.4.2 **完全一致** |
> | 768–1023px 宽且高 ≥ 600px（平板竖屏 / 窄窗口） | **居中 560px 面板** |
> | ≥ 1024px 宽且高 ≥ 600px（桌面 / 平板横屏） | **居中对话框**：四角圆角 + 上下留边 + `max-height:min(720px,80vh)`，**面板 720px 宽、平台卡片两列** |
> | 任意尺寸 + `pointer:fine`（接了鼠标的窗口） | 同上第二条宽度档 —— 宽而矮的窗口不再掉回全宽通栏 |
>
> ⚠️ 上面三档的「高 ≥ 600px」只在**触摸设备**上是硬门槛（挡手机横屏）。带精确指针的窗口
> （分屏、台前调度、拉矮的浏览器）按宽度分档：1600×599 与 1600×600 得到同一种形态，
> 不会在 1 像素上从通栏跳成对话框。安全性依据：宿主自己用 `(pointer: coarse)` 认手机
> （`dsh-web-mobile` 的 `MOBILE_QUERY`），coarse 与 fine 互斥，所以这条分支碰不到手机。
>
> 键盘弹出时面板会按 `visualViewport` 收窄并在可视区里重新居中/上移（宿主 viewport meta 没有
> `interactive-widget=resizes-content`，`vh` 不随键盘收缩，这一半只能插件自己算）。
>
> 逻辑一行没动。三个抽屉补了 `role="dialog"` + `aria-label`（无障碍），但**刻意不加
> `aria-modal="true"`** —— 手机壳把带这个属性的元素当自家对话框，有 46 条以其为前缀的结构性 CSS
> 会把我们的面板重排，见 [`AGENTS.md`](AGENTS.md)。
> 预览版在设置面板顶部带黄色标识，并且**可以一键更新 —— 但只在预览分支内**：
> 更新频道来自 `package.json` 的 `dsh.updateRef`（本轮 = `preview/desktop`），
> 所以它既能装到同分支上的新预览版，**结构上也不可能被 main 的正式版覆盖**。
> 装它：`DSH_DASHBOARD_REF=preview/desktop sh install.sh`；正式版仍在 `main`。

## 界面预览

**余额条**常驻在输入框下方；会话里有子代理时，下面会多一行**可横滑的消耗胶囊**（顺序 = 创建顺序，长按看详情）。

<a href="docs/screenshots/1-balance-bar.webp"><img src="docs/screenshots/1-balance-bar.webp" width="100%" alt="输入框下方的余额条"></a>
<a href="docs/screenshots/2-subagent-row.webp"><img src="docs/screenshots/2-subagent-row.webp" width="100%" alt="子代理消耗行"></a>

| 看板（点余额条打开） | 大肥鱼挂件（可拖拽 / 吸附边缘） |
|:---:|:---:|
| <img src="docs/screenshots/3-dashboard.webp" width="300" alt="看板"> | <img src="docs/screenshots/6-whale-tab.webp" width="300" alt="大肥鱼"> |
| **设置 · 基础** | **设置 · 大肥鱼** |
| <img src="docs/screenshots/4-settings-basic.webp" width="300" alt="设置基础"> | <img src="docs/screenshots/5-settings-whale.png" width="300" alt="设置大肥鱼"> |

## 功能

- **三层 UI**：状态条（输入框下方）→ 看板抽屉（点状态条）→ 平台详情（点卡片 ⓘ）
- **峰谷趣味计费**：DeepSeek 工作日 9:00-12:00 / 14:00-18:00 显示 ☀️ 梁文峰，其余时间与周末 🌙 梁文谷（半价）
- **三色阈值灯**：绿 / 黄 / 红，阈值可自定义；余额首次跌破预警线自动推送通知
- **会话消耗估算**：按模型单价折算；混合币种两段显示 `~¥3.40+$12.50`，**不做汇率折算合并**
- **子代理消耗**：子代理单独成行、可横滑，长按看完整详情
- **大肥鱼挂件**（可选）：屏幕边缘一只可拖拽的互动挂件，纯娱乐，不显示任何金额
- **自定义接入**：中转站自动探测余额接口；自建接口支持点分路径手动映射
- **配置持久化**：阈值 / 币种 / 刷新间隔（1~60 秒）/ 自定义条目都存本地状态文件，重启不丢
- **一键自更新**：设置面板内检查并安装新版本（下载 → 校验 → 备份 → 替换 → 失败回滚）

## 支持平台

| 分组 | 平台 |
|---|---|
| 国内 | DeepSeek、智谱 GLM、Kimi、阶跃星辰、硅基流动、MiniMax |
| 海外 | OpenRouter、Novita AI、xAI Grok |
| 其他 | 自定义中转站（自动探测余额接口）、自定义模型（手动映射） |

> OpenAI / Claude / Gemini / Groq / Mistral / Together 等**未开放余额查询接口**，面板会如实显示「未开放」，
> **不会伪造数字**。智谱按量付费账户同样没有公开余额接口（显示中性「未开放」，不标红）。

## 安装

### 手机版 DSHA（Android）—— 实测可用，照抄即可

```sh
# 1. 下载源码
curl -L "https://codeload.github.com/133563825as-ai/dsh-api-dashboard/tar.gz/refs/heads/main" \
     -o /tmp/dsh-api-dashboard.tar.gz

# 2. 解压到固定位置（--strip-components=1 必须带）
rm -rf /root/dsha-api-dashboard && mkdir -p /root/dsha-api-dashboard
tar xzf /tmp/dsh-api-dashboard.tar.gz -C /root/dsha-api-dashboard --strip-components=1

# 3. 建 node_modules 软链 —— 这一步不能省（插件的 peer 依赖由宿主 DSH 提供）
ln -sfn /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules /root/dsha-api-dashboard/node_modules

# 4. 用 link: 装进 web profile（文件保持真实路径，客户端 UI 才能被框架找到）
dsh plugin --profile web add link:/root/dsha-api-dashboard

# 5. 重启 dsh web
```

> 仓库根目录的 [`install.sh`](install.sh) 把上面 5 步做完了：`sh install.sh`。
> 装**预发行（桌面适配预览）分支**：`DSH_DASHBOARD_REF=preview/desktop sh install.sh`。

**桌面版**同理（路径换成你自己的）。npm 一行命令 `dsh plugin --profile web add dsh-api-dashboard`
在桌面版通常可用，但在**手机版 DSHA 上装完客户端 UI 不会出现** —— 原因与逐条实测对照见
[`AGENTS.md`](AGENTS.md#二安装须知ai-代理注意)。

> 🖥️ **桌面上能用到什么程度**（本预览分支实测口径）：交互全部走 pointer events，鼠标拖拽 / 点击 / 悬浮正常；
> 卡片 hover 与深色模式都有；大肥鱼挂件能用鼠标拖。原先唯一的桌面缺口是**抽屉横铺整屏**（CSS 里没有任何宽度断点），
> 本分支已补 `@media (min-width:768px)` 的居中限宽。手机壳手势层（`dsh-web-mobile`）只认 touch/pen，
> 桌面上不会干扰。

### 升级

1. 插件设置面板 →「检查更新」→「一键自更新」，重启 `dsh web` 生效；
2. 或重跑上面第 1、2 步覆盖源码目录后重启；
3. 或 `dsh plugin --profile web remove dsh-api-dashboard` 后重新安装。

## 配置

在设置面板里调即可（保存后写入 `~/.dsh/dsh-api-dashboard.json`）。
也可以直接写 `cordis.patch.yml`：

```yaml
- id: dsh-api-dashboard
  config:
    safeThreshold: 50        # 绿色阈值
    warnThreshold: 10        # 黄色阈值（低于它变红）
    currency: CNY            # 主计价货币
    overseasCurrency: USD    # 海外模型计价：follow | USD | CNY
    refreshIntervalMs: 300000
    clientPollIntervalMs: 30000
    timeoutMs: 8000
```

**API Key 自动读取**，无需写进配置：先查环境变量（`DEEPSEEK_API_KEY` / `ZHIPU_API_KEY` / `MOONSHOT_API_KEY` /
`STEPFUN_API_KEY` / `SILICONFLOW_API_KEY` / `MINIMAX_API_KEY` / `OPENROUTER_API_KEY` / `NOVITA_API_KEY` / `XAI_API_KEY`），
再查 DSH 凭证系统 `~/.dsh/.credentials.yaml`。

### 官方直连 / 中转站判定

状态条显示的是「官方余额」还是「—（中转站无余额接口）」，按三层判定，优先级从高到低：

1. **用户显式名单** —— 设置面板「官方直连 provider」，写进去的一律按官方；
2. **baseURL 域名** —— 服务端读 `settings.yaml` 的 provider `baseURL`，按**域名**比对官方端点白名单；没写 baseURL 的不表态；
3. **命名约定** —— 带 `-official` / `_official` 后缀的按官方。

三层都不命中默认按**中转站**处理（宁可不显示，也不显示错的余额）。设置面板会列出当前的自动判定结果。

## 安全

- API Key 只从环境变量 / DSH 凭证系统读取，**不写进代码或仓库**；
- `/api-dashboard/config` 返回的 Key 一律 `***`；浏览器端只请求同源接口，不向第三方域名发数据；
- 本地状态文件含自定义条目的 Key，权限 `0600`，被 `.gitignore` 排除；
- 自定义模型 / 中转站的 Key 会发往**你自己填的接口地址**，请只填信任的服务；
- v1.4.1 起插件路由带鉴权闸门（无 cookie → 401，跨域 → 403）。

## 开发

- 服务端 `src/index.js`（ESM，**零依赖、零构建**）；客户端 `client/client.js`（改完需重启 `dsh web`）
- 测试：`for f in test/*.mjs; do node "$f"; done`（退出码非 0 即失败）
- 改动红线、踩坑记录、发布流程：[`AGENTS.md`](AGENTS.md)、[`docs/RELEASING.md`](docs/RELEASING.md)

## 更新日志

最近一版 **v1.4.2**（本分支为预发行 `v1.5.0-desktop-preview.8`，宿主侧栏竖线抑制，**待平板验证**）—— DeepSeek 多币种钱包读取修复 + 桌面/平板适配预览。一版一行的完整历史见 [`CHANGELOG.md`](CHANGELOG.md)。

## License

MIT —— 见 [LICENSE](LICENSE)。大肥鱼互动挂件移植自
[MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)（MIT），
许可副本见 [`assets/whale/LICENSE-whale-widget.txt`](assets/whale/LICENSE-whale-widget.txt)。
