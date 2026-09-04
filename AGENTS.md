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

---

## 二、安装须知（AI 代理注意！）

### ✅ 正确的安装方式（推荐 - 一行命令）

```sh
dsh plugin --profile web add dsh-api-dashboard
```

### 备选（从 GitHub 手动安装）

```sh
# 1. 下载
curl -L "https://codeload.github.com/133563825as-ai/dsh-api-dashboard/tar.gz/refs/heads/main" -o /tmp/dsh-api-dashboard.tar.gz
# 2. 解压(必须带 --strip-components=1)
mkdir -p /root/dsha-api-dashboard
tar xzf /tmp/dsh-api-dashboard.tar.gz -C /root/dsha-api-dashboard --strip-components=1
# 3. 安装进 profile(自动装依赖+自动注册 bundle 层)
dsh plugin --profile web add file:/root/dsha-api-dashboard
# 4. 重启 dsh web
```

### 安装姿势对照（实测）
| 姿势 | 后果 |
|------|------|
| `dsh plugin --profile web add dsh-api-dashboard`（npm 裸包名） | ✅ 推荐，一行命令 |
| `dsh plugin --profile web add file:/root/dsha-api-dashboard`（源码方式） | ✅ 备选 |
| `pnpm add <远程 tarball URL>` | ❌ pnpm 不剥顶层目录 → 装出空壳 |
| 手动软链 node_modules | ⚠️ 可用但极易错层级, 会被启动校准摘除, 不推荐 |

---

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

