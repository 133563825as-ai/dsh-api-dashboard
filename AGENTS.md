# AGENTS.md — 给 AI 代理的必读须知

> 你是将要安装、维护或修改本插件的 AI 代理。在动手任何操作**之前**，先读完本文件。
> 这里记录了别人踩过的坑、数据准确性的红线、以及开源发布前的待办。违反了会出 bug、误导用户、或导致开源被喷。

---

## 一、这是什么

`dsh-api-dashboard` 是 **DeepSeek Harness 专用** 的多平台 API 余额/用量看板插件。
深度绑定 DSHA Web 框架：`conversation.composer.dock` slot、`sessionProjections`、`webServer` 路由、`credentials` 凭证。
**仅能运行在 DeepSeek Harness（手机版 DSHA / 桌面版）里**，任何其他环境无法加载。

- 服务端：`src/index.js`（余额轮询 + HTTP 路由 `/api-dashboard/*` + 自动更新）
- 客户端：`client/client.js`（UI，dsh bundle 启动时打包；改它后需**重启 web GUI** 才生效）

### 📚 文档地图（v1.4.1 起 README 已精简）

| 文件 | 给谁看 | 内容 |
|---|---|---|
| `README.md` | **用户** | 简介、界面预览、功能、支持平台、安装、配置、安全。**保持精简**，别把排查过程/历史写回去。 |
| `AGENTS.md`（本文件） | **代理 / 维护者** | 红线、踩坑、机制说明 —— 冗长的排查记录放这里。 |
| `CHANGELOG.md` | 用户 / 维护者 | 完整版本历史（README 只留最近一版摘要）。 |
| `docs/RELEASING.md` | 维护者 | npm 发布流程（OIDC）。 |
| `docs/screenshots/` | — | README 用的真机截图，**不在 `package.json` 的 `files` 里，不进 npm 包**。 |

---

## 二、安装须知（AI 代理注意！）

### ✅ 唯一实测可用的安装方式（v1.4.1 校准）

```sh
# 1. 下载
curl -L "https://codeload.github.com/133563825as-ai/dsh-api-dashboard/tar.gz/refs/heads/main" -o /tmp/dsh-api-dashboard.tar.gz
# 2. 解压(必须带 --strip-components=1)。是 git 工作区就别这么干, 用 git pull。
mkdir -p /root/dsha-api-dashboard
tar xzf /tmp/dsh-api-dashboard.tar.gz -C /root/dsha-api-dashboard --strip-components=1
# 3. ★ 关键一步: 建 node_modules 软链(插件的 peer 依赖由宿主 DSH 提供)
ln -sfn /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules /root/dsha-api-dashboard/node_modules
# 4. 用 link: 装进 profile(文件保持真实路径)
dsh plugin --profile web add link:/root/dsha-api-dashboard
# 5. 重启 dsh web
```

仓库根目录 `install.sh` 把上面 5 步做完了（含旧目录改名回退、git 工作区保护）。

### 安装姿势对照（2026-09-11 在 DSHA 上逐条实测）

| 姿势 | 后果 |
|------|------|
| 源码 + `node_modules` 软链 + `dsh plugin add link:<dir>` | ✅ **可用**，唯一推荐 |
| 包目录放在 `$DSH_HOME/profiles/` 之下再 `add file:` | ✅ 可用 |
| `dsh plugin --profile web add dsh-api-dashboard`（npm 裸包名） | ❌ **手机版 DSHA 上客户端 UI 不会出现**；v1.4.1 之前更糟 —— **整个 `dsh web` 启动失败** |
| `dsh plugin --profile web add file:/源码目录`（目录里没有 node_modules） | ❌ 同上 |
| `pnpm add <远程 tarball URL>` | ❌ pnpm 不剥顶层目录 → 装出空壳 |
| 手动软链整个插件目录进 `node_modules` | ⚠️ 会被启动校准摘除；**软链 `node_modules` 子目录则是必须的** |

**为什么 npm 裸包名在 DSHA 上不行（改这块之前先读）**：DSHA 跑在 proot 里，启动参数带 `--link2symlink`
（见 `ps` 里的 `libproroot.so ... --link2symlink`），pnpm 的硬链接被降级成**指向全局 store 的符号链接**；
而 Node 的 ESM 会先把模块解析成 realpath，再从那开始向上找 `node_modules` ——
从 `/root/.local/share/pnpm/store/v10/files/xx/hash` 往上永远走不到 `$DSH_HOME/profiles/node_modules`。
后果有两个，**第二个 v1.4.1 也没法从插件侧修**：
1. 宿主半身 `Cannot find package '@deepseek-ai/schemastery'` → **整个 `dsh web` 起不来**。
   v1.4.1 加了 peer 解析回退（`resolvePeer()`）已解决。
2. 客户端半身被框架**静默丢弃**：`@deepseek-ai/dsh-client-modules` 的 `locatePkgJson()` 按模块路径向上找
   「名字等于包名的 package.json」，store 目录的祖先链里没有 → 直接当作非客户端插件，**没有任何日志**。
   只有让插件文件保持真实路径（`link:` / 真拷贝）才能修。

### ⚠️ 一个坏 bundle 会让整个 `dsh web` 起不来（2026-09-11 用户反馈后查清）

DSH 启动时会把 profile 的 `dsh.profile.bundles` **逐个 import**，只要有一个解析不了
（没装 / `link:` 目标被删被移导致软链断掉），**整个 dsh web 拒绝启动**，日志尾部：

```
[cause]: Error [ERR_MODULE_NOT_FOUND]: Cannot find package '<包名>' imported from .../profiles/<profile>/...
```

**`dsh plugin add` 本身不会删掉别的插件** —— 已用真包 `dsh-better-sidebar`（90 个依赖）完整复现：
`pnpm add link:<插件>` 前后它一个不少；连「有依赖取不到导致 pnpm 失败」时 node_modules 也原样保留。
但它确实是 `pnpm add`（`dsh plugin` 只是 pnpm 转发器，cwd = profile 目录），会做一次全量解析，
**而且必须重启才生效** —— 所以「照教程装完就炸」多半是：**profile 里本来就有坏条目，重启才暴露**。

- `install.sh` 现在会：装前备份 `profiles/<p>/package.json` → 装前体检 → 装后体检，
  并明确区分「装前就坏」和「装后才坏」，避免背锅。
- 抢救：`node tools/profile-doctor.mjs --profile web [--fix]`
- ⚠️ `--fix` **只摘 `dependencies` 里的条目**（与 DSH 自己的 `reconcilePlugins` 同规则）；
  `@deepseek-ai/dsh-base` / `dsh-web-app` 这类 in-box bundle 从 `$DSH_HOME/profiles/node_modules` 解析，
  **绝不许从清单里摘** —— 摘了 DSH 直接哑掉。
- ⚠️ 判断 bundle 能否解析必须用 `createRequire(<profile>/package.json).resolve.paths()`（会上溯到
  `profiles/node_modules`），**别只看 `profiles/<p>/node_modules`** —— 那会把 in-box bundle 全部误报成坏的。
  `ERR_MODULE_NOT_FOUND` 对「没装」和「软链断掉」是**同一句话**，光看报错分不出来，必须实际解析一次。

## 三、数据准确性红线（改代码前必读）

以下平台余额解析有过「显示不准确」的历史问题。开源公布后会被用户/社区质疑，**务必如实处理，不许造假数字**。

### ⚠️ 已知准确性问题 / 待验证项
| 平台 | 当前状态 | 问题 | 你要注意 |
|------|----------|------|----------|
| 智谱 GLM | 已改(2026-08-30 真实key实测) + **账户分流(2026-09-04)** | 实测确认：智谱**无真实余额 API**，`limits[]` 按 unit 分维度返回 Coding Plan 配额——`unit=3`=5小时窗口、`unit=6`=周配额、`unit=5`=工具(月度)；`remaining`=该维剩余积分，`percentage`=该维**填充度/已用**(100=用完)非"剩余%"。**且仅 Coding Plan 套餐可查**：按量付费账户调同一接口返回 `{"code":500,"msg":"当前用户不存在coding plan"}`，候选余额端点(`/api/monitor/account/balance`、`/api/paas/v4/dashboard/billing/*`、`/api/paas/v4/users/me`)**全部 404** | 已改**按 unit 分维度显示**(主显示 5小时窗口，顺带提示周配额/工具用完)，绝不把"已用完"当"余额100%"；**按量付费/套餐过期走 `classifyBizError` 返回中性 `no-balance-api`**(不标红)，其余业务错误透传原始 `msg`。⚠️ 改这段务必先跑 `test-dshadb.mjs` 的 P1~P12——**套餐用户的配额解析绝不能被按量付费分支吞掉**(套餐用户 `parsed` 非空，根本走不到 `classifyBizError`) |
| DeepSeek | 已修 | 负余额曾显示「正常」 | 负数必须显示红(err) |
| OpenRouter | **待验证** | `total_credits-total_usage` 字段名存疑, 读错会 NaN→0 | 需要真实 key 实测 |
| siliconflow | 待验证 | `totalBalance` 字段可能不对 | 需实测 |
| Novita | 待验证 | `availableBalance÷10000` 单位存疑 | 需实测 |
| one-api quota | 待验证 | `quota÷500000` 系数存疑 | 需实测 |
| xAI | 待验证 | 无专属解析, 走 openai 分支 | 需实测 |

> **2026-08-30 已加「字段存在性校验」**：OpenRouter / siliconflow / stepfun / kimi / one-api 若**预期字段缺失**（接口改名/字段名不对），解析直接返回「无法解析/未开放」，**不再把无效值归 0 冒充「余额 0」**——这是对上面各行「字段名存疑」的防御性兜底。
> ⚠️ **字段值 / 单位换算仍需真实 key 实测后才能定论**（红线：别因有了兜底就跳过实测）——兜底解决的是"假 0"，**不解决"值不对"**。

### ❗ 通用规则（改任何平台解析时）
1. **不要造假**：查不到准确余额，宁可显示「未开放/待确认」，不要硬塞一个数。
2. **负数/耗尽必须红**：余额 ≤0 或 percent 很低 → 红(err)。
3. **区分「真实 0」和「解析失败」**：`toAmount` 把无效值归 0，可能导致「余额0」假象——**2026-08-30 已在预设平台解析处加「字段存在性校验」兜底**（缺失字段→返回 null→前端显示「无法解析/未开放」）。此兜底只覆盖预设平台，改自定义中转/模型解析时仍需注意区分真实 0 与解析失败。
4. **限流配额 ≠ 余额**：很多平台返回「每 N 小时 xx token」的限流窗口，那不是账户余额，别当余额显示。