> **价格表（`MODEL_PRICES` / `V4_RATES`）来源与币种（2026-09-04 更新）**：
> - **DeepSeek 走 `V4_RATES` 峰谷 CNY 表**——已对照[官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)核实，值与时区窗口(北京时间周一至周五 9-12/14-18 高峰、空闲=半价)**完全正确**；`deepseek-v4-flash-vision-exp` 与 flash 同价，`deepseek-chat/reasoner/r1` 已 2026-07-24 退役(调用报错)。USD 表是 ~7 汇率换算的近似，非官方直发。
> - **通用 `MODEL_PRICES`**：现役主力(OpenAI GPT-5.6 / Claude 4.x·5 / Gemini 3.x / Kimi K3·K2.x / StepFun / 豆包 Seed 2.0 / 混元 2.0) 来自 NousResearch hermes-agent `usage_pricing.py`、StepFun[官方定价](https://platform.stepfun.com/docs/zh/guides/pricing/details)、[modelradar.cn](https://modelradar.cn/data/models.json)(各条带 sourceUrl 指向厂商官方页)等，**统一存 USD/百万tokens 基准**：StepFun / MiMo / Qwen / 豆包 / 混元官方页是 CNY，入库前 **÷7 换算成 USD**（注释里标了原 CNY 价）；`resolveModelPrice` 返回时按用户「计价货币」换算（选 CNY ×7、选 USD 原样，与 DeepSeek `V4_RATES` 两套表口径一致）。一手价未取到的模型→落 defaultPrices(未定价)，**别乱填**。旧模型(2025-08)条目标为"历史/参考"。仅估算用，实际以平台为准。
> - ⚠️ **第三方聚合源只作参考，与原表冲突时不要盲信**：modelradar 2026-09-03 快照里 GPT-5.6 系输出价全呈「输入×1.25」异常模式(疑似抓错列)、且不跟踪促销价(qwen3.7-max 报的是原价) → **这两类已故意未采纳**，注释中有标注，别当遗漏"修回去"。
> - 🔴 **`cacheHit` 缺官方佐证时别标「无缓存折扣」**（v1.2.3 血泪）：`glm-5.3-flash` 曾被标 `cacheHit = cacheMiss`，长会话数百万缓存读 token 全按全价计 → 用户实际充值 5 元、面板显示消耗 ¥9.93。GLM 系缓存读实为**输入的 20%**（同表 `glm-5.2` 0.26/1.4、`glm-5-turbo` 0.24/1.2 交叉佐证 + 用户真实账单反推；**非官方明文**，拿到官方价以官方为准）。已加回归断言「GLM 系 `cacheHit` 必须 < `cacheMiss`」。**真的无折扣才写等值，不确定就按同厂同系比例推并注明依据。**
> - 💱 **v1.3.2 起币种不是全局唯一的**：`resolveModelPrice` 的币种由 `currencyForModel(config, model)` 决定——
>   海外模型（`modelRegion(model)==='海外'`）在 `overseasCurrency` 非 `'follow'` 时走它，其余跟 `currency`。
>   **改价格解析时别再假设「一个会话只有一种货币」**：`makeCostProjection` 的视图给的是 `costByCurrency`（按币种分组），
>   混合会话客户端两段拼接显示，**绝不要为了凑成一个数字而按汇率折算合并**——那正是 v1.2.x 想摆脱的 ×7 误差来源。
>   `modelRegion` 未命中的模型**不表态、走主货币**（保守），新增模型时若产地重要，去补 `OVERSEAS_MODEL_PREFIXES` /
>   `DOMESTIC_MODEL_PREFIXES` 前缀表，别在别处硬编码判定。
> - ⏰ **促销价有时效，到期要更新**：`glm-5.3-flash` 促销 **2026-09-09 到期**（最近）；`gemini-3.8/3.7/3.6-flash` 2026-12-31 到期后翻倍；`gpt-5.6-sol` 促销至少到 2026-11-21(列表价 $5/$30)；`qwen3.7-max` 5 折、`qwen3.8-max` 90 天/100 万 token 免费额度。`qwen3.8-max` 夜间 22:00-08:00 五折**未实现**（峰谷引擎目前只服务 DeepSeek）。

---

## 四、维护铁律（改代码前必读）

1. **先备份再改**：改 `client/client.js` 或 `src/index.js` 前，先 `tar` 一份 / 存回退点。用户习惯 A/B 对比+回滚。
2. **推送前问维护者**：默认只做本地改动与本地测试。**别擅自推 GitHub / 发 npm**。
3. **测试方法**：`node --check <文件>` 只查语法；真正的客户端改动要**重启 dsh web GUI** 才进 bundle。运行在容器里时别贸然重启(会断会话)。
4. **改 UI 结构要克制**：UI 方向尚未定稿(半屏/三Tab/核心分组几种方案均已否决)，已确认保留的是「**玻璃背景**」。别擅自大改 UI 结构。
5. **玻璃色经验**：浅色用纯白 rtgba(255,255,255,0.72)，深色走 `@media(prefers-color-scheme:dark)`。**别用 CSS `color-mix` 跟 token 推玻璃色**——会发灰。
6. **版本闭环**：任何对已发布功能的改动，记得 bump `package.json`/`package-lock.json` 版本 + 更新 README changelog，推 GitHub 后老用户面板会提示更新。
7. **provider 判定别改回硬编码名单**：官方/中转三层判定（用户显式名单 → settings.yaml 的 baseURL 域名白名单 → `-official` 后缀）是开源化改造的关键，**千万别把「官方 provider 名单」写回客户端硬编码**——别人的中转站叫什么猜不到。判定的服务端逻辑在 `src/index.js` 的 `parseProviderBaseURLs` / `computeProviderKinds` / `isOfficialHost`，客户端落地在 `client/client.js` 的 `isRelayProvider(provider, config)`。没写 baseURL 的 provider 是「不表态、交后缀兜底」，**别**去读 pi-ai 内置目录补官方域名（`xiaomi` 就是内置目录指向官方域名、但 key 实际来自中转站的反例）。

---

## 五、自动更新机制（v0.6.0+)

- `GET /api-dashboard/update`：对比 GitHub main 的 package.json version，5 分钟缓存。
- `POST /api-dashboard/update/install`：下载→校验→备份→原子替换→失败回滚，重启生效。
- 改代码时别破坏这两个端点；`applyUpdate` 有 `remoteVersion`/`localTarball` 测试注入口。

---

## 六、开源发布前待办（2026-09-04 校准）

### 仍未完成
- [ ] 推送前自检：文件树无 `.dsh/`、无本地状态文件、无任何 API key（**推送需仓库维护者授权，代理不得擅自推**）
- [ ] 验证 B 栏（OpenRouter/siliconflow/Novita/one-api/xAI）的真实字段，修正解析（**需真实 key**）
- [ ] `glm-5-turbo` model id 官方确认（`model_id_mapping.json` 标 `confirmed: false`）
- [ ] `glm-5.3-flash` 缓存读 20% 口径求官方明文佐证（现为交叉推断，见第三节红色条目）

### 已完成（别重复做）
- [x] `toAmount` 归零问题 → 已加「字段存在性校验」兜底（缺字段→null→显示「未开放」，不冒充「余额 0」）
- [x] ~~`git filter-repo` 清历史~~ → **不需要**：v1.1.3 时已重建全新 git 仓库，历史天生干净
- [x] provider 官方/中转三层判定（原唯一开源阻断项）
- [x] 价格表币种统一 USD 基准 + `resolveModelPrice` 按 currency 换算
- [x] 安全审计（无高危）+ 4 项加固：状态文件强制 0600、请求体 256KB 上限、输入清洗、officialProviders 上限
- [x] 测试脚本入仓 `test/` 并改相对路径（clone 即可跑，**10 文件 190 断言**）