> **价格表（`MODEL_PRICES` / `V4_RATES`）来源与币种（2026-09-10 v1.4.0 重写）**：
> - **DeepSeek 走 `V4_RATES` 峰谷表**——已对照[官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)中英文**双页**核实（中文页给 CNY、英文页给官方 USD 直发价），值与时区窗口(北京时间周一至周五 9-12/14-18 高峰、空闲=半价)**完全正确**；`deepseek-v4-flash-vision-exp` 与 flash 同价，`deepseek-chat/reasoner/r1` 已 2026-07-24 退役(调用报错)。⚠️ 官方 USD 是**直发价**（口径约 1 USD ≈ 6.67 CNY），**不是** `USD_TO_CNY_RATE`(=7) 换算出来的，别拿汇率去"校正"它。
> - **通用 `MODEL_PRICES`（v1.4.0 起改为「原生币种」存储）**：现役主力来自各厂商**官方定价页原文**（2026-09-10 抓取核对：`api-docs.deepseek.com` 中英双页 / `platform.kimi.com` / `platform.minimaxi.com` / `platform.stepfun.com` / `docs.bigmodel.cn` / `help.aliyun.com` 百炼 / 小米 MiMo 官方降价公告）；历史条目来自 NousResearch hermes-agent `usage_pricing.py` 与 [modelradar.cn](https://modelradar.cn/data/models.json)。
>   🔴 **规则：国内厂商官方页给 CNY → 表里直接写官方 CNY 原值；海外给 USD → 直接写官方 USD 原值。不要再做任何 ÷7！**
>   币种由 `modelRegion(model)` 判定（配套导出 `nativeCurrencyOf`），`resolveModelPrice` 只在「显示币种 ≠ 原生币种」时才用 `USD_TO_CNY_RATE`(近似值) 换算。默认配置 `currency='CNY'` + `overseasCurrency='USD'`（v1.4.0 起默认值从 `'follow'` 改成 `'USD'`）下两边同币种、**零换算**。
>   **为什么改**：「统一 USD 基准」被同一类错误咬过两次 —— MiMo（¥1 被写成 0.020，等于又除了一次 7）与 `glm-4-plus`（¥2.5/¥5/¥5 被当 USD，显示 ¥17.5/¥35/¥35）；更早还有**整个「历史/参考」段的国内条目**都填的是 CNY 原值却在旧口径下被又 ×7。原生币种存储让这类错误**无法表达** —— 改表时直接抄官方页数字即可。
>   一手价未取到的模型→落 `defaultPrices`(单位仍是 **USD**，本轮未改)，**别乱填**；确实拿不到官方原文、只能保号迁移的条目，**必须在注释里标「未核实」**。旧模型(2025-08)条目标为"历史/参考"。仅估算用，实际以平台为准。
> - ⚠️ **第三方聚合源只作参考，与原表冲突时不要盲信**：modelradar 2026-09-03 快照里 GPT-5.6 系输出价全呈「输入×1.25」异常模式(疑似抓错列)、且不跟踪促销价(qwen3.7-max 报的是原价) → **这两类已故意未采纳**，注释中有标注，别当遗漏"修回去"。
> - 🔴 **`cacheHit` 缺官方佐证时别标「无缓存折扣」**（v1.2.3 血泪）：`glm-5.3-flash` 曾被标 `cacheHit = cacheMiss`，长会话数百万缓存读 token 全按全价计 → 用户实际充值 5 元、面板显示消耗 ¥9.93。**v1.4.0 已拿到官方明文**（[docs.bigmodel.cn 定价页](https://docs.bigmodel.cn/cn/guide/start/pricing)）：GLM-5.3 `¥8/¥28/缓存 ¥2`、GLM-5.3-Flash `¥0.8/¥2.8/缓存 ¥0.23` —— 即**缓存读 ≈ 输入价的 25%~29%**，与当初「20%」的交叉推断同量级但以官方为准。已加回归断言「GLM 系 `cacheHit` 必须 < `cacheMiss`」+「全表 `cacheHit` ≤ `cacheMiss`」。**真的无折扣才写等值，不确定就按同厂同系比例推并注明依据。**
>   ⚠️ **同族反面教材**：`minimax-m2.7` 曾因「中转站无缓存报价」直接写成 `cacheHit = cacheMiss`，而 MiniMax [官方页](https://platform.minimaxi.com/docs/guides/pricing-paygo) 明写缓存读 `¥0.42`（输入 ¥2.1 的 20%）→ 长会话高估 5 倍。**「接口没给」不等于「官方没有」**，先去官方定价页确认再决定写等值。
> - 💱 **v1.3.2 起币种不是全局唯一的**：`resolveModelPrice` 的币种由 `currencyForModel(config, model)` 决定——
>   海外模型（`modelRegion(model)==='海外'`）在 `overseasCurrency` 非 `'follow'` 时走它，其余跟 `currency`。
>   **改价格解析时别再假设「一个会话只有一种货币」**：`makeCostProjection` 的视图给的是 `costByCurrency`（按币种分组），
>   混合会话客户端两段拼接显示，**绝不要为了凑成一个数字而按汇率折算合并**——那正是 v1.2.x 想摆脱的 ×7 误差来源。
>   `modelRegion` 未命中的模型**不表态、走主货币**（保守），新增模型时若产地重要，去补 `OVERSEAS_MODEL_PREFIXES` /
>   `DOMESTIC_MODEL_PREFIXES` 前缀表，别在别处硬编码判定。
> - ⏰ **促销价有时效，到期要更新**：`gemini-3.8/3.7/3.6-flash` 2026-12-31 到期后翻倍；`gpt-5.6-sol` 促销至少到 2026-11-21(列表价 $5/$30)；`qwen3.7-plus` 限时 8 折；`qwen3.8-max` 90 天/100 万 token 免费额度。`qwen3.8-max` 夜间 22:00-08:00 五折**未实现**（峰谷引擎目前只服务 DeepSeek）。
>   ⚠️ **v1.4.0 已作废两条促销记录**：`glm-5.3-flash` 促销（官方页现值就是 ¥0.8/¥2.8，无到期标记）与 `qwen3.7-max` 5 折（**官方页现为原价 ¥12/¥36，查无 5 折** —— 原值 0.83/2.48 来源不明，已删）。**「促销」必须有官方页原文或到期日期兜底，否则别写。**

---

## 四、维护铁律（改代码前必读）

1. **先备份再改**：改 `client/client.js` 或 `src/index.js` 前，先 `tar` 一份 / 存回退点。用户习惯 A/B 对比+回滚。
2. **推送前问维护者**：默认只做本地改动与本地测试。**别擅自推 GitHub / 发 npm**。
3. **测试方法**：`node --check <文件>` 只查语法；真正的客户端改动要**重启 dsh web GUI** 才进 bundle。运行在容器里时别贸然重启(会断会话)。
4. **改 UI 结构要克制**：UI 方向尚未定稿(半屏/三Tab/核心分组几种方案均已否决)，已确认保留的是「**玻璃背景**」。别擅自大改 UI 结构。
5. **玻璃色经验**：浅色用纯白 rtgba(255,255,255,0.72)，深色走 `@media(prefers-color-scheme:dark)`。**别用 CSS `color-mix` 跟 token 推玻璃色**——会发灰。
6. **版本闭环 + 版本号规则**：任何对已发布功能的改动，记得 bump `package.json`/`package-lock.json` 版本 + 更新 README changelog，推 GitHub 后老用户面板会提示更新。
   **版本号 `X.Y.Z` 的含义（维护者 2026-09-10 明确）：`Y` = 大版本更新（新功能 / 结构性改动），`Z` = 修补 bug。** 别把 bugfix 当大版本发，也别一个功能跳两个 `Y`。
   ⚠️ **一次连续的、尚未发布的开发要合并进同一个版本号**：`v1.4.0`（原生币种）/ `v1.5.0`（子代理可见）/ `v1.5.1`（子代理冷会话自测修复）本来是同一轮工作里连着的三个号，维护者反馈「版本太夸张，之前是 1.3 现在已经 1.5」—— **已全部并回 `v1.4.0`**（三段日志合成一条）。以后：**没发布过就别连着跳号**，更别为一个「上线前自测发现的缺陷」单开版本。
7. **npm 发布只走 Trusted Publishing (OIDC)**（完整流程见 [`docs/RELEASING.md`](docs/RELEASING.md)）：`git tag v<版本> && git push origin v<版本>` 触发
   `.github/workflows/publish.yml`，仓库内**不存任何 npm token**。
   ⚠️ **别再试 `npm publish` + token/OTP**：npm 已限制「绕过 2FA 的 token」用于直接发布
   (https://gh.io/npm-gat-bypass2fa-deprecation)，Granular / Automation token 加 `--otp` 在开启 2FA
   的账号上均实测失败（web 登录成功后 publish 仍报 EOTP）。
8. **测试必须以退出码表达结果**：`test/*.mjs` 结尾都有 `if (fail > 0) process.exitCode = 1`。
   新增测试脚本别忘了加，否则 CI 里断言失败也会被当成通过。
   ⚠️ **测试不许读运行机器上的私有文件**：`test-provider-kinds.mjs` 原来直读 `~/.dsh/settings.yaml`，
   clone 到别处 / 在 CI 里一律 ENOENT 崩掉，断言里还会带上使用者真实的中转站名与域名。
   已改为内联夹具（结构与真实文件逐项对齐，名称与域名用 `relay-one.example.com` 之类占位值）。
   **别把真实 provider 名 / 中转域名写进测试**。
9. **provider 判定别改回硬编码名单**：官方/中转三层判定（用户显式名单 → settings.yaml 的 baseURL 域名白名单 → `-official` 后缀）是开源化改造的关键，**千万别把「官方 provider 名单」写回客户端硬编码**——别人的中转站叫什么猜不到。判定的服务端逻辑在 `src/index.js` 的 `parseProviderBaseURLs` / `computeProviderKinds` / `isOfficialHost`，客户端落地在 `client/client.js` 的 `isRelayProvider(provider, config)`。没写 baseURL 的 provider 是「不表态、交后缀兜底」，**别**去读 pi-ai 内置目录补官方域名（`xiaomi` 就是内置目录指向官方域名、但 key 实际来自中转站的反例）。


---

## 五、自动更新机制（v0.6.0+)

- `GET /api-dashboard/update`：对比 GitHub main 的 package.json version，5 分钟缓存。
- `POST /api-dashboard/update/install`：下载→校验→备份→原子替换→失败回滚，重启生效。
- 改代码时别破坏这两个端点；`applyUpdate` 有 `remoteVersion`/`localTarball` 测试注入口。

---

## 六、开源发布前待办（2026-09-10 v1.4.0 校准）

### 🔎 「自动判定」现状（2026-09-10 在本机实测；v1.4.0 补上最后一块短板，被问到时照这个答）

这个插件里叫「自动」的东西有好几套，**真假不一**，改代码前先看清动的是哪一套：

| 机制 | 位置 | 真的假的 | 实测 |
|---|---|---|---|
| provider 官方/中转判定 | `computeProviderKinds`（服务端读 `settings.yaml`）+ 客户端 `isRelayProvider` | ✅ **真**（域名白名单式） | 本机 8 个 provider：只有写了官方域名的 `zhipu` 判 `official`，其余按域名判 `relay` |
| API Key 发现 | `resolvePresetKey` / `resolveApiKeyRef` | ✅ **真**（三层兜底） | 环境变量 → DSH `credentials` 服务 → 直接解析 `~/.dsh/.credentials.yaml` |
| 自定义中转站端点探测 | `queryCustomRelay`（`queryType:'auto'`） | ✅ **真** | 依次试 `billing/subscription` → `api/user/self` → `credit_grants` |
| 自定义模型格式探测 | `queryCustomModel`（`queryType:'auto'`） | ✅ **真** | 对用户给的**那一个 URL** 试 4 种解析格式 |
| **DSH provider 自动入列** | `parseProviderEntries` + `selectDshProviders` + `listDshProviderRelays` | ✅ **真**（v1.4.0 新增） | 本机自动发现 5 条中转站（dshzuoxhe/jiyuan/jiyuanlvdong/mimov/new），`zhipu` 判 official 跳过、`xiaomi`/`opencode` 没写 baseURL 跳过 |
| **平台余额清单** | `PLATFORM_PRESETS` / `config.presets` | ⚠️ **半自动** | 预设清单本身仍是硬编码（官方平台就那几个，合理）；但**用户自己的中转站现在会自动入列了** —— 见下条 |

> ⚠️ **两个必须记住的点**：
> 1. **v1.4.0 起插件会读 DSH 的 `settings.yaml` provider 列表**（`storages/settings.yaml` 的 `llm-pi-ai.providers`），自动合成中转站条目去查余额 —— 用户不必再手抄一遍 baseUrl + key。**改这块别退回「只查 `customRelays`」**，那是 v1.4.0 之前最大的体验断点。细节见下方「DSH provider 自动入列」小节。
> 2. **没写 `baseURL` 的 provider 一律「不表态」→ 按中转站显示「—」**（铁律 9 的**故意设计**，别改）。本机 `xiaomi` / `opencode` 没写 baseURL，所以状态条显示「—」。`xiaomi` 正是「内置目录指向官方域名、但 key 实际来自中转站」的反例。
>
> 另外：**`case 'auto': return null`**（`parseResponse`）是**故意的** —— 多格式探测逻辑在 `queryCustomModel` 里，别以为那是 bug。

### 仍未完成
- [ ] 推送前自检：文件树无 `.dsh/`、无本地状态文件、无任何 API key（**推送需仓库维护者授权，代理不得擅自推**）
- [ ] 验证 B 栏（OpenRouter/siliconflow/Novita/one-api/xAI）的真实字段，修正解析（**需真实 key**）
- [ ] `glm-5-turbo` model id 官方确认（`model_id_mapping.json` 标 `confirmed: false`）
- [ ] **重新取证「未核实」价格条目**（v1.4.0 逐条标了注释，均按 `×7` 保号迁移、显示值未跳变）：豆包 Seed 2.0 全系（火山方舟官方页是 SPA，`.md` 出口返回壳页）、腾讯混元三条、`kimi-k2.5`、`moonshot-v1-*`、`step-1-*`、`deepseek-chat/reasoner/r1` 三条占位价（与 DeepSeek 官方历史价对不上）
- [ ] **海外三家官方定价页复核**：OpenAI / Anthropic / Gemini 在容器环境 403 或地域封锁，v1.4.0 未能取原文 —— `gpt-5.6-*` / `claude-*` / `gemini-3.*` 仍是 radar 二手源
- [ ] **分档价未实现**：GLM-5 系官方分 `[0,32K)` / `≥32K` 两档（本表按更贵的 ≥32K 保守入库）；Qwen `qwen3.6-plus` 有 256K 档 `¥8/¥48`；`qwen3.8-max` 夜间 22:00-08:00 五折 —— 峰谷引擎目前只服务 DeepSeek
- [ ] `qwen3.8-max` / `qwen3.8-flash` 的 cacheHit 是官方**明文例外**（「不是标准输入的 10%，具体见百炼控制台」），现用中转站实测值（¥1.5 / ¥0.1），**有控制台截图请替换**

### 已完成（别重复做）
- [x] `toAmount` 归零问题 → 已加「字段存在性校验」兜底（缺字段→null→显示「未开放」，不冒充「余额 0」）；v1.4.0 又补齐 `openrouter`（守卫 `&&`→`||`，原先只缺一个字段会伪造**负数余额**）与 `deepseek`（`total_balance` 缺失校验）
- [x] **v1.4.2 修复 DeepSeek「读错钱包」**（真机报告 + 复现）：`/user/balance` 的 `balance_infos` 是**一个币种钱包一条**（官方文档 `currency` 取值 `CNY`/`USD`），且**数组顺序不保证** —— 实测同一 key 连打 5 次，第 4 次顺序翻成 `[USD=0.00, CNY=123.45]`（金额为占位）。旧代码 `const p = infos[0]` 盲取第一条 → 有余额的账户显示成 `$0.00 · 异常`，且**下面那道 `total_balance == null` 红线拦不住**（`"0.00"` 是合法字符串，守卫被绕过）。现改为「**主货币优先 → 余额 > 0 → 首条**」确定性挑选，与接口顺序无关。
  ⚠️ 改这块务必跑 `test-deepseek-multicurrency.mjs`（15 条，含顺序翻转 / 全 0 / 字段非法 / 空串 `Number("")===0` 四类）；**该测试对旧代码会挂 8 条**，别把它当成"已通过"就删。
  ⚠️ 同类漏洞家族：`openai-credit-grants`(v1.4.0) / `openrouter`(v1.4.1) / `deepseek` 多币种(v1.4.2) —— 共性是「**选错一条记录 / 选错一个字段，就当真实数字渲染**」。新增任何多记录型接口解析时，先问一句「我挑的是哪一条，凭什么」。
- [x] ~~`git filter-repo` 清历史~~ → **不需要**：v1.1.3 时已重建全新 git 仓库，历史天生干净
- [x] provider 官方/中转三层判定（原唯一开源阻断项）；v1.4.0 又**删掉了 `computeProviderKinds` 里「按 provider 名字猜官方」的兜底**（与铁律 9 冲突）
- [x] ~~价格表币种统一 USD 基准~~ → **v1.4.0 已改为「原生币种」存储**（见第三节；旧的 USD 基准口径是 MiMo / glm-4-plus / 整个历史段 ×7 错价的共同成因）
- [x] 安全审计（无高危）+ 4 项加固：状态文件强制 0600、请求体 256KB 上限、输入清洗、officialProviders 上限
- [x] 测试脚本入仓 `test/` 并改相对路径（clone 即可跑，**v1.4.0: 15 文件 456 断言**）
- [x] v1.4.0 又一并修掉三处交互问题（详见 ① 与 ⑤ 小节）：**拖大肥鱼会被手机壳判成开侧边栏**（`.dshadb-whale-grab` 让路层）、
      **台词气泡压在头顶**（`bottom:calc(100% + 6px)`）、**冷启动挂件硬跳 + 状态条随内容高 2px**
      （真机 LayoutShift 埋点定位：0.01193 / 0.00094+0.00053）
- [x] v1.4.0 修复会话消耗**漏计 `assistant/attempt` 与重试累加**（旧代码读的 `assistant/chunk` 不在 `KNOWN_SESSION_EVENT_TYPES` 里，是死分支 —— 连测试夹具都用错了事件名，所以回归一直没拦住；已改真实事件并新增 `test-cost-projection.mjs`）
- [x] v1.4.0 修复会话消耗**前缀兜底吞模型**（`gpt-4.1` 被 `gpt-4` 吞掉，输出虚高约 37 倍）—— 只认「安全后缀」
- [x] v1.4.0 **子代理消耗可见**（见下方小节「子代理消耗是怎么算出来的」）
- [x] v1.4.0 **状态文件结构版本 `configVersion` + 迁移**：老状态文件里存的旧默认值会把新默认值钉死（`overseasCurrency: 'follow'` 就是这么坑了「原生币种」那版的默认值改动）。**以后只要改动已持久化字段的默认值, 必须 `CONFIG_VERSION +1` 并补迁移。**
- [x] v1.4.0 **设置界面控件统一 + 补深色模式**：`.dshadb_field_select` 去掉系统箭头、数字框去上下箭头、滑块自绘、设置面板/状态条/子代理胶囊补齐 `prefers-color-scheme: dark`（此前一律硬编码白底）。
      ⚠️ 中途曾把「币种」几个 `<select>` 换成插件自己的分段按钮，**已回退**（2 列网格里「人民币」被截成「人民…」，观感更差）。**教训见本页末尾。**
- [x] v1.4.0 **（原最大单点收益）插件读 DSH 的 `settings.yaml` provider 列表** —— 见下方小节「DSH provider 自动入列」。

### 🔌 DSH provider 自动入列（v1.4.0 新增，改这块前必读）

**它解决什么**：此前插件只查自己的 `customRelays`，用户在 DSH 里配好的中转站**一个都查不到余额**，必须去插件设置里手抄一遍 baseUrl + key。这是 v1.4.0 之前最大的体验断点。

**数据流**
1. `readSettingsDerived()` 按 mtime 缓存解析 `~/.dsh/settings.yaml`，一次拿到两份：
   `kinds`（第 2 层官方/中转判定，`computeProviderKinds`）与 `entries`（`parseProviderEntries`）。
2. `selectDshProviders(entries, kinds, optOut)` —— **模块级纯函数**（可单测），三个过滤条件：
   ① 没写 `baseURL` → 跳过（铁律 9 不表态）；② `kinds[name] === 'official'` → 跳过（官方直连归预设平台管）；
   ③ 在 `dshProviderOptOut` 里 → 跳过（大小写不敏感）。
3. `listDshProviderRelays()` 给入选的 provider 解析 key（`resolveApiKeyRef`：env → `credentials` 服务 → `.credentials.yaml` 的 `refs:`，**与 `resolvePresetKey` 同一套三层兜底**），合成 `{ id: 'dsh:<name>', baseUrl, apiKey, queryType: 'auto', fromDsh: true }`。
4. `refreshAll()` 把它与手填的 `customRelays` 合并：**手填优先** —— 同 `id` 或同 `baseUrl`（剥尾斜杠后）不重复查。
5. `queryCustomRelay` 把 `fromDsh` 原样带回余额对象（客户端可以据此加标）。

**用户可见的开关**：设置面板「来自 DSH 的中转站（自动）」区块，**默认全开、每个可单独关**；关掉的写进状态文件 `dshProviderOptOut`，**下次自动发现不会再打开**。官方直连与没写 baseURL 的只展示、不可开。

**⚠️ 别踩的坑**
- **绝不下发 key**：`/api-dashboard/config` 与 `/balances` 里的 `dshProviders` 只有名字/baseURL/`apiKeyEnv`/开关状态。
- **别把 DSH 条目写回 `customRelays`**：那是两个来源，写回去会让用户在设置里看到一堆不是自己加的条目，且关掉后又被写回来。
- **解析器要保持两份结果一致**：`parseProviderBaseURLs`（第 2 层判定用，**返回语义不许改**）与 `parseProviderEntries` 都建立在同一个 `collectProviderFields` 上，`test-dsh-providers.mjs` 有逐项一致断言。
- **`parseProviderEntries` 必须把「有 `apiKeyEnv` 但没 `baseURL`」的 provider 也收进来**（本机 `xiaomi` / `opencode` 就是），否则设置面板没法如实告诉用户「这个没写 baseURL、不表态」。
- 本机实测（8 个 provider）：入列 5 条 `dshzuoxhe` / `jiyuan` / `jiyuanlvdong` / `mimov` / `new`；`zhipu` 判 official 跳过；`xiaomi` / `opencode` 没写 baseURL 跳过。**`jiyuan` 与 `jiyuanlvdong` 共用同一个 baseURL 但 key 不同** —— 按「两个账号」处理、都保留，用户觉得重复可以自己关一个。

### 🔒 五个「看着像小问题、其实有坑」的机制（v1.4.0，改前必读）

#### ① 手机壳的「左边缘开侧边栏」手势会吃掉面板里的横滑（`.dshadb_swipeguard`）

**症状**：在大肥鱼页拖「身体大小 / 探出多少」滑块，**侧边栏（会话抽屉）被拉出来**（维护者两次反馈「滑动的时候容易把侧边栏拉过来」）。
⚠️ 这**不是**我们的挂件抢触摸 —— 挂件锁是另一件事，见 ②。

**根因（读 `dsh-web-mobile` 源码确认）**：手机壳插件 `dsh-web-mobile` 的 `sidebar-swipe` 手势层在
**document 捕获阶段**注册监听（`document.addEventListener('pointerdown', onPointerDown, true)`）。
它的 `beginStroke`：`pointerType` 必须是 touch/pen、起手点落在**屏幕左侧 45%** 以内
（`START_ZONE_RATIO = 0.45`，见 `hitTestStart`）、随后横向位移占优（`LOCK_PX = 8`）→ 判为「左边缘滑入打开抽屉」。
滑块正好在左半屏起手往右拖，全中。**捕获阶段先于我们的任何监听器**，所以
`stopPropagation` / `preventDefault` 都没用 —— 插件的 JS 拦不住。

**修法**：它的 `beginStroke` 里有一条**让路规则**（源码注释：*Strokes starting inside a genuinely
horizontally scrollable container never reach this state at all*）：起手元素若属于「真·横向滚动容器」——
祖先链上任一元素 `getComputedStyle(el).overflowX` 为 `auto`/`scroll` 且 `scrollWidth > clientWidth + 1`
（`findHorizontalScroller`）—— 直接放弃识别。于是给三个遮罩 `.dshadb_scrim` 补 **2px 不可见横向溢出**
（`.dshadb_swipeguard`：`width:calc(100% + 2px);height:0`），整块面板就都落进让路条件。

- ✅ **零副作用的关键**：抽屉自身是 `position:fixed`，遮罩不是它的包含块 → 遮罩滚动**不会**移动面板；
  守卫 0 高度 + `pointer-events:none`，不占位也不吃事件；横向滚动条用 `scrollbar-width:none` + `::-webkit-scrollbar` 压掉。
- ❌ **别改用 `aria-modal="true"` 去命中另一条让路规则**（`modalOpen()` 查的就是它）：手机壳把 `[aria-modal="true"]`
  当自家对话框，大量 CSS 用 `[class*="_header"]` / `[class*="_row"]` / `[class*="_section"]` / `[class*="_tabs"]` /
  `[class*="_titleRow"]` 这类**子串选择器**重排里面的元素 —— 我们的 `dshadb_header` / `dshadb_settings_row` /
  `dshadb_settings_section` / `dshadb_tabs` 全部命中，面板会被改烂；它的 `settings-toolbar-reparent` 任务还会把
  `[aria-modal="true"]` 里的 `[class*="_header"]` **搬进** `_nav`。
- ❌ 也别用 `data-conversation-composer-overlay`（`takeoverActive()` 那条）：会话侧 CSS
  （`.wSkVaW_scrollBody:has([data-conversation-composer-overlay])`）会把 composer 改成 `position:absolute`，
  而我们的面板就挂在 composer dock 里 —— 布局会跳。
- ✅ **v1.4.0 之后又补了挂件本体**（`.dshadb-whale-grab`，同一条让路规则）：挂件此前完全没有守卫。
  维护者反馈「滑大肥鱼、从左往右滑，侧边栏被拉过来」—— 复现位置是**鱼停在屏幕左侧 45% 以内时**
  （典型 = 左边缘吸附位；按 360px 视口、scale 0.6 的 64.8px 鱼算，贴左边时可见区 ≈ x∈[0,32]，正落在识别带 `[0,162]` 里；
  贴右边时 ≈ x∈[328,360]，**不会**被判定）。挂件自己的拖拽同时也照常执行，所以现象是「鱼被拖走了 + 抽屉被拉出来」。
  修法：在 `.dshadb-whale-body` **内部**垫一层透明抓取层（`overflow-x:auto` + 0 高度 `width:calc(100%+2px)`
  守卫子元素 + `touch-action:none` + 隐藏滚动条），起手点落在它身上 → `findHorizontalScroller` 命中 → 手机壳放弃识别。
  - ⚠️ **必须挂在 body 内部**（不是 root 下）：这样 `pointerdown` 才照常冒泡到 body 上已有的拖拽处理器，
    拖拽代码一行不用改。挂 root 下同样能让路，但鱼也拖不动了 —— `test-dshadb-client.mjs` 的 C14 用真建出来的
    元素树钉住了这条（`test-bar.mjs` 另有源码级断言）。
  - ⚠️ **`touch-action:none` 必须写在这一层**：滚动容器是浏览器判定可触摸行为的终点，漏了它横向 pan
    会被这个滚动容器自己抢走（`pointercancel`）→ 鱼直接拖不动。
  - ⚠️ **别改成给 `.dshadb-whale-body` 加 `overflow`**：那会把它里面 `img` 的 `drop-shadow` 裁掉，鱼会显平。
  - ⚠️ `pointer-events` **不是「继承即锁」**：抓取层自己写了 `auto`，body 被 `.dshadb-whale-locked`
    锁成 `none` 时它照样吃事件 —— 必须单独写 `.dshadb-whale-locked .dshadb-whale-grab{pointer-events:none}`。
  - 代价：鱼压在左边缘时，它盖住的那 ~32×65px 不能再作为「左边缘开抽屉」的起手点（同面板守卫的取舍）。

#### ② 大肥鱼挂件给我们的面板让路（`.dshadb-whale-locked`，是加固、不是 ① 的根因）

**症状**：面板开着时拖滑块，可能拖走的是挂件（而不是滑块）。

**机理**：挂件是 `document.body` 的直接子元素（`z-index:9600`），而面板嵌在 **DSH 的 `composer.dock`** 里。
`z-index` **只在同一个层叠上下文里比较** —— 只要面板的某个祖先带 `transform` / `filter` / `contain` / `will-change`，
`position:fixed` 的面板就被关进那个祖先的层叠上下文，`z-index:99999` 只在内部有效，
挂在 body 上的挂件反而盖在面板上面，把滑块的拖拽吃掉。
⚠️ 这条是**按层叠规则推断**的（容器里看不到真机渲染，没有实测确认）—— ① 才是经源码证实的根因。
两者不冲突，都留着：① 管「手势层」，② 管「挂件抢触摸」。

**修法**：~~`overlayOpen` → 挂件根节点加 `.dshadb-whale-locked` → `pointer-events:none`~~
→ ⚠️ **v1.4.1 定稿：任何界面下都不再自动上锁**（维护者两次反馈「设置里打开大肥鱼后图片拖不动，得关掉才能动」，
随后明确要求全部放开）。现在只留一句 `setWhaleLocked(false)`。
**锁的机制保留着**（`setWhaleLocked` / `.dshadb-whale-locked` CSS / `onDown` 里那道 `classList.contains` 兜底）：
万一以后又出现「面板开着时拖滑块被挂件吃掉」，把那一行换成 `setWhaleLocked(view !== "bar")` 即可恢复。
❌ **不要**再写回 `const overlayOpen = isSettingsOpen || view !== "bar"`（`test-bar.mjs` 已钉住「不自动加锁」）。
`whaleLocked` 记在**模块变量**里：用户在设置里刚打开大肥鱼时挂件才被挂上，创建时也要立刻套用锁定态。

- ❌ **别改成 `display:none` / 直接卸载挂件** —— 调大小、露出比例时用户**要看实时预览**，隐藏等于把功能阉了。
- ❌ 别指望把挂件的 `z-index` 调低了事：它本来就已经比抽屉低，问题出在**层叠上下文被祖先切断**，比的是两套坐标系。
- 顺带把大肥鱼滑块触摸区 `24px → 34px`（圆点 `20 → 24px`）：太薄的滑块贴着卡片边缘很容易起手失败。

#### ③ 余额端点三分支取数策略（`planBalancesFetch`）

`/api-dashboard/balances` 有三个查询参数语义，**别把它们合并**：

| 请求 | 策略 | 什么时候用 |
|---|---|---|
| `?force=1` / `POST` | `wait` —— 阻塞等 `refreshAll()` 完成 | 手动刷新按钮、保存设置后（用户明确要新数据） |
| `?stale=1` | `background` —— **立刻回手上有的**，刷新丢后台 | 首屏挂载、`visibilitychange` 切回前台 |
| 不带参数 | 过期才 `wait`，否则 `none` | 常规轮询 |

**为什么要有 `stale=1`**：`force` 那条路要等一次**全量**轮询，而 `refreshAll` 是 `Promise.allSettled` ——
整体耗时取决于**最慢**的那个端点，最长能拖满 `timeoutMs`（默认 8s）。首屏走 force，用户看到的就是
「切掉后台重新进来，插件加载有点慢，要等一段时间」。
策略抽成了纯函数（`wait`/`background`/`none`）+ `test-fetch-policy.mjs` 29 条断言 —— **很容易被顺手改回阻塞式，所以钉死**。

- ⚠️ **v1.4.1 起冷启动不再阻塞**：`planBalancesFetch` 在 `!hasData` 时返回 `background`（旧行为是 `wait`）——
  服务端立刻回 `{balances:[], loading:true}` 并把刷新丢后台，客户端保持**骨架屏**、把轮询临时压到 1.5 秒，数据一到就上屏。
  **这不是假数据**：界面显示的是"加载中"，不是 0 元。实测（维护者 5 个中转站，全量刷新 8~13.6s）：
  冷启动前 5 发请求都是 2~3ms 返回 `loading:true`，第 6 发（约 7 秒）拿到 21 个平台。
  只有 `force=1`（用户主动点刷新/保存）仍然阻塞等。
- 📌 **A（端点记忆）**：`queryCustomRelay` 的 auto 探测是**串行**试 3 个候选端点、每个跑满 `timeoutMs`，
  这是全量刷新慢的主因。现在把命中过的端点存进状态文件 `relayEndpoints`，下次**排到候选最前**，稳态每个中转站只打 1 个请求。
  只改顺序、候选全表仍会试，所以中转站换端点也能自动跟上。实测：第三个候选才命中的假中转站，重启后只收到 1 个请求。
  ⚠️ 对「三个端点全不支持余额接口」的中转站（维护者本机 5 个都是）**没有帮助** —— 它们没有可记忆的命中端点。
- ⚠️ 首屏/恢复走 `stale=1` 后，**新数据靠下一次轮询带上来**（服务端已在后台刷）。别在客户端再补一次 `force`，那就白改了。
- ℹ️ 「加载慢」还有一半是 **DSH 自己的行为**：应用切回前台时 webview 可能整页重载，所有插件重新 init，这段不归插件管 —— 回答用户时要如实说明，别全揽到自己头上。

#### ④ 刷新间隔下限是 1 秒（`clampRefreshSec`）

用户要求「调成最低 1 秒」。三处必须同时改，少一处就会被夹回去：
`client/client.js` 的输入框 `min`/`step` 与 `onChange` 夹取、`refresh()` 里 `clientPollIntervalMs >= 1000` 的接受阈值、
服务端 `clampRefreshSec`（1~60）。
⚠️ 1 秒＝请求量 ×5，**平台接口可能限流**；插件只保留了「强刷 2 秒节流」这一道兜底，别再放宽。

#### ⑤ 冷启动的布局稳定：别「先用默认值画、再异步改成真值」（挂件 + 状态条）

**怎么发现的**：维护者报「重启后首次进入界面会抽搐一下」，随后更正为「打开设置界面才抖」。
读代码分不清是谁在动 —— 于是**用 LayoutShift 的 attribution 直接点名**：
`new PerformanceObserver(...).observe({ type: 'layout-shift', buffered: true })`，取
`entry.sources[].node / previousRect / currentRect`（`buffered:true` 能补上探针安装**之前**已发生的位移），
再把「打开设置面板」那一刻的时间点一起上报。真机（360×754、dpr=4）拿到三笔：

| 位移节点 | 前后 rect | CLS | 归属 |
|---|---|---|---|
| `div.uV2eYG_scroll` | [0,0,0,0] → [16,580,322,36] | 0.01725 | 外壳自己的会话容器首帧，**不归我们** |
| `span.dshadb_barwrap` | 124×26 → 230×**28** | 0.00094+0.00053 | 我们：状态条随内容长高 2px |
| `div.dshadb-whale-grab` | **[306,467,54,108] → [327,160,33,65]** | **0.01193** | 我们：挂件跳 307px + 缩 108→65 |

- **挂件**：`ensureWhaleWidget()` 先用默认值（`scale=1` → 108px、贴右边、`top=62%` 屏高）画出来，等
  `/whale/settings` 回来才改成保存值 → 那一帧默认值被看见，紧接着硬跳（此刻 `transition` 还是 `none`，是跳不是滑）。
  **规矩：任何「先画默认值、再异步修正」的挂件都必须首帧隐藏**（`root.style.visibility = "hidden"`），拿到真值再
  `reveal()`；露出要**幂等**、要接在**所有**分支上（成功 / 失败 / 中间提前 `return` 都要接，本插件用 `.then(reveal)`
  收尾），并留**兜底定时器**（本插件 2s）—— 少任何一条，一次请求异常就会让挂件**永远不出现**。
  改这块务必跑一遍"五分支"验证（正常 / ok 但没 settings / 请求失败 / 请求永不返回 / 兜底先触发再回来）。
- **状态条**：空态内容 18px、有数据态 20px → 26px 变 28px，把上面的会话区顶 2px。
  给 `.dshadb_bar` 加 `min-height:28px;box-sizing:border-box`（28 = 有数据态的实测总高，所以有数据时外观不变）。
  **用 `min-height` 而不是 `height`**：系统字体放大时仍能自然增高、不会裁字。
- ⚠️ **现象会被归因错，先拿时间线再信结论**：`whaleEnabled` 搭在 `/api-dashboard/balances` 响应的 `config` 里，
  而服务端对「刚重启、无缓存」的 `?stale=1` 仍走 `wait` → `await refreshAll()`（最长 `timeoutMs`=8s）→ 冷启动时配置
  **~10s** 才到，挂件那时才创建、随即跳一下；用户正好在那几秒里开着设置面板，就归因到了设置面板上。
  真机时间线：`settings-opened` t=8357 → `whale-created` t=10394 → `whale-settings-applied` t=10433 → 位移 t=10908。
- ℹ️ 顺手否掉一个**看似合理但错**的假设：设置面板自己「先空壳后填充」（`relays:[]` / `dshProviders:[]` /
  `wf.scale=1` 起手，两个接口回来才填）**不会**造成位移 —— 抽屉是 `position:fixed` + `max-height:86vh`，
  高度五次采样全是 648（=0.86×754），内容在内部滚动。**定高 + 内部滚动的面板，内容填充不登记 layout-shift。**
  （附带实测：首次打开设置时那两个请求 3 秒内都没回来，暖了之后 35ms —— 冷启动首次打开的"空壳期"确实很长。）
- ⚠️ 定位用的探针与临时路由（`/api-dashboard/diag`）**已经整段删除**。探针当时只装在真机（要求
  `navigator.userAgent` 含 Android），所以测试的假 DOM 不受影响；下次复现照上面的 PerformanceObserver 写法重加即可。
- ⚠️ **删临时埋点时逐块删、并要求"恰好命中一次"**（脚本里 assert 命中数，不符就整体中止不写盘）：
  本轮清理时匹配片段漏了 `{ ` 前缀，把 `className: "dshadb_barwrap"` 一起删掉 → `createElement("span", {  })`，
  **语法照过、其余断言照绿**，但列布局会失效。已加结构完整性断言钉住（类名必须在 + 不允许空属性对象）。

### 🧩 子代理消耗是怎么算出来的（v1.4.0 引入并修冷会话，改这块前必读）

投影 `queryBalanceCost` 只折叠**本会话**的事件。子代理跑在自己的**子会话**里，所以它的消耗不在主板数字里 —— 这是设计使然，不是 bug。子代理那一行是**旁路读出来的**。

⚠️ **最关键的一条：子代理会话会「由热转冷」，必须两条路一起走。**
框架的 `SubagentListEntry.activity` 只有 `'running' | 'inactive'`，注释原文是「`inactive` that it **exists only in persistence**」。子代理跑完（或其 turn 结束）后就不在 `ctx.sessions` 的常驻表里了 —— 这时 `sessions.get()` 返回 undefined，只走热路径会**读不到钱、面板显示 `~—`**（第一版就是这样翻车的，实测踩到）。

**热路径（首选，数据更新鲜）**
1. `init(header, inheritedEventCount)` 把 `header.id` 存进投影状态的 `sessionId`（子代理汇总要拿它去查 `subagentCatalog`），
   同时记下 fork 继承边界（见下方第 8 条）。**状态字段一改就要继续 bump `stateVersion`**（现为 **3**）。
2. `ctx.sessions.get(id)` → `sessionProjections.snapshot(session, ['subagentCatalog'])` 拿**直接子会话列表** —— 顺序就是父会话的 catalog 事件顺序（= 创建顺序），客户端**不重排**。
3. 每个子会话用 `stateOf(childSession, 'queryBalanceCost')` 取**同一个 unit 的状态**，喂给**同一个 `summarize()`** —— 保证与主板数字口径一致（峰谷 / 原生币种 / 缓存分桶）。

**冷路径（兜底，`readSessionCacheRecord`）**
4. 直接同步读 `~/.dsh/storages/session_projcache/sessions/<sessionId>.json`，取 `record.rows.queryBalanceCost.val` / `record.rows.subagentCatalog.val`（形状取自实测；`catalog` 在 `val.head.values[]`，字段 `childId`/`childCreatedAt`/`mode`/`label`）。
5. 带 **3 秒 TTL 内存缓存**（`view()` 会随每次投影变化被调用，不能每次读盘）；sessionId 过 `^[A-Za-z0-9._-]{1,128}$` 白名单防路径穿越；坏 JSON / 缺文件 / 形状不符一律**静默返回 null**。
6. ❌ **别改用框架的 `listChildren()` / `listDescendants()`**：它们确实能处理冷会话（走投影缓存读），但**是 async**，而投影的 `view()` 契约要求**同步**（`ProjectionDefinition` 原文：「All functions MUST be synchronous」）。

**汇总规则（2026-09-11 维护者反馈后改写，改前必读）**
7. 子代理那一行**只显示「它自己新产生的消耗」**，两条硬规则：
   - ❌ **不含继承的父会话历史**。子代理若是 fork 出来的，子会话的日志/投影里带着父会话的全部事件，
     直接 `summarize(state)` 会把父会话的历史算进这一行 —— 用户实测看到「只用 DeepSeek 的子代理也挂着一笔
     USD」。所以投影里把状态拆成两份：`byModel`（full，原算法不变，主会话口径）与 `own`（只用
     `seq >= inheritedEventCount` 的事件折叠）。
   - ❌ **不含兄弟/后代**。原来的「自身 + 后代递归向上汇总」已**删除**；`subagentCatalog` 里继承来的条目
     也要按同一把尺子过滤（`ownChildIds`），否则 fork 出来的子会话会把它的兄弟列成自己的子代理。
8. 边界值来自框架，**不要自己猜**：`ProjectionDefinition.init(header, inheritedEventCount)`
   （`dsh-session-projection` 的 `buildCell`/`restore` 都传第二个参数）。框架自己的
   `subagentCatalog` 投影用的就是同一套判据：`if (event.type !== 'subagent/catalog' || event.seq < state.inheritedEventCount) return state`。
   ⚠️ 拿不到边界（`ownBoundaryKnown` 为假）时**宁可显示等待，也不要退回 full** —— 显示错的数字比不显示更糟。
9. `stateVersion` 已 bump 到 **3**：v2 的缓存行里没有 `own` 字段，冷路径按版本号识别并当作「等待自身用量」，
   不做「旧缓存凑合显示」。改状态字段记得继续 bump，并同步 `cachedCostState` 里的版本判断。
10. 行数封顶 `SUBAGENT_MAX_ROWS=12`。全部调用包在 try/catch 里：**取不到服务 / 会话不存在 / 宿主抛异常 → 静默降级**，
   绝不让子代理汇总拖垮主投影。`SUBAGENT_MAX_DEPTH` / `mergeSummary` 已随递归汇总一起退役（`mergeSummary` 仍导出、有单测）。

**展示**
11. 客户端 `buildSubagentRow()`：**固定单行 + 横向滑动**（`flex-wrap:nowrap` + `overflow-x:auto` + 名字截断 72px）。子代理一多就往右滑，**绝不换行** —— 否则会把输入框往上顶。
12. 完整详情走**自定义长按浮层**（`.dshadb_subtip`，见下条铁律），**不要改回 `title`**。
    ⚠️ 「等待自身用量」（`waiting: true`，wire 里 `cost: -1`）与「真实零消耗」（`cost: 0`）**必须分开**：
    文案上都是 `~—`，但 tooltip 不同；`buildSubagentRow` 里判断用的是 `f.hasValue`（真实零）与
    `formatSessionCost` 收到 `waiting` 时返回 `null`（等待）—— **别把 `hasValue` 去掉**，
    否则零消耗会显示成 `~¥0.00`（`test-bar.mjs` 的「零消耗 → ~—」会挂）。

⚠️ **主板 `cost` 仍然只含本会话**，子代理在 `view.subagents[]` 里单独给。**别把两者相加成一个数字** —— 会把两种口径混在一起，也违背 v1.3.2「不做汇率折算合并」的既定原则。

⚠️ **UI 教训 1（窄容器）**：曾把设置里的「币种」`<select>` 换成插件自己的分段按钮，结果在 2 列网格里「人民币」被截成「人民…」，**观感反而更差**（用户原话「还不如不改」）。**窄容器里优先保证文字完整**；要改控件外观，先确认最长的那个文案放得下。

⚠️ **UI 教训 2（别用 `title` 做触屏提示）**：子代理胶囊原先把完整详情放在 `title` 里，**手机上 `title` 根本不显示** —— 长按弹的是系统「选择/复制」菜单（用户反馈「长按只能复制」，v1.4.0 实测）。
**凡是「长按/悬停才能看到」的信息，在触屏上都必须自己实现**：
- `pointerdown` 起计时器（本插件用 420ms），`pointermove` 位移 > 8px（= 用户其实在滑这一行）或抬手就取消；
- 浮层挂 `document.body` 并 `position:fixed` —— 挂在原位置会被祖先的 `overflow-x:auto` / `overflow:hidden` 裁掉，z-index 要高过抽屉(99999)；
- 加 `-webkit-touch-callout:none` + `user-select:none` 压掉系统菜单，否则浮层和复制菜单会一起弹；
- 点别处 / 滚动 / 超时都要能收起（`pointerdown` 用 capture 阶段监听，才不会和胶囊自己的 pointerdown 打架）；
- 内容用 `textContent` 写，**别用 `innerHTML`** —— label 可能来自用户或模型。