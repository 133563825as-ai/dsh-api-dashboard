/**
 * dsh-api-dashboard — server half (v3 完整版).
 *
 * 多平台 API 余额/用量看板。内置全部国内外平台预设，支持:
 *   - 海外官方: DeepSeek / OpenAI / Claude / Gemini / Groq / Mistral / Together / OpenRouter / Ollama
 *   - 国内平台: 智谱GLM / 通义Qwen / Kimi / 阶跃StepFun / 硅基流动 / 基元律动 / 小米MiMo / 百度千帆 / 阿里百炼 / 腾讯混元
 *   - 中转站: one-api / new-api 系 quota, 通用 OpenAI 兼容中转站
 *   - 自定义中转站: 用户填 base_url + api_key, 自动探测余额端点, 能查显示, 查不到标未开放。
 *
 * 学习 dsh-balance 架构:
 *   - 服务端按 refreshIntervalMs 定时拉取各平台余额并缓存 (stale-while-error)。
 *   - HTTP 路由 /api-dashboard/balances 提供只读缓存给前端。
 *   - sessionProjections 单元 queryBalanceCost 估算本会话消耗 (按模型单价)。
 */

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync, mkdirSync, rmSync, cpSync, statSync, lstatSync, readdirSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join, dirname, basename } from 'node:path'

/**
 * peer 依赖加载器（v1.4.1）—— 这一条直接决定「别人下载后能不能用」。
 *
 * 病症（真机实测复现）：用户按 README 执行 `dsh plugin --profile web add dsh-api-dashboard`，
 * 安装成功，但启动时 **整个 dsh web 起不来**：
 *
 *   Cannot find package '@deepseek-ai/schemastery' imported from
 *   /root/.local/share/pnpm/store/v10/files/42/e96689...
 *
 * 链路：profile 用 hoisted linker + autoInstallPeers:false（插件把它声明成 optional peer），
 * DSHA 的 proot 带 `--link2symlink`，于是 pnpm 的硬链接被降级成**指向全局 store 的软链**；
 * Node 的 ESM 会先把模块解析成 realpath，再从那开始向上找 node_modules ——
 * 从 store 目录往上永远也走不到 `$DSH_HOME/profiles/node_modules`（DSH 放宿主依赖的地方）。
 *
 * 修法：先按常规 import；失败时改用宿主自己的模块回退目录做 CJS 解析
 * （`createRequire` 用的是**给定路径**而不是 realpath，因此能穿透这层软链）。
 * 这样 npm 安装、源码安装、软链安装三种布局都能加载。
 */
const resolvePeer = async (spec) => {
  let primary = null
  try { return await import(spec) } catch (e) { primary = e }
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const bases = [
    join(home, 'profiles', 'node_modules', '__dshadb_resolver__.cjs'),
    join(home, 'profiles', process.env.DSHA_STARTUP_PROFILE || 'web', 'node_modules', '__dshadb_resolver__.cjs'),
  ]
  for (const base of bases) {
    try {
      const entry = createRequire(base).resolve(spec)
      return await import(pathToFileURL(entry).href)
    } catch { /* 试下一个基准目录 */ }
  }
  throw primary
}

const schemaMod = await resolvePeer('@deepseek-ai/schemastery')
const Schema = schemaMod.default ?? schemaMod
const zodMod = await resolvePeer('zod')
const z = zodMod.z ?? zodMod.default?.z ?? zodMod

export const name = 'dsh-api-dashboard'

// ============================================================
// 自动更新模块 (v0.6.0): GitHub 远端版本检查 + 一键自更新
// 流程: check(api.github.com 读远端 manifest version)
//      → install(codeload 下载 → 临时目录解压校验 → 备份 → 原子交换 → 回滚兜底)
// 仅允许更新为「严格更新」版本, 不接受降级; 不接收任何路径类入参.
// ============================================================
const REPO_OWNER = '133563825as-ai'
const REPO_NAME = 'dsh-api-dashboard'
const REPO_BRANCH = 'main'
const MANIFEST_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/package.json?ref=${REPO_BRANCH}`
const TARBALL_URL = `https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/tar.gz/refs/heads/${REPO_BRANCH}`

/** 插件运行实体的安装根目录 (src/index.js 上两级; ESM 默认按 realpath 加载) */
/**
 * 插件自身的安装根目录（v1.4.1）。
 *
 * 不能只用 `dirname(dirname(import.meta.url))`：ESM 会把符号链接解析成 realpath，
 * 而 npm 装进 profile 后文件常常是**指向 pnpm store 的软链** → 算出来的根目录是
 * `.../store/v10/files`，于是 assets（图标 / 大肥鱼贴图 / 音效）全部 404、
 * 版本号也读不到（一键更新会误判）。
 * 这里按候选顺序找第一个「package.json 里 name 就是本插件」的目录。
 */
const resolveSelfRoot = () => {
  const fromUrl = dirname(dirname(fileURLToPath(import.meta.url)))
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profile = process.env.DSHA_STARTUP_PROFILE || 'web'
  const candidates = [
    fromUrl,
    join(home, 'profiles', profile, 'node_modules', 'dsh-api-dashboard'),
    join(home, 'profiles', 'node_modules', 'dsh-api-dashboard'),
  ]
  for (const dir of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (pkg && pkg.name === 'dsh-api-dashboard') return dir
    } catch { /* 试下一个 */ }
  }
  return fromUrl
}
const SELF_ROOT = resolveSelfRoot()

/** 读取指定目录中 package.json 的 version, 异常返回 null */
const readVersionAt = (dir) => {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version) ? pkg.version : null
  } catch { return null }
}

/**
 * v1.5.0-desktop-preview 系列: 预发行(预览版)标识。
 * 判定只看版本号本身 —— semver 预发布后缀(`1.5.0-desktop-preview.2` 里 `-` 之后那一段)
 * 就是"这不是正式版"的唯一事实来源, 不额外加配置项(加配置项 = 两处真相, 迟早漂移)。
 * 用途: ① 下发给客户端, 前端据此显示「预览版」横幅; ② 预览版**不参与一键自更新**
 * (否则一次误点就被 main 的正式版覆盖, 预览用户会莫名回退)。
 */
const PLUGIN_VERSION = readVersionAt(SELF_ROOT) || '0.0.0'
const IS_PREVIEW = PLUGIN_VERSION.includes('-')

/** 轻量 semver 比较: a>b 返回 1, a<b 返回 -1, 相等返回 0 (忽略预发布后缀) */
export function semverCompare(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number)
  const pb = String(b).split('-')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0
    const y = Number.isFinite(pb[i]) ? pb[i] : 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** 经 api.github.com Contents API 读取远端 main 分支的 package.json version */
async function fetchRemoteVersion(timeoutMs = 8000) {
  const res = await fetch(MANIFEST_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-api-dashboard-updater' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const meta = await res.json()
  const content = Buffer.from(meta.content ?? '', 'base64').toString('utf8')
  const parsed = JSON.parse(content)
  return typeof parsed.version === 'string' ? parsed.version : null
}

/**
 * 下载并校验最新 tarball 到临时目录, 通过后对每个目标目录执行替换.
 * 任一目标替换后校验失败即从本次备份自动回滚.
 * @param {object} opts
 * @param {string[]} opts.targets 待替换的插件根目录列表 (缺省自动探测; 测试可注入)
 * @param {number} opts.timeoutMs 下载超时
 * @param {string} [opts.remoteVersion] 测试注入口: 跳过 GitHub 版本查询
 * @param {string} [opts.localTarball] 测试注入口: 使用本地 tarball 代替 codeload 下载
 * @returns {{installed:string, targets:string[], backup:string}}
 */
export async function applyUpdate({ targets = null, timeoutMs = 30000, remoteVersion = null, localTarball = null } = {}) {
  const currentVersion = readVersionAt(SELF_ROOT)
  const wantVersion = remoteVersion !== null ? remoteVersion : await fetchRemoteVersion(timeoutMs).catch(() => null)
  if (!wantVersion) throw new Error('remote version unavailable')
  if (currentVersion && semverCompare(wantVersion, currentVersion) <= 0) {
    throw new Error(`already up to date (${currentVersion})`)
  }
  // 待写入目录: 运行实体优先; 若经典源码目录 (~/dsha-api-dashboard) 存在
  // 且是与运行实体不同的另一条真实路径, 一并同步, 避免链接形态下两边版本漂移.
  // (仅在缺省自动模式下探测; 显式注入 targets 的测试/调试调用不受影响)
  const dirs = Array.isArray(targets) && targets.length ? [...new Set(targets)] : [SELF_ROOT]
  if (!Array.isArray(targets)) {
    try {
      const legacyReal = realPathSafe(join(homedir(), 'dsha-api-dashboard'))
      const selfReal = realPathSafe(SELF_ROOT)
      // H-2 (v1.4.1): 自动同步 ~/dsha-api-dashboard 只对「非 git 工作区」生效。
      // 以前不判断, 于是维护者/开发者的 git clone 会在一次"一键更新"后被 tarball 覆写 ——
      // codeload 的 tarball 里**没有 .git**(已实测), 删掉就再也回不来。
      if (legacyReal && selfReal && legacyReal !== selfReal
          && existsSync(join(legacyReal, 'package.json'))
          && !existsSync(join(legacyReal, '.git'))) {
        dirs.push(legacyReal)
      }
    } catch { /* 探测失败不影响主流程 */ }
  }
  for (const dir of dirs) {
    if (!existsSync(join(dir, 'package.json'))) throw new Error(`target missing: ${dir}`)
  }
  // H-2 (v1.4.1): target 是符号链接时, 下面的 rmSync 会**穿透软链删光真实目录的内容**,
  // 而 cpSync 对软链会抛 ERR_FS_CP_DIR_TO_NON_DIR; 备份 tar 里存的又只是软链本身 →
  // 真实目录永久损坏且回滚不回来。遇到软链直接拒绝, 让用户改用真实路径。
  for (const dir of dirs) {
    let st = null
    try { st = lstatSync(dir) } catch { st = null }
    if (st && st.isSymbolicLink()) {
      throw new Error(`refusing to update a symbolic-link target: ${dir} (use its real path instead)`)
    }
  }

  // 1) 下载 tarball 到临时文件
  const tmpBase = join(tmpdir(), `dshadb-update-${Date.now()}`)
  mkdirSync(tmpBase, { recursive: true })
  const tgzPath = join(tmpBase, 'pkg.tar.gz')
  const extractDir = join(tmpBase, 'extract')
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  let swapped = false
  try {
    if (localTarball) {
      cpSync(localTarball, tgzPath)
    } else {
      const res = await fetch(TARBALL_URL, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) throw new Error(`download ${res.status}`)
      writeFileSync(tgzPath, Buffer.from(await res.arrayBuffer()))
    }
    // 2) 解压 (--strip-components=1 剥离 codeload 顶层目录)
    mkdirSync(extractDir, { recursive: true })
    execFileSync('tar', ['xzf', tgzPath, '-C', extractDir, '--strip-components=1'], { timeout: 20000 })
    // 3) 校验: 版本号匹配预期 + 关键文件齐全 + 包名一致 (装坏了宁可拒绝, 保住回滚机会)
    if (readVersionAt(extractDir) !== wantVersion) throw new Error('extracted version mismatch')
    let extractedName = null
    try { extractedName = JSON.parse(readFileSync(join(extractDir, 'package.json'), 'utf8')).name } catch { /* 忽略 */ }
    if (extractedName !== 'dsh-api-dashboard') throw new Error('extracted package name mismatch')
    for (const rel of ['src/index.js', 'client/client.js', 'cordis.patch.yml']) {
      if (!existsSync(join(extractDir, rel))) throw new Error(`missing file after extract: ${rel}`)
    }
    // 4) 备份每个目标目录 (tar 包存于其父目录旁, 不放包内避免自我包含)
    for (const dir of dirs) {
      execFileSync('tar', ['czf', `${dir}.preupdate-${stamp}.tar.gz`, '-C', dirname(dir), basename(dir)], { timeout: 20000 })
    }
    // 5) 交换: 删旧内容 → 拷新内容 (node_modules 保留, 避免重装依赖)
    for (const dir of dirs) {
      swapped = true
      // H-2 (v1.4.1): 必须保留 .git —— codeload 的 tarball 里没有它(实测),
      // 删掉就等于把用户的 git 历史抹了, 且没有任何恢复途径。
      const keep = new Set(['node_modules', '.git'])
      for (const entry of readdirSafe(dir)) {
        if (!keep.has(entry)) rmSync(join(dir, entry), { recursive: true, force: true })
      }
      cpSync(extractDir, dir, { recursive: true })
      if (readVersionAt(dir) !== wantVersion) throw new Error(`verify failed at ${dir}`)
    }
    return { installed: wantVersion, targets: dirs, backup: `${dirs[0]}.preupdate-${stamp}.tar.gz` }
  } catch (err) {
    // 回滚: 仅在已开始交换后才需要; 从本次备份整目录还原
    if (swapped) {
      for (const dir of dirs) {
        try {
          const bakTar = `${dir}.preupdate-${stamp}.tar.gz`
          if (!existsSync(bakTar)) continue
          rmSync(dir, { recursive: true, force: true })
          mkdirSync(dir, { recursive: true })
          execFileSync('tar', ['xzf', bakTar, '-C', dirname(dir)], { timeout: 20000 })
        } catch { /* 回滚自身失败时保留备份 tar 供手动恢复 */ }
      }
    }
    throw err
  } finally {
    // 临时区无论成败都清掉 (备份 tar 在 targets 旁边, 不受影响)
    rmSync(tmpBase, { recursive: true, force: true })
  }
}

/** 安全取真实路径: 不存在返回 null */
function realPathSafe(p) {
  try { return realpathSync(p) } catch { return null }
}

/** 安全列目录: 不存在/不可读返回空数组 */
function readdirSafe(dir) {
  try { return statSync(dir).isDirectory() ? readdirSync(dir) : [] } catch { return [] }
}

/** 更新检查结果内存缓存: 面板反复打开不重复请求 GitHub */
let updateCache = { checkedAt: 0, result: null }
const UPDATE_TTL_MS = 5 * 60 * 1000

async function getUpdateStatus(force = false) {
  const fresh = Date.now() - updateCache.checkedAt < UPDATE_TTL_MS
  if (!force && fresh && updateCache.result) return updateCache.result
  const current = readVersionAt(SELF_ROOT)
  let result
  try {
    const remote = await fetchRemoteVersion()
    result = { ok: true, current, remote, hasUpdate: current !== null && semverCompare(remote, current) > 0, checkedAt: Date.now() }
  } catch {
    // 错误信息固定文案, 不外泄内部异常细节 (沿用 v0.5.16 安全审计口径)
    result = { ok: false, current, remote: null, hasUpdate: false, checkedAt: Date.now() }
  }
  updateCache = { checkedAt: Date.now(), result }
  return result
}

// ============================================================
// 配置持久化: 设置面板保存的配置写入独立状态文件, 重启后恢复
// (不写回 cordis.patch.yml, 避免 YAML 写坏导致 dsh 起不来)
// ============================================================
const STATE_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dsh-api-dashboard.json')

/**
 * A（v1.4.1）: 每个中转站「上次探到的可用余额端点」的记忆表。
 * `queryCustomRelay` 的 auto 探测是**串行**试 3 个候选端点, 每个都要跑满 timeoutMs ——
 * 实测一次全量刷新因此要 8~13.6 秒。记住命中过的端点并优先试它, 稳态下每个中转站只打 1 个请求。
 * 只做**排序提示**, 候选全表仍然会依次试, 所以某个中转站换了端点也能自动跟上。
 * 持久化在状态文件 `relayEndpoints`（重启后依然生效）。
 */
const relayEndpointHints = new Map()

/**
 * 状态文件结构版本。**改动已持久化字段的默认值时必须 +1 并补一段迁移**,
 * 否则老用户的状态文件会把字段钉死在旧值上 —— 新默认值对老用户永远不生效。
 *   1 → 2: v1.4.0 `overseasCurrency` 默认 'follow' → 'USD'。
 *          老状态文件里那行 'follow' 是**旧默认值写下来的**, 不是用户的显式选择,
 *          因此迁移时把它改成 'USD'; 迁移后用户再手动选 'follow' 就会被正常尊重。
 */
const CONFIG_VERSION = 2

/**
 * 形状消毒 (v1.4.1): 状态文件是**我们自己的代码**写的, 但写盘可能被打断
 * (磁盘满/进程被杀/UTF-8 截断), 用户也可能手改。字段形状一旦跑偏,
 * 后面的 `(persisted.customRelays ?? []).map(...)` 会抛 TypeError —— 而 apply() 抛出
 * 会让 **整个 dsh web 启动失败**(不是插件不显示, 是 GUI 打不开), 用户完全无从下手。
 * 所以这里把所有"本该是数组/对象/数字"的字段统一消毒, 消毒不了就丢弃, 绝不让 apply() 抛。
 * ⚠️ 新增持久化字段时, 记得同步登记到这里。
 */
const ARRAY_FIELDS = ['customRelays', 'customModels', 'officialProviders', 'dshProviderOptOut', 'presets']
const OBJECT_FIELDS = ['whaleSettings', 'prices', 'relayEndpoints']
const NUMBER_FIELDS = [
  ['refreshIntervalMs', 1000, 60000],   // H-4b: 曾经能持久化成 -1 → 3 秒内 1794 次上游请求
  ['clientPollIntervalMs', 1000, 60000],
  ['timeoutMs', 1000, 60000],
  ['safeThreshold', 0, Number.MAX_SAFE_INTEGER],
  ['warnThreshold', 0, Number.MAX_SAFE_INTEGER],
  ['configVersion', 0, Number.MAX_SAFE_INTEGER],
]

const sanitizePersistedShape = (s) => {
  const out = { ...s }
  for (const k of ARRAY_FIELDS) {
    if (k in out && !Array.isArray(out[k])) delete out[k]
  }
  for (const k of OBJECT_FIELDS) {
    if (k in out && (out[k] === null || typeof out[k] !== 'object' || Array.isArray(out[k]))) delete out[k]
  }
  for (const [k, min, max] of NUMBER_FIELDS) {
    if (!(k in out)) continue
    const n = Number(out[k])
    if (!Number.isFinite(n)) { delete out[k]; continue }
    out[k] = Math.min(Math.max(Math.round(n), min), max)
  }
  return out
}

const migratePersistedState = (parsed) => {
  const s = sanitizePersistedShape((parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {})
  const ver = Number.isFinite(s.configVersion) ? s.configVersion : 1
  let out = s
  if (ver < 2) {
    if (out.overseasCurrency === 'follow' || out.overseasCurrency === undefined) {
      out = { ...out, overseasCurrency: 'USD' }
    }
  }
  if (out.configVersion !== CONFIG_VERSION) out = { ...out, configVersion: CONFIG_VERSION }
  return out
}

const loadPersistedState = () => {
  try {
    const raw = readFileSync(STATE_FILE, 'utf8')
    return migratePersistedState(JSON.parse(raw))
  } catch { return migratePersistedState({}) }
}

const savePersistedState = (state) => {
  try {
    const merged = { ...loadPersistedState(), ...state }
    // H-4c (v1.4.1): 以前这里从不建父目录, 且吞掉所有异常 → ~/.dsh 不存在时
    // 接口照样回 ok:true, 用户配置"保存成功"却没落盘, 重启即丢。现在先建目录。
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    // mode 0o600: 状态文件含自定义中转站/模型的 API Key 明文, 必须限定本用户可读
    // (不能依赖 umask —— 默认 umask 0022 的桌面机会落成 0644); chmod 兜底修正旧文件
    writeFileSync(STATE_FILE + '.tmp', JSON.stringify(merged, null, 2), { encoding: 'utf8', mode: 0o600 })
    renameSync(STATE_FILE + '.tmp', STATE_FILE)
    try { chmodSync(STATE_FILE, 0o600) } catch { /* 平台不支持或已是 0600, 忽略 */ }
    return true
  } catch { return false }
}

// ============================================================
// provider 官方/中转判定 (开源化改造)
// ------------------------------------------------------------
// 用途: 判断当前对话走的是官方直连还是中转站。中转站没有余额接口,
//       状态条金额必须显示「—」, 而不是拿某个官方平台的余额顶上去。
//
// 三层判定 (优先级由高到低, 客户端 isRelayProvider 按同样顺序落地):
//   1) 用户在设置面板显式声明的「官方直连 provider」名单 (officialProviders)
//      —— 最高优先级, 兜住下面两层的一切误判
//   2) 读 settings.yaml 里 llm-pi-ai.providers.<name>.baseURL, 按 **域名** 比对
//      官方端点白名单 (不是比对 provider 名 —— 别人的 provider 叫什么猜不到)
//   3) DSH 官方插件命名约定: `-official` / `_official` 后缀 (客户端兜底)
//   都不命中 → 按中转站处理 (保守: 宁可不显示余额, 也不显示错的余额)
//
// ⚠️ 只认 settings.yaml 里「显式写出」的 baseURL。provider 省略 baseURL 时靠
//    llm-pi-ai 内置目录解析, 而内置目录里的官方域名并不代表用户这把 key 来自官方
//    (实测: xiaomi 无 baseURL, 内置目录指向 api.xiaomimimo.com, 但用户的 key 实际
//     来自中转站) → 这种情况不表态, 交给第 3 层, 最终落到「按中转站」。
// ============================================================

/** 官方 API 端点主机名白名单 (精确匹配)。
 *  取自各平台官方文档与 pi-ai 内置 provider 目录的 baseUrl。
 *  拿不准的一律不列 —— 不列只是「不显示余额」, 列错会显示别家的余额。 */
const OFFICIAL_API_HOSTS = new Set([
  // 国内
  'api.deepseek.com',
  'open.bigmodel.cn', 'api.z.ai',
  'api.moonshot.cn', 'api.moonshot.ai', 'api.kimi.com',
  'api.stepfun.com',
  'api.siliconflow.cn',
  'api.minimaxi.com', 'api.minimax.io', 'api.minimax.chat',
  'dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com',
  'token-plan.cn-beijing.maas.aliyuncs.com', 'token-plan.ap-southeast-1.maas.aliyuncs.com',
  'api.ant-ling.com',
  // 海外
  'api.openai.com', 'chatgpt.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'openrouter.ai',
  'api.novita.ai',
  'api.x.ai',
  'api.mistral.ai',
  'api.groq.com',
  'api.together.ai', 'api.together.xyz',
  'api.fireworks.ai',
  'api.cerebras.ai',
  'integrate.api.nvidia.com',
  'router.huggingface.co',
  'api.individual.githubcopilot.com',
])

/** 官方端点域名后缀 (子域一律算官方; 只用于确实由厂商独占的注册域)。
 *  ⚠️ 通用云域名 (aliyuncs.com / cloudflare 之类) 绝不能进这里 —— 谁都能在上面开服务。 */
const OFFICIAL_API_SUFFIXES = [
  '.xiaomimimo.com',   // api / token-plan-cn / token-plan-ams / token-plan-sgp
]

/** URL → 小写主机名 (去端口); 解析不了返回空串 */
export const hostOfUrl = (url) => {
  try { return new URL(String(url)).hostname.toLowerCase() } catch { return '' }
}

/** 主机名是否属于官方 API 端点 */
export function isOfficialHost(host) {
  if (typeof host !== 'string' || host === '') return false
  const h = host.toLowerCase()
  if (OFFICIAL_API_HOSTS.has(h)) return true
  return OFFICIAL_API_SUFFIXES.some((suffix) => h.endsWith(suffix))
}

/**
 * settings.yaml 里 `llm-pi-ai.providers.<name>.<field>` 的通用取值器 (v1.4.0 抽出,
 * 原先只取 baseURL 一个字段, 「真自动」要连 apiKeyEnv 一起取)。
 * 手写最小缩进解析器 —— 刻意不引 yaml 依赖: package.json 的 dependencies 保持为空,
 * 引依赖会破坏零依赖安装。只认这一条路径, 别的 YAML 语法一概不管。
 * @param {string} text settings.yaml 全文
 * @param {string[]} wanted 想取的字段名 (provider 直接子字段那一层)
 * @returns {Record<string,Record<string,string>>} { providerName: { field: value } }
 */
const collectProviderFields = (text, wanted) => {
  const out = {}
  if (typeof text !== 'string' || text === '') return out
  const indentOf = (line) => line.length - line.replace(/^[ \t]+/, '').length
  // 取 `key: value` 的键与值; 列表项 (`- id: x`) 与非键值行返回 null
  const keyOf = (line) => {
    if (line.startsWith('-')) return null
    const m = /^([^\s#][^:]*):(.*)$/.exec(line)
    return m === null ? null : { key: m[1].trim(), value: m[2].trim() }
  }
  // 剥掉行内注释与引号
  const cleanValue = (raw) => {
    let v = raw.split(' #')[0].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    return v.trim()
  }
  let sectionIndent = -1    // `llm-pi-ai:` 的缩进
  let sectionChildIndent = -1 // llm-pi-ai 直接子键的缩进 (只在这一层认 `providers`)
  let providersIndent = -1  // `providers:` 的缩进
  let nameIndent = -1       // `<providerName>:` 的缩进
  let fieldIndent = -1      // provider 直接子字段的缩进 (只认这一层的 baseURL)
  let current = ''
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = indentOf(raw)
    // 退出比当前更浅的层级
    if (current !== '' && nameIndent >= 0 && indent <= nameIndent) { current = ''; fieldIndent = -1 }
    if (providersIndent >= 0 && indent <= providersIndent) { providersIndent = -1; nameIndent = -1 }
    if (sectionIndent >= 0 && indent <= sectionIndent && providersIndent < 0) {
      // 同级或更浅的另一个顶层键 → llm-pi-ai 段结束
      const kv = keyOf(trimmed)
      if (kv !== null && kv.key !== 'llm-pi-ai') { sectionIndent = -1; sectionChildIndent = -1 }
    }
    const kv = keyOf(trimmed)
    if (kv === null) continue                    // 列表项 (`- id: x`) 等一概跳过
    if (sectionIndent < 0) {
      if (kv.key === 'llm-pi-ai' && kv.value === '') { sectionIndent = indent; sectionChildIndent = -1 }
      continue
    }
    if (providersIndent < 0) {
      if (indent <= sectionIndent) continue
      if (sectionChildIndent < 0) sectionChildIndent = indent
      // 只认 llm-pi-ai 的直接子键 providers, 不误吃更深层同名键
      if (indent === sectionChildIndent && kv.key === 'providers' && kv.value === '') providersIndent = indent
      continue
    }
    if (current === '') {
      // provider 名: providers 的直接子键, 值为空 (dict 头)
      if (indent > providersIndent && kv.value === '') {
        if (nameIndent < 0) nameIndent = indent
        if (indent === nameIndent) { current = kv.key; fieldIndent = -1 }
      }
      continue
    }
    if (indent <= nameIndent) continue
    if (fieldIndent < 0) fieldIndent = indent     // provider 下第一个字段定基准缩进
    if (indent !== fieldIndent) continue          // 更深的层 (models 项内部等) 不认
    if (wanted.includes(kv.key)) {
      const value = cleanValue(kv.value)
      if (value !== '') {
        if (out[current] === undefined) out[current] = {}
        out[current][kv.key] = value
      }
    }
  }
  return out
}

/**
 * 从 settings.yaml 文本里抓 `llm-pi-ai.providers.<name>.baseURL` (第 2 层判定用)。
 * @param {string} text settings.yaml 全文
 * @returns {Record<string,string>} { providerName: baseURL }
 */
export function parseProviderBaseURLs(text) {
  const out = {}
  for (const [name, fields] of Object.entries(collectProviderFields(text, ['baseURL', 'baseUrl']))) {
    const url = fields.baseURL !== undefined ? fields.baseURL : fields.baseUrl
    if (url !== undefined) out[name] = url
  }
  return out
}

/**
 * v1.4.0「真自动」: 抓 provider 的 baseURL **和 apiKeyEnv**。
 * 插件据此把用户在 DSH 里配好的中转站直接变成可查余额的条目 ——
 * 不必再去插件设置里手抄一遍 baseUrl + key。
 * @param {string} text settings.yaml 全文
 * @returns {Record<string,{baseURL:string,apiKeyEnv:string}>}
 */
export function parseProviderEntries(text) {
  const out = {}
  for (const [name, fields] of Object.entries(collectProviderFields(text, ['baseURL', 'baseUrl', 'apiKeyEnv']))) {
    out[name] = {
      baseURL: fields.baseURL !== undefined ? fields.baseURL : (fields.baseUrl !== undefined ? fields.baseUrl : ''),
      apiKeyEnv: fields.apiKeyEnv !== undefined ? fields.apiKeyEnv : '',
    }
  }
  return out
}

/**
 * v1.4.0「真自动」: 从 settings.yaml 派生数据里挑出「该自动去查余额」的 provider。
 * 纯函数, 不碰文件/网络, 便于单测。**不在这里解析 key** —— 那步要访问 credentials 服务, 是异步的。
 *
 * 过滤规则 (三条, 每条都对应一条既有铁律):
 *   1. 只收**写了 baseURL** 的 provider —— 没写的按铁律 9「不表态」, 交 `-official` 后缀兜底
 *      (本机 `xiaomi` 正是「内置目录指向官方域名、但 key 实际来自中转站」的反例);
 *   2. 第 2 层判成 `official` 的跳过 —— 官方直连由预设平台负责, 别重复成一条中转站;
 *   3. 用户关掉的 (`dshProviderOptOut`) 跳过 —— 关过不会被下次自动发现又打开。
 * @param {Record<string,{baseURL?:string,apiKeyEnv?:string}>} entries parseProviderEntries 的结果
 * @param {Record<string,string>} kinds computeProviderKinds 的结果
 * @param {string[]} optOut 用户关掉的 provider 名 (大小写不敏感)
 * @returns {{name:string,baseURL:string,apiKeyEnv:string}[]} 按 provider 名排序, baseURL 已剥尾斜杠
 */
export const selectDshProviders = (entries, kinds, optOut) => {
  const off = new Set((Array.isArray(optOut) ? optOut : []).map((x) => String(x).toLowerCase()))
  const src = (entries && typeof entries === 'object') ? entries : {}
  const kindMap = (kinds && typeof kinds === 'object') ? kinds : {}
  const out = []
  for (const name of Object.keys(src).sort()) {
    const e = (src[name] && typeof src[name] === 'object') ? src[name] : {}
    const baseURL = typeof e.baseURL === 'string' ? e.baseURL : ''
    if (baseURL === '') continue
    if (kindMap[name] === 'official') continue
    if (off.has(String(name).toLowerCase())) continue
    out.push({
      name,
      baseURL: baseURL.replace(/\/+$/, ''),
      apiKeyEnv: typeof e.apiKeyEnv === 'string' ? e.apiKeyEnv : '',
    })
  }
  return out
}

/**
 * v1.4.0: `/api-dashboard/balances` 的取数策略 —— 纯函数, 便于单测 (策略很容易被"顺手改坏")。
 *
 * 背景: `force=1` 那条路底下是 `await refreshAll()` —— 一次全量轮询要等**最慢**的端点,
 * 最长可以拖满 `timeoutMs`(默认 8s)。应用切回前台 / 页面重载时如果走 force,
 * 用户看到的就是「插件加载很慢, 要等一段时间」。
 *
 * @returns {'wait'|'background'|'none'}
 *   wait       = 阻塞刷新后返回新数据 (没有东西可显示, 或用户显式强刷)
 *   background = 立刻回手上有的, 刷新丢后台 (stale-while-revalidate)
 *   none       = 缓存够新, 直接用
 */
export const planBalancesFetch = ({ force = false, peek = false, hasData = false, age = 0, intervalMs = 5000 } = {}) => {
  const stale = age > (intervalMs || 300000)   // 兼容旧行为: intervalMs 缺失时用 5 分钟
  /**
   * v1.4.1: 冷启动**不再阻塞首屏**。
   * 旧行为是 `return 'wait'` —— 服务端刚重启时缓存为空, 第一个请求要 await 一次**全量**刷新,
   * 而实测全量刷新要 8~13.6 秒(中转站 auto 探测是串行试 3 个端点), 用户看到的就是
   * 「重启进来等半天」。现在改成: 立刻回「还在加载」+ 把刷新丢后台, 客户端保持骨架屏并**1.5 秒后重问**,
   * 数据一到就上屏。注意这**不是假数据** —— 返回的是空列表 + loading 标记, 界面显示的是"加载中"而非 0。
   * 只有显式强刷(force, 用户主动要新数据)才继续阻塞等。
   */
  if (!hasData) return force ? 'wait' : 'background'
  if (!force && !stale) return 'none'
  if (peek) return age > 1000 ? 'background' : 'none'  // 1 秒内刚拉过就不重复打
  return age > 2000 ? 'wait' : 'none'          // 显式强刷留 2 秒节流, 防连点打爆平台接口
}

/** v1.4.0: 刷新间隔白名单化 —— 1~60 秒 (下限由 5 秒放宽到 1 秒, 用户要求更快) */
export const clampRefreshSec = (v) => Math.min(Math.max(Math.round(Number(v) || 1), 1), 60)

/**
 * 第 2 层自动判定的补充素材: 提取 settings.yaml 里 `llm-pi-ai.providers.<name>` 的
 * **全部 provider 名**，包括没有写 baseURL 的 provider。这样即使别人没有手写 URL，
 * 只要用的是已知官方 preset 名，也能自动判定为官方，而不必先手动补 settings。
 * 注意：只提取 provider 名本身，不改变 parseProviderBaseURLs 的返回语义。
 */
export function parseProviderNames(text) {
  const names = []
  if (typeof text !== 'string' || text === '') return names
  const indentOf = (line) => line.length - line.replace(/^[ \t]+/, '').length
  const keyOf = (line) => {
    if (line.startsWith('-')) return null
    const m = /^([^\s#][^:]*):(.*)$/.exec(line)
    return m === null ? null : { key: m[1].trim(), value: m[2].trim() }
  }
  let sectionIndent = -1
  let sectionChildIndent = -1
  let providersIndent = -1
  let nameIndent = -1
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = indentOf(raw)
    if (nameIndent >= 0 && indent <= nameIndent) { nameIndent = -1 }
    if (providersIndent >= 0 && indent <= providersIndent) { providersIndent = -1; nameIndent = -1 }
    if (sectionIndent >= 0 && indent <= sectionIndent && providersIndent < 0) {
      const kv = keyOf(trimmed)
      if (kv !== null && kv.key !== 'llm-pi-ai') { sectionIndent = -1; sectionChildIndent = -1 }
    }
    const kv = keyOf(trimmed)
    if (kv === null) continue
    if (sectionIndent < 0) {
      if (kv.key === 'llm-pi-ai' && kv.value === '') { sectionIndent = indent; sectionChildIndent = -1 }
      continue
    }
    if (providersIndent < 0) {
      if (indent <= sectionIndent) continue
      if (sectionChildIndent < 0) sectionChildIndent = indent
      if (indent === sectionChildIndent && kv.key === 'providers' && kv.value === '') providersIndent = indent
      continue
    }
    if (indent > providersIndent && kv.value === '') {
      if (nameIndent < 0) nameIndent = indent
      if (indent === nameIndent) names.push(kv.key)
    }
  }
  return names
}

/**
 * 第 2 层判定结果: { providerName: 'official' | 'relay' }。
 * 没有 baseURL / baseURL 解析不出主机名的 provider **不写进结果** (不表态, 交第 3 层)。
 */
export function computeProviderKinds(text) {
  const kinds = {}
  for (const [name, url] of Object.entries(parseProviderBaseURLs(text))) {
    const host = hostOfUrl(url)
    if (host === '') continue
    kinds[name] = isOfficialHost(host) ? 'official' : 'relay'
  }
  // v1.4.0 移除「按 provider 名字猜官方」的兜底。
  // 旧代码把「名字恰好等于某个预设 id 且没写 baseURL」判成 official —— 这与本文件 232-240 行的政策
  // 和 AGENTS.md 铁律 9 直接冲突:「没写 baseURL 的 provider 是不表态、交 `-official` 后缀兜底」。
  // 理由(AGENTS.md 原话): 内置目录指向官方域名 ≠ 用户的 key 来自官方(`xiaomi` 就是反例)。
  // 只看名字会把「恰好同名的中转站会话」顶上官方余额 —— 不表态比猜错安全。
  return kinds
}

/** 用户填的官方直连名单规范化: 接受数组或「逗号/换行/空格分隔」的字符串。
 *  上限 64 条 × 64 字符 —— 名单会持久化并随每次 /balances 下发, 防超大输入撑爆状态文件。 */
export const normalizeOfficialProviders = (input) => {
  const list = Array.isArray(input)
    ? input
    : typeof input === 'string' ? input.split(/[,，、;；\s]+/) : []
  const seen = new Set()
  const out = []
  for (const item of list) {
    if (out.length >= 64) break
    if (typeof item !== 'string') continue
    const name = item.trim().slice(0, 64)
    if (name === '' || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push(name)
  }
  return out
}

const SETTINGS_FILE = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'settings.yaml')
/**
 * settings.yaml 派生数据缓存, 按 mtime 失效 (轮询每 5s 一次, 别每次都解析)。
 *   kinds   = 第 2 层官方/中转判定素材
 *   entries = v1.4.0「真自动」: 各 provider 的 baseURL / apiKeyEnv,
 *             用来把 DSH 里配好的中转站合成可查余额的条目
 */
let settingsDerivedCache = { mtimeMs: -1, kinds: {}, entries: {} }

/** 读 settings.yaml 并算出全部派生数据 (mtime 缓存) */
const readSettingsDerived = () => {
  try {
    const mtimeMs = statSync(SETTINGS_FILE).mtimeMs
    if (mtimeMs === settingsDerivedCache.mtimeMs) return settingsDerivedCache
    const text = readFileSync(SETTINGS_FILE, 'utf8')
    settingsDerivedCache = { mtimeMs, kinds: computeProviderKinds(text), entries: parseProviderEntries(text) }
    return settingsDerivedCache
  } catch {
    // settings.yaml 不存在/读不动: 不表态, 全交给第 1、3 层, 也没有可自动发现的中转站
    settingsDerivedCache = { mtimeMs: -1, kinds: {}, entries: {} }
    return settingsDerivedCache
  }
}

/** 读 settings.yaml 算第 2 层判定 */
const readProviderKinds = () => readSettingsDerived().kinds

// ============================================================
// 工具函数
// ============================================================
const toAmount = (value) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** FNV-1a 32bit 哈希, 用于按内容生成 ETag (数据没变才 304) */
const fnv1a = (str) => {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

// ============================================================
// DeepSeek 峰谷计费引擎 (学习 dsh-balance)
// 北京时间 09:00~12:00 / 14:00~18:00 为峰时(100%), 其余时段谷时特惠(5折)
// ============================================================
// v1.3.4 (2026-09-10): 官方同日 12:00 起调整 Flash 系列定价(最高降幅 60%), 并收敛模型名 ——
//   deepseek-v4-flash → deepseek-flash (旧名仍可调用, 由 V4.1-Flash 服务并按 Flash 价计费, 定价页注 1);
//   2026-09-14 12:00 后 deepseek-v4-pro 的请求将全部路由到 V4.1-Flash 并按 Flash 价计费(官方计划下线 Pro, 注 2)。
// 来源: https://api-docs.deepseek.com/zh-cn/quick_start/pricing (CNY) 与 /quick_start/pricing (USD) ——
//   USD 表为官方直发(非 ÷7 换算, 实际口径约 1 USD ≈ 6.67 CNY), pro 档与调整前一致, 未变动。
export const V4_RATES = {
  CNY: {
    peak: { 'deepseek-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 }, 'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 } },
    offPeak: { 'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 }, 'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 } },
  },
  USD: {
    peak: { 'deepseek-flash': { cacheHit: 0.006, cacheMiss: 0.3, output: 1.2 }, 'deepseek-v4-pro': { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 } },
    offPeak: { 'deepseek-flash': { cacheHit: 0.003, cacheMiss: 0.15, output: 0.6 }, 'deepseek-v4-pro': { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 } },
  },
}

/**
 * 通用表 USD → CNY 换算汇率 —— **近似值**, 只在「用户把币种设成非原生币种」时才用到。
 * v1.4.0 起 MODEL_PRICES 按原生币种存储, 默认配置(国内 CNY / 海外 USD)下两边同币种, 根本不走换算;
 * 且 DeepSeek 走 V4_RATES 自带的两套官方表, 本汇率对它无效。
 * ⚠️ 官方 DeepSeek 的 USD 直发价口径约 1 USD ≈ 6.67 CNY, 与本值不同 —— 别拿它去"校正" V4_RATES.USD。
 */
const USD_TO_CNY_RATE = 7

/** 北京时间(UTC+8)的星期与小时, 先 +8h 再取值, 避免跨日界(00:00~08:00)星期比北京时间早一天 */
const bjtParts = (timestamp) => {
  const d = new Date(timestamp + 8 * 3600 * 1000)
  return { weekday: d.getUTCDay(), hour: d.getUTCHours() }
}

/**
 * 当前是否处于 DeepSeek 峰时.
 *  工作日(周一~周五): 北京时间 09-12 / 14-18 为峰时, 其余谷时。
 *  周末(周六日): 整天都是谷时特惠。
 */
export const isPeakTime = (timestamp = Date.now()) => {
  const { weekday, hour } = bjtParts(timestamp)
  // 周末(0=周日, 6=周六)整天谷时
  if (weekday === 0 || weekday === 6) return false
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** 当前是否周末 */
export const isWeekend = (timestamp = Date.now()) => {
  const { weekday } = bjtParts(timestamp)
  return weekday === 0 || weekday === 6
}


// ============================================================
// 通用模型价格表 — 每百万token, **按「模型原生币种」存储** (v1.4.0)。
//
// 规则: 国内厂商官方定价页给的是 CNY → 这里直接写官方 CNY 原值;
//       海外厂商官方定价页给的是 USD → 这里直接写官方 USD 原值。
// 币种由 modelRegion(model) 判定 (与 currencyForModel 同源), resolveModelPrice 只在
// 「显示币种 ≠ 原生币种」时才换算 —— 默认配置(currency=CNY / overseasCurrency=USD)下
// 国内走 CNY、海外走 USD, 两边都是原样返回, 零换算误差。
//
// ⚠️ 为什么不继续用「统一存 USD 基准」(v1.3.4 及以前):
//   CNY 官方价 ÷7 入库、显示时再 ×7, 既留舍入尾巴, 更容易把官方 CNY 直接填进 USD 槽位
//   → 面板按 7 倍计费。历史上已被咬过两次:
//     ① MiMo: ¥1 被写成 0.020 (等于又除了一次 7), 少算成 1/7;
//     ② glm-4-plus / 整个「历史/参考」段: ¥2.5/¥5/¥5 被当 USD, 显示 ¥17.5/¥35/¥35。
//   原生币种存储让这类错误**无法表达** —— 改表时直接抄官方页数字, 不要再做任何 ÷7。
//
// ⚠️ DeepSeek 计费请走上面 V4_RATES 峰谷表(自带 CNY/USD 两套, 官方价, 准确); 本通用表覆盖 OpenAI/Claude/Gemini/国产等。
// 来源: ① 现役主力(2026-09-03) NousResearch hermes-agent usage_pricing.py + 各厂商官方定价页;
//          v1.4.0 (2026-09-10) 复核抓取原文: api-docs.deepseek.com 中英双页 / platform.kimi.com /
//          platform.minimaxi.com / platform.stepfun.com / docs.bigmodel.cn / help.aliyun.com(百炼) /
//          MiMo 官方永久降价公告。逐条核对, 差异已就地注明。
//       ② 旧模型(2025-08) 为历史参考价. 仅做参考, 实际以平台为准.
// ============================================================
export const MODEL_PRICES = {
  // —— 海外厂商: 单位 USD/百万tokens (原生) ——
  // 来源: modelradar.cn 2026-09-03 快照 (各模型 sourceUrl 均指官方定价页)。
  //       仅采纳与官方口径无分歧的条目; 与原表冲突时保留原值并注明 ——
  //       radar 的 GPT-5.6 系输出价全呈「输入×1.25」异常模式, 疑似抓错列, 未采纳。
  // ⚠️ OpenAI / Anthropic / Gemini 官方定价页在本容器环境被 403 / 地域封锁, v1.4.0 未能取到原文复核,
  //    下列海外条目仍为 radar/hermes-agent 二手源, 未逐条核实 —— 有账单单据时优先以单据为准。
  // OpenAI GPT-5.6 系列 (radar 报 sol 输出 $5 / terra $2.5 / luna $0.25, 均为输入×1.25 异常模式, 未采纳)
  'gpt-5.6-sol':          { cacheHit: 0.5,   cacheMiss: 4.0,   output: 20.0 },  // 临时促销价(至少到 2026-11-21)
  'gpt-5.6-terra':        { cacheHit: 0.2,   cacheMiss: 2.0,   output: 12.0 },  // 2026-07-30 降价
  'gpt-5.6-luna':         { cacheHit: 0.02,  cacheMiss: 0.2,   output: 1.2 },   // 2026-07-30 降价
  'gpt-5.3-codex':        { cacheHit: 0.175, cacheMiss: 1.75,  output: 14.0 },  // radar 2026-09-03, OpenAI 官方页
  // Anthropic Claude 5
  'claude-opus-5':        { cacheHit: 0.5,   cacheMiss: 5.0,   output: 25.0 },  // v1.2.0 修正缓存读价: Anthropic 缓存读=0.1×输入, radar 对照 claude.com/pricing (opus-4-8 亦 $0.5); 原误标"无缓存折扣"
  'claude-sonnet-5':      { cacheHit: 0.2,   cacheMiss: 2.0,   output: 10.0 },
  'claude-sonnet-4-6':    { cacheHit: 0.30,  cacheMiss: 3.00,  output: 15.00 },
  'claude-haiku-4-5':     { cacheHit: 0.10,  cacheMiss: 1.00,  output: 5.00 },
  // Google Gemini 3.x
  'gemini-3.7-flash':     { cacheHit: 0.075, cacheMiss: 0.75,  output: 3.75 },  // 促销至 2026-12-31, 之后翻倍
  'gemini-3.8-flash':     { cacheHit: 0.075, cacheMiss: 0.75,  output: 3.75 },  // radar 2026-09-02 新增, 与 3.7/3.6 同价
  'gemini-3.6-flash':     { cacheHit: 0.075, cacheMiss: 0.75,  output: 3.75 },  // 促销至 2026-12-31, 之后翻倍
  'gemini-3-flash-preview': { cacheHit: 0.025, cacheMiss: 0.5, output: 3.0 },
  'gemini-3.5-flash-lite':  { cacheHit: 0.3,  cacheMiss: 0.3,  output: 2.5 },   // 无缓存折扣
  'gemini-3.1-pro':       { cacheHit: 2.0,   cacheMiss: 2.0,   output: 12.0 },  // 无缓存折扣; 长上下文 $4/$24
  'gemini-2.5-pro':       { cacheHit: 0.125, cacheMiss: 1.25,  output: 10.00 },
  'gemini-2.5-flash':     { cacheHit: 0.03,  cacheMiss: 0.3,   output: 2.5 },   // radar 2026-09-03, 1M ctx
  // —— 国内厂商: 单位 CNY/百万tokens (原生官方价, 不要再 ÷7) ——
  // 阿里云百炼 Qwen3 (华北2/北京; help.aliyun.com/zh/model-studio/model-pricing 2026-09-10 抓取)
  //   官方上下文缓存规则: 命中按「标准输入单价 10%」计费。
  //   ⚠️ 官方明文例外: qwen3.8-max / qwen3.8-flash / qwen3.8-2.4t-a95b 的缓存命中价**不是 10%**,
  //      且未在文档给数字(只写「参见百炼控制台」)→ 这两条 cacheHit 沿用中转站实测报价, 标为「例外价」。
  'qwen3.8-max':          { cacheHit: 1.5,  cacheMiss: 12,  output: 36 },  // 官方 ¥12/¥36; cacheHit ¥1.5 为控制台例外价(非 10% 规则)
  'qwen3.7-max':          { cacheHit: 1.2,  cacheMiss: 12,  output: 36 },  // v1.4.0: 官方页现为原价 ¥12/¥36 (旧「5 折促销值」官方页已不存在, 已废)
  'qwen3.7-plus':         { cacheHit: 0.16, cacheMiss: 1.6, output: 6.4 }, // v1.4.0: 官方限时 8 折 (原价 ¥2/¥8)
  'qwen3.7-flash':        { cacheHit: 0.02, cacheMiss: 0.2, output: 0.8 }, // v1.4.0: 官方 ¥0.2/¥0.8 (旧值 0.21/0.91 系中转站高档位, 已废)
  'qwen3.8-flash':        { cacheHit: 0.1,  cacheMiss: 0.8, output: 2.7 }, // 官方 ¥0.8/¥2.7; cacheHit ¥0.1 同 3.8-max 为控制台例外价
  'qwen3.8-27b':          { cacheHit: 0.3,  cacheMiss: 3,   output: 12 },  // v1.4.0: 官方 ¥3/¥12; 缓存命中按官方 10% 规则 → ¥0.3 (旧值 ¥0.6 偏高 100%)
  'qwen3.6-plus':         { cacheHit: 0.2,  cacheMiss: 2,   output: 12 },  // 官方 ¥2/¥12 (256K 档 ¥8/¥48 未做分档)
  // 智谱 GLM (docs.bigmodel.cn/cn/guide/start/pricing 2026-09-10 抓取)
  //   ⚠️ GLM-5 系官方分档: 「[0,32K)」与「≥32K」两套价。本表按 ≥32K(更贵) 入库 —— 估算偏保守高估。
  'glm-5.3':              { cacheHit: 2,    cacheMiss: 8,   output: 28 },  // 官方 ¥8/¥28/缓存 ¥2
  'glm-5.2':              { cacheHit: 2,    cacheMiss: 8,   output: 28 },  // 官方 ¥8/¥28/缓存 ¥2
  'glm-5.1':              { cacheHit: 2,    cacheMiss: 8,   output: 28 },  // 官方 ≥32K 档 ¥8/¥28/缓存 ¥2 ([0,32K) 档为 ¥6/¥24/¥1.3)
  'glm-5-turbo':          { cacheHit: 1.8,  cacheMiss: 7,   output: 26 },  // v1.4.0: 官方 ≥32K 档 ¥7/¥26/缓存 ¥1.8 (旧值 1.68/8.4/28 两档都不符)
  'glm-5.3-flash':        { cacheHit: 0.23, cacheMiss: 0.8, output: 2.8 }, // 官方 ¥0.8/¥2.8/缓存 ¥0.23
  // Kimi / Moonshot (platform.kimi.com/docs/pricing/* 2026-09-10 抓取, 均 CNY)
  'kimi-k3':              { cacheHit: 2,    cacheMiss: 20,  output: 100 }, // v1.4.0: 官方 ¥2/¥20/¥100 (旧值全线 +5%)
  'kimi-k2.7-code':       { cacheHit: 1.3,  cacheMiss: 6.5, output: 27 },  // 官方 ¥1.3/¥6.5/¥27
  'kimi-k2.7-code-highspeed': { cacheHit: 2.6, cacheMiss: 13, output: 54 },// v1.4.0 新增: 官方高速版 ¥2.6/¥13/¥54
  'kimi-k2.6':            { cacheHit: 1.1,  cacheMiss: 6.5, output: 27 },  // v1.4.0: 官方缓存命中 ¥1.1 (旧值误抄成 k2.7-code 的 ¥1.3)
  'kimi-k2.5':            { cacheHit: 0.679, cacheMiss: 3.864, output: 20.279 }, // ⚠️ 未核实: 官方页未列(历史款), 由 v1.3.4 USD 值 ×7 保号迁移
  // 字节豆包 Seed (火山方舟; ⚠️ 官方页是 SPA, v1.4.0 未能取到原文 → ×7 保号迁移, 未核实)
  'doubao-seed-2.0-pro-32k':   { cacheHit: 0.616, cacheMiss: 3.087, output: 15.449 },
  'doubao-seed-2.0-pro-128k':  { cacheHit: 0.924, cacheMiss: 4.634, output: 23.17 },
  'doubao-seed-2.0-pro-256k':  { cacheHit: 1.855, cacheMiss: 9.268, output: 46.347 },
  'doubao-seed-2.0-lite-32k':  { cacheHit: 0.119, cacheMiss: 0.581, output: 3.479 },
  'doubao-seed-2.0-lite-128k': { cacheHit: 0.175, cacheMiss: 0.868, output: 5.215 },
  'doubao-seed-2.0-lite-256k': { cacheHit: 0.35,  cacheMiss: 1.736, output: 10.43 },
  'doubao-seed-2.0-mini-32k':  { cacheHit: 0.042, cacheMiss: 0.196, output: 1.932 },
  'doubao-seed-2.0-mini-128k': { cacheHit: 0.077, cacheMiss: 0.385, output: 3.864 },
  'doubao-seed-2.0-mini-256k': { cacheHit: 0.154, cacheMiss: 0.77,  output: 7.721 },
  'doubao-seed-2.0-code-32k':  { cacheHit: 0.616, cacheMiss: 3.087, output: 15.449 },
  'doubao-seed-2.0-code-128k': { cacheHit: 0.924, cacheMiss: 4.634, output: 23.17 },
  'doubao-seed-2.0-code-256k': { cacheHit: 1.855, cacheMiss: 9.268, output: 46.347 },
  // 字节 Seed 2.1 (中转站实测; 未分档, 按单一价入库)
  'seed-2.1-turbo':       { cacheHit: 0.6,  cacheMiss: 3,   output: 15 },  // 实测 ¥3/¥15/缓存 ¥0.6
  'seed-2.1-pro':         { cacheHit: 1.2,  cacheMiss: 6,   output: 30 },  // 实测 ¥6/¥30/缓存 ¥1.2
  // MiniMax (platform.minimaxi.com/docs/guides/pricing-paygo 2026-09-10 抓取)
  'minimax-m2.7':           { cacheHit: 0.42, cacheMiss: 2.1, output: 8.4 },  // v1.4.0 修复: 官方缓存读 ¥0.42 (旧值拿 cacheMiss ¥2.1 顶替 → 长会话高估 5 倍, 同 AGENTS.md 红线 4)
  'minimax-m2.7-highspeed': { cacheHit: 0.42, cacheMiss: 4.2, output: 16.8 }, // v1.4.0 新增: 官方高速版
  // 美团 LongCat (中转站实测; 官方页未取到明文)
  'longcat-2.0':          { cacheHit: 0.1,  cacheMiss: 5,   output: 20 },  // 实测 ¥5/¥20/缓存 ¥0.1
  // 腾讯混元 (⚠️ 官方页是 SPA, v1.4.0 未能取到原文 → ×7 保号迁移, 未核实)
  'hunyuan-2.0-instruct-128k': { cacheHit: 4.347, cacheMiss: 4.347, output: 10.745 },
  'hunyuan-2.0-think-128k':    { cacheHit: 5.117, cacheMiss: 5.117, output: 20.468 },
  'hunyuan-turbo-s':           { cacheHit: 0.77,  cacheMiss: 0.77,  output: 1.932 },
  // 阶跃星辰 (platform.stepfun.com/docs/zh/guides/pricing/details 2026-09-10 抓取)
  'step-3.7-flash':       { cacheHit: 0.27, cacheMiss: 1.35, output: 8.1 }, // 官方 ¥1.35/¥8.1/缓存 ¥0.27
  'step-3.5-flash':       { cacheHit: 0.14, cacheMiss: 0.7,  output: 2.1 }, // 官方 ¥0.7/¥2.1/缓存 ¥0.14
  // 小米 MiMo — 官方 2026-05-27 起「永久降价」(最高降幅 99%), 取消上下文分档; 与中转站 tokenrhythm 实时报价一致。
  // v1.3.4 修的「除两次 7」结论正确, v1.4.0 起改为直接存官方 CNY 原值, 不再有 ÷7 环节。
  'mimo-v2.5':            { cacheHit: 0.02,  cacheMiss: 1, output: 2 },    // 官方 ¥1/¥2/缓存 ¥0.02
  'mimo-v2.5-pro':        { cacheHit: 0.025, cacheMiss: 3, output: 6 },    // 官方 ¥3/¥6/缓存 ¥0.025
  // —— 以下为历史/参考模型 (2025-08, 实际以平台为准) ——
  // 币种规则同上: 海外的写 USD, 国内的写 CNY。
  // 🔴 v1.4.0 重要修复: 本段「国内」条目历来填的是**官方 CNY 原值**(不是 ÷7 后的 USD),
  //    在旧的「统一 USD 基准」口径下被又 ×7 了一次 → 面板把这些模型高估 7 倍。
  //    已核对的样本: glm-4-plus ¥2.5/¥5/¥5、qwen-plus ¥0.8/¥2、qwen-turbo ¥0.3/¥0.6、
  //    qwen2.5-72b ¥4/¥12 均与官方页逐项吻合 → 全段按 CNY 原值解读, 未再 ×7。
  'gpt-4o':               { cacheHit: 1.25,  cacheMiss: 2.5,  output: 10 },
  'gpt-4o-mini':          { cacheHit: 0.075, cacheMiss: 0.15, output: 0.6 },
  'gpt-4-turbo':          { cacheHit: 5,     cacheMiss: 10,   output: 30 },
  'gpt-4':                { cacheHit: 15,    cacheMiss: 30,   output: 60 },
  'o1':                   { cacheHit: 7.5,   cacheMiss: 15,   output: 60 },
  'o1-mini':              { cacheHit: 0.55,  cacheMiss: 1.1,  output: 4.4 },
  'o3-mini':              { cacheHit: 0.55,  cacheMiss: 1.1,  output: 4.4 },
  // Claude — v1.4.0 修正: 缓存读 = 输入 ×10% (Anthropic 官方规则)。旧值用的是 OpenAI 的 50% 口径,
  // 会让老 Claude 模型的长会话消耗高估 5 倍 (同表新条目 claude-opus-5 等已是 10%, 口径原本就不一致)。
  'claude-3-5-sonnet':    { cacheHit: 0.3,   cacheMiss: 3,    output: 15 },
  'claude-3-5-haiku':     { cacheHit: 0.08,  cacheMiss: 0.8,  output: 4 },
  'claude-3-opus':        { cacheHit: 1.5,   cacheMiss: 15,   output: 75 },
  // Gemini — v1.4.0 修正: 缓存读 = 输入 ×25% (Gemini 官方 75% off 口径)。旧值 50% 偏高。
  'gemini-2.0-flash':     { cacheHit: 0.025, cacheMiss: 0.1,  output: 0.4 },
  'gemini-2.0-pro':       { cacheHit: 0.625, cacheMiss: 2.5,  output: 10 },
  'gemini-1.5-pro':       { cacheHit: 0.875, cacheMiss: 3.5,  output: 10.5 },
  // DeepSeek (标准价兜底) — ⚠️ 2026-07-24 起 deepseek-chat / deepseek-reasoner / deepseek-r1 已 RETIRED,
  // 官方 API 调用会直接报错(不再重定向到 V4)。现役为 deepseek-flash (旧名 deepseek-v4-flash / -vision-exp 仍可调用)
  // 与 deepseek-v4-pro。⚠️ 2026-09-14 12:00 后 deepseek-v4-pro 的请求将全部路由到 V4.1-Flash 并按 Flash 价计费。
  // 保留这三条仅作为「若仍在用的旧配置」的估算占位(单位 CNY), 真实计费请走上面 V4 峰谷表。
  // ⚠️ 未核实: 与 DeepSeek 官方历史价(¥2/¥8 一档)对不上, 暂时原样保留待重新取证。
  'deepseek-chat':        { cacheHit: 0.1,   cacheMiss: 1,    output: 2 },
  'deepseek-reasoner':    { cacheHit: 0.2,   cacheMiss: 2,    output: 8 },
  'deepseek-r1':          { cacheHit: 0.2,   cacheMiss: 2,    output: 8 },
  // 智谱
  'glm-4-plus':           { cacheHit: 2.5,   cacheMiss: 5,    output: 5 },  // ✅ v1.4.0 修复: 官方 ¥2.5/¥5/¥5 (旧口径下显示 ¥17.5/¥35/¥35, 高 7 倍)
  'glm-4-flash':          { cacheHit: 0.05,  cacheMiss: 0.1,  output: 0.1 }, // ⚠️ 官方 GLM-4-Flash-250414 现为免费; 此处保留历史 ¥0.1 档(宁高不低, 中转站可能仍计费)
  // 通义千问 (官方 CNY; 2026-09-10 抓取)
  'qwen-plus':            { cacheHit: 0.4,   cacheMiss: 0.8,  output: 2 },  // 官方 ¥0.8/¥2 ✅; ⚠️ cacheHit 0.4(=50%) 未核实
  'qwen-max':             { cacheHit: 0.24,  cacheMiss: 2.4,  output: 9.6 },// v1.4.0: 官方现价 ¥2.4/¥9.6 (旧值 20/60 是远古价)
  'qwen-turbo':           { cacheHit: 0.15,  cacheMiss: 0.3,  output: 0.6 },// 官方 ¥0.3/¥0.6 ✅; ⚠️ cacheHit 未核实
  'qwen2.5-72b-instruct': { cacheHit: 2,     cacheMiss: 4,    output: 12 }, // 官方 ¥4/¥12 ✅
  // Kimi — ⚠️ 未核实: 官方页未列旧款, 且这些值与 Moonshot 官方历史价(¥12/¥12 一档)对不上, 待重新取证
  'moonshot-v1-8k':       { cacheHit: 0.6,   cacheMiss: 1.2,  output: 2.4 },
  'moonshot-v1-32k':      { cacheHit: 1.2,   cacheMiss: 2.4,  output: 4.8 },
  'moonshot-v1-128k':     { cacheHit: 3,     cacheMiss: 6,    output: 12 },
  // 阶跃星辰 — ⚠️ 未核实: 官方页未列旧款
  'step-1-flash':         { cacheHit: 0.5,   cacheMiss: 1,    output: 2 },
  'step-1-8k':            { cacheHit: 2,     cacheMiss: 4,    output: 8 },
  'step-1-32k':           { cacheHit: 4,     cacheMiss: 8,    output: 15 },
  // 其他 (海外 USD)
  'mistral-large':        { cacheHit: 1.5,   cacheMiss: 3,    output: 9 },
  'groq-llama-3.3-70b':  { cacheHit: 0.29,  cacheMiss: 0.59, output: 0.79 },
  'openrouter-auto':      { cacheHit: 0.5,   cacheMiss: 1,    output: 2 },
}

// v1.3.2: 模型产地判定 —— 供「海外模型独立计价货币」使用。
// 海外厂商官方定价页本来就是 USD, ×7 折人民币只是近似且容易被误读成美元
// (用户实测: 面板 ¥1285 被看成 $1285, 实为 $183.7)。
// v1.4.0 起本判定还兼任 MODEL_PRICES 的「存储币种」判定 (见 nativeCurrencyOf), 见下方注释。
// 判定按前缀, 与 MODEL_PRICES 的键同源; 未命中 → null (不表态, 走主货币, 保守)。
const OVERSEAS_MODEL_PREFIXES = ['gpt-', 'gpt', 'o1', 'o3', 'o4', 'chatgpt', 'claude', 'gemini', 'grok', 'mistral', 'groq-', 'llama', 'command-', 'openrouter-']
const DOMESTIC_MODEL_PREFIXES = ['deepseek', 'glm', 'kimi', 'moonshot', 'step-', 'qwen', 'mimo', 'doubao', 'seed-', 'hunyuan', 'minimax', 'longcat', 'abab', 'ernie', 'spark', 'yi-']

/** 判定模型产地: '海外' | '国内' | null(未知, 不表态)。前缀匹配取最长, 避免短前缀误命中。 */
export const modelRegion = (model) => {
  if (typeof model !== 'string' || model === '') return null
  const m = model.toLowerCase()
  const hit = (list) => list.filter(p => m.startsWith(p)).sort((a, b) => b.length - a.length)[0] ?? null
  const dom = hit(DOMESTIC_MODEL_PREFIXES)
  const sea = hit(OVERSEAS_MODEL_PREFIXES)
  if (dom !== null && sea !== null) return dom.length >= sea.length ? '国内' : '海外'
  if (dom !== null) return '国内'
  if (sea !== null) return '海外'
  return null
}

/**
 * v1.4.0: MODEL_PRICES 条目的**存储币种** —— 国内厂商官方页是 CNY, 海外厂商是 USD。
 * 与 modelRegion 同源, 因此「写表的人抄官方页数字」即为正确, 不需要任何人工 ÷7。
 * 未命中产地的模型不表态 → 按 CNY (国内口径), 与 defaultPrices 的 USD 基准无关。
 */
export const nativeCurrencyOf = (model) => (modelRegion(model) === '海外' ? 'USD' : 'CNY')

/**
 * 把一份单价从 from 币种换算到 to 币种。同币种原样返回(浅拷贝, 不泄露表内对象引用)。
 * 汇率是**近似值**(USD_TO_CNY_RATE), 仅用于「用户自定义了非原生币种」这种少数情况;
 * 默认配置(国内 CNY / 海外 USD)下两边同币种, 根本不走换算 —— 这正是 v1.4.0 想达到的效果。
 */
const convertPrice = (price, from, to) => {
  if (from === to) return { cacheHit: price.cacheHit, cacheMiss: price.cacheMiss, output: price.output }
  const k = from === 'USD' ? USD_TO_CNY_RATE : 1 / USD_TO_CNY_RATE
  return { cacheHit: price.cacheHit * k, cacheMiss: price.cacheMiss * k, output: price.output * k }
}

/**
 * v1.3.2: 算出某模型实际该用哪种计价货币。
 * 海外模型且 overseasCurrency 不是 'follow' 时用它, 其余一律跟主货币 currency。
 * v1.4.0: 默认值由 'follow' 改为 'USD' —— 即「国内的用国内价(CNY), 海外的用海外价(USD)」。
 * 想要 v1.2.6 的老行为(全部跟主货币), 显式设成 'follow' 即可。
 */
export const currencyForModel = (config, model) => {
  const main = (config?.currency ?? 'CNY').toUpperCase()
  const over = String(config?.overseasCurrency ?? 'USD').toLowerCase()
  if (over === 'follow' || over === '') return main
  if (modelRegion(model) !== '海外') return main
  return over.toUpperCase() === 'USD' ? 'USD' : 'CNY'
}

/**
 * v1.4.0: 前缀兜底匹配 —— 只接受「安全后缀」。
 *
 * 旧实现是「取最长前缀」，只保证同族内选最长，模型名比某个**老键**长且不属同族时会被老键吞掉:
 *   gpt-4.1        → 命中 gpt-4 键 → $15/$30/$60 (真价 $0.40/$1.60, 输出虚高约 37 倍)
 *   gpt-4.5-preview→ 命中 gpt-4 键 → 同上
 *   gemini-2.5-flash-lite → 命中 gemini-2.5-flash 键 (真价 $0.10/$0.40)
 * 而 gpt-4o-mini-2024-07-18 / claude-3-5-sonnet-20241022 这类**日期后缀**才是设计意图。
 * 因此: 只有当剩余部分是日期/版本/预览标记时才认前缀, 其余一律落 defaultPrices。
 */
const SAFE_SUFFIX_RE = /^[-_](?:v?\d[\w.-]*|latest|preview|exp|experimental)$/i

/** 精确命中优先; 否则按「安全后缀」前缀兜底; 都不中返回 null。 */
const matchModelPrice = (model) => {
  const exact = MODEL_PRICES[model]
  if (exact) return exact
  const hits = Object.keys(MODEL_PRICES).filter(k => model.startsWith(k)).sort((a, b) => b.length - a.length)
  for (const k of hits) {
    if (SAFE_SUFFIX_RE.test(model.slice(k.length))) return MODEL_PRICES[k]
  }
  return null
}

/** 解析模型单价, 仅 deepseek-flash / deepseek-v4-* 支持峰谷自动切换; chat/reasoner 等走通用价格表 */
export const resolveModelPrice = (configOrGetter, model, timestamp = Date.now()) => {
  const config = typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const peak = isPeakTime(timestamp)
  const display = currencyForModel(config, model)

  // 自定义价格优先 (用户自填, 币种由用户自己把握, 不做换算)
  if (typeof model === 'string' && config?.prices && Object.prototype.hasOwnProperty.call(config.prices, model) && config.prices[model]) {
    return config.prices[model]
  }

  // v0.5.3 修复: 原 startsWith('deepseek') 会把 deepseek-chat/reasoner 劫持进 V4 峰谷表,
  // 导致其按 v4-flash 价格计费 (output 虚高至 4.5 倍)。仅匹配现役 v4 系列 + 收敛后的 deepseek-flash。
  // v1.3.4: 官方收敛模型名后, deepseek-flash 与旧名 deepseek-v4-flash / -vision-exp 同档
  //   (旧名仍可调用, 由 V4.1-Flash 服务并按 Flash 价计费) → 一律映射到 flash 档位。
  // DeepSeek v4 走 V4_RATES 峰谷表 (自带 CNY/USD 两套, 按显示币种选表)
  if (typeof model === 'string' && (model.startsWith('deepseek-v4') || model.startsWith('deepseek-flash'))) {
    const table = V4_RATES[display] ?? V4_RATES.CNY
    const key = model.startsWith('deepseek-v4-pro') ? 'deepseek-v4-pro' : 'deepseek-flash'
    const hit = (peak ? table.peak[key] : table.offPeak[key])
    if (hit) return { ...hit }
  }

  // 查通用表 (精确名 → 安全后缀前缀兜底)。条目按原生币种存储, 换算到显示币种。
  if (typeof model === 'string' && model !== '') {
    const entry = matchModelPrice(model)
    if (entry) return convertPrice(entry, nativeCurrencyOf(model), display)
  }

  // 都未命中: 落 defaultPrices。⚠️ defaultPrices 的单位是 **USD** (与 v1.2.x 一致, 未随 v1.4.0 改动)。
  return convertPrice(config?.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 }, 'USD', display)
}

/** 通用 fetch 请求, 带超时。 */
async function fetchWithTimeout(url, headers, timeoutMs, method = 'GET') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { method, headers, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** 读取请求体并限制大小 (默认 256KB) —— 防持有 token 者灌大包打爆内存。超限抛错。 */
async function readBody(req, limit = 256 * 1024) {
  // H-4d (v1.4.1): 不能对每个 chunk 单独 toString —— 一个汉字的 3 个字节被 TCP 分到两个 chunk 时,
  // 两边都会解出替换字符 U+FFFD, 中文中转站名/自定义模型名会被写坏并持久化(实测)。
  // 改成先收集 Buffer 再整体解码。
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > limit) throw Object.assign(new Error('request body too large'), { statusCode: 413 })
    chunks.push(buf)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** 字符串清洗: 截断到 max 长度 (设置面板传入的任意字段统一过这里) */
const cleanStr = (value, max) => String(value ?? '').trim().slice(0, max)
/** URL 清洗: 只接受 http/https 协议 (防 file: 等混淆 scheme 进配置), 失败返回空串 */
const cleanUrl = (value) => {
  const s = cleanStr(value, 512)
  return /^https?:\/\//i.test(s) ? s : ''
}

// ============================================================
// 平台预设 (完整清单)
// ============================================================

/**
 * 每个平台:
 *  id / label / icon(图标文件名) / color / category(官方|海外|国内|本地|中转站)
 *  baseUrl / queryType(余额解析类型) / envKeys(可读取的key名) / noBalance(是否默认无余额接口)
 */
const PLATFORM_PRESETS = [
  // ===== 国内平台（有公开余额/配额查询接口）=====
  { id: 'deepseek', label: 'DeepSeek', icon: 'deepseek', color: '#4D6BFE', category: '国内',
    baseUrl: 'https://api.deepseek.com', queryType: 'deepseek', envKeys: ['DEEPSEEK_API_KEY'] },
  { id: 'zhipu', label: '智谱 GLM', icon: 'zhipu', color: '#3859FF', category: '国内',
    // v0.5.5: 实测余额监控接口在 open.bigmodel.cn (api.z.ai 同路径 401); 补 ZAI_CODING_CN 等 key 别名
    baseUrl: 'https://open.bigmodel.cn', queryType: 'glm', envKeys: ['ZHIPU_API_KEY', 'GLM_API_KEY', 'BIGMODEL_API_KEY', 'ZAI_CODING_CN_API_KEY', 'ZAI_API_KEY'] },
  { id: 'moonshot', label: 'Kimi Moonshot', icon: 'moonshot', color: '#000000', category: '国内',
    baseUrl: 'https://api.moonshot.cn', queryType: 'kimi', envKeys: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'] },
  { id: 'stepfun', label: '阶跃星辰 StepFun', icon: 'mistral', color: '#FA520F', category: '国内',
    baseUrl: 'https://api.stepfun.com', queryType: 'stepfun', envKeys: ['STEPFUN_API_KEY'] },
  { id: 'siliconflow', label: '硅基流动', icon: 'siliconflow', color: '#6E29F6', category: '国内',
    baseUrl: 'https://api.siliconflow.cn', queryType: 'siliconflow', envKeys: ['SILICONFLOW_API_KEY', 'SILICON_API_KEY'] },
  { id: 'minimax', label: 'MiniMax', icon: 'minimax', color: '#E73562', category: '国内',
    baseUrl: 'https://api.minimaxi.com', queryType: 'minimax', envKeys: ['MINIMAX_API_KEY'] },

  // ===== 海外平台（有公开余额/配额查询接口）=====
  { id: 'openrouter', label: 'OpenRouter', icon: 'openrouter', color: '#6469FF', category: '海外',
    baseUrl: 'https://openrouter.ai', queryType: 'openrouter', envKeys: ['OPENROUTER_API_KEY'] },
  { id: 'novita', label: 'Novita AI', icon: 'together', color: '#FA520F', category: '海外',
    baseUrl: 'https://api.novita.ai', queryType: 'novita', envKeys: ['NOVITA_API_KEY'] },
  { id: 'xai', label: 'xAI Grok', icon: 'xai', color: '#000000', category: '海外',
    baseUrl: 'https://api.x.ai', queryType: 'openai', envKeys: ['XAI_API_KEY'] },

  // ===== 著名模型品牌 (无公开余额接口, 仅显示模型 + 按价格表估算消耗) =====
  { id: 'openai', label: 'OpenAI', icon: 'openai', color: '#10A37F', category: '海外', noBalance: true },
  { id: 'claude', label: 'Anthropic Claude', icon: 'claude', color: '#D97757', category: '海外', noBalance: true },
  { id: 'gemini', label: 'Google Gemini', icon: 'gemini', color: '#4285F4', category: '海外', noBalance: true },
  { id: 'qwen', label: '通义千问 Qwen', icon: 'qwen', color: '#623AE7', category: '国内', noBalance: true },
  { id: 'mimo', label: '小米 MiMo', icon: 'mimo', color: '#FF6900', category: '国内', noBalance: true },
  // v1.2.1: 豆包/混元入列模型品牌分组 (价格表 v1.2.0 已覆盖, 此前只算价不显示)
  { id: 'doubao', label: '豆包 Seed', icon: 'doubao', color: '#3C8CFF', category: '国内', noBalance: true },
  { id: 'hunyuan', label: '腾讯混元', icon: 'hunyuan', color: '#0052D9', category: '国内', noBalance: true },
]

// ============================================================
// Config Schema
// ============================================================
const RelaySchema = Schema.object({
  id: Schema.string(),
  name: Schema.string().required(),
  baseUrl: Schema.string().required(),
  apiKey: Schema.string().default(''),
  queryType: Schema.string().default('auto'),
})

export const Config = Schema.object({
  refreshIntervalMs: Schema.number().min(1000).default(5000),
  clientPollIntervalMs: Schema.number().min(5000).default(5000),
  timeoutMs: Schema.number().min(1000).default(8000),
  presets: Schema.array(Schema.string()).default(PLATFORM_PRESETS.map(p => p.id)),
  customRelays: Schema.array(RelaySchema).default([]),
  /** 安全阈值: 余额 > safe 显示绿色, > warn 黄色, 否则红色 */
  safeThreshold: Schema.number().min(0).default(50),
  warnThreshold: Schema.number().min(0).default(10),
  /** 计价货币 */
  currency: Schema.string().default('CNY'),
  /**
   * v1.3.2: 海外模型独立计价货币 —— 'USD'(默认, 见 v1.4.0) | 'CNY' | 'follow'(跟随 currency)。
   * 海外厂商官方价本来就是 USD, 选 'USD' 可免掉 ×7 折算带来的误差与「¥ 被看成 $」的误读。
   * v1.4.0: 默认值从 'follow' 改为 'USD' —— 即「国内的用国内价(CNY)、海外的用海外价(USD)」。
   * 想要旧行为(所有模型都跟主货币)请显式设成 'follow'。
   */
  overseasCurrency: Schema.string().default('USD'),
  prices: Schema.dict(Schema.object({
    cacheHit: Schema.number().min(0).default(0.2),
    cacheMiss: Schema.number().min(0).default(2),
    output: Schema.number().min(0).default(8),
  })).default({}),
  defaultPrices: Schema.object({
    cacheHit: Schema.number().min(0).default(0.1),
    cacheMiss: Schema.number().min(0).default(1),
    output: Schema.number().min(0).default(2),
  }).default({}),
  /** 收养大肥鱼: 屏幕侧边互动宠物挂件 (v1.1.0, 纯互动不含余额, 移植自 MeteorNOX/DeepSeek-Balance-Whale-Widget, MIT) */
  whaleEnabled: Schema.boolean().default(false),
  /** 显示无余额模型品牌 (OpenAI/Claude/Gemini/Qwen/MiMo), 默认关闭 */
  showNoBalanceBrands: Schema.boolean().default(false),
  /** 官方直连 provider 名单 (第 1 层判定, 最高优先级)。
   *  写在这里的 provider 名一律按「官方直连」处理, 状态条显示官方余额;
   *  没写的按 baseURL 域名 / `-official` 后缀自动判定, 都不命中则按中转站显示「—」。 */
  officialProviders: Schema.array(Schema.string()).default([]),
  /** v1.4.0「真自动」: 用户主动关掉的 DSH provider 名 (来自 settings.yaml llm-pi-ai.providers)。
   *  默认空数组 = 全部启用。关过的记在这里, 下次自动发现不会再打开 (除非用户又点开)。
   *  ⚠️ 这与 officialProviders 是**两回事**: 那个决定「按官方显示」, 这个决定「要不要去查余额」。 */
  dshProviderOptOut: Schema.array(Schema.string()).default([]),
  /** 大肥鱼挂件设置: 大小/音效/音量/气泡/峰谷文案/吸附/位置记忆 */
  whaleSettings: Schema.object({
    scale: Schema.number().min(0.6).max(2.5).default(1),
    soundOn: Schema.boolean().default(true),
    soundSet: Schema.string().default('duck'),
    volume: Schema.number().min(0).max(1).default(0.5),
    bubbleOn: Schema.boolean().default(true),
    peakMode: Schema.string().default('default'),
    snapOn: Schema.boolean().default(true),
    peekRatio: Schema.number().min(0.15).max(0.9).default(0.5),
  }).default({}),
})

// ============================================================

// ============================================================
// 余额告警检测 (A3: 低于阈值时推送通知)
// ============================================================
let lastAlertState = {}

function checkAlerts(balances, config, ctx) {
  const safe = config.safeThreshold ?? 50
  const warn = config.warnThreshold ?? 10
  const newState = {}

  for (const b of balances) {
    if (b.status !== 'ok') continue
    const id = b.platform
    const val = b.percent != null ? b.percent : b.total
    const prev = lastAlertState[id]
    let level = val > safe ? 'ok' : val > warn ? 'warn' : 'err'
    newState[id] = level

    if (level === 'warn' && prev !== 'warn') {
      try {
        const name = b.name || id
        const msg = `🔔 ${name} 余额偏低: ${val}${b.percent != null ? '%' : (b.currency || '')}`
        if (ctx && typeof ctx.notify === 'function') {
          ctx.notify({ title: '哦鲸鲸', message: msg, level: 'warning' })
        } else if (ctx && ctx.get && typeof ctx.get('webServer')?.notify === 'function') {
          ctx.get('webServer').notify({ title: '哦鲸鲸', message: msg, level: 'warning' })
        }
      } catch { /* 静默 */ }
    } else if (level === 'err' && prev !== 'err') {
      try {
        const name = b.name || id
        const msg = `🚨 ${name} 余额不足: ${val}${b.percent != null ? '%' : (b.currency || '')}`
        if (ctx && typeof ctx.notify === 'function') {
          ctx.notify({ title: '哦鲸鲸', message: msg, level: 'error' })
        } else if (ctx && ctx.get && typeof ctx.get('webServer')?.notify === 'function') {
          ctx.get('webServer').notify({ title: '哦鲸鲸', message: msg, level: 'error' })
        }
      } catch { /* 静默 */ }
    }
  }
  lastAlertState = newState
}

// 余额解析适配器
// ============================================================

// 纯函数, 导出便于单测 (不影响对外行为)
export function parseResponse(queryType, json, pref) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  switch (queryType) {
    case 'deepseek': {
      const infos = Array.isArray(json?.balance_infos) ? json.balance_infos : []
      // H-4d (v1.4.2): balance_infos 是「一个币种钱包一条」—— 官方文档 currency 取值 CNY / USD。
      // 旧代码盲取 infos[0]，而**数组顺序不保证**：真机实测同一 key 连打 5 次，第 4 次顺序翻成
      // [USD=0.00, CNY=123.45] → 读到 USD 那条 → 有 123.45 元的账户显示成「$0.00 · 异常」。
      // 更糟的是下面那道 `total_balance == null` 红线**拦不住**它 —— "0.00" 是合法字符串，
      // 于是红线守卫被绕过、0 被当成真实余额渲染（与 v1.4.0 openai-credit-grants、
      // v1.4.1 openrouter 是同一族漏洞：选错一条就当真实数字）。
      // 现在按「主货币优先 → 余额 > 0 → 首条」确定性挑选，结果与接口返回顺序无关。
      const amountOf = (v) => {
        if (v === null || v === undefined || v === '') return null
        const n = Number(v)
        return Number.isFinite(n) ? n : null
      }
      const want = String(pref ?? '').trim().toUpperCase()
      const usable = infos.filter((x) => x && amountOf(x.total_balance) !== null)
      const p =
        (want ? usable.find((x) => String(x.currency || '').toUpperCase() === want) : undefined) ??
        usable.find((x) => amountOf(x.total_balance) > 0) ??
        usable[0]
      if (!p) return null
      // total_balance 当前余额, granted_balance 赠送, topped_up_balance 充值
      const total = toAmount(p.total_balance)
      const grant = toAmount(p.granted_balance)
      const topup = toAmount(p.topped_up_balance)
      // 已用 = 充值 + 赠送 - 当前余额 (近似)
      return { total, currency: p.currency || 'CNY', available: total, used: Math.max(0, topup + grant - total), topup, grant, note: '可用余额' }
    }
    case 'openai':
    case 'openai-credit-grants': {
      if (!json || typeof json !== 'object') return null
      const hasAny = 'total_granted' in json || 'total_available' in json || 'total_used' in json
      if (!hasAny) return null
      // H-4a (v1.4.1): 字段**存在但值无效**(null / 非数字)时, toAmount 会归 0,
      // 于是 total = 0 - used 得到一个**负数余额** —— 与 openrouter 那次是同一类漏洞
      // (红线: 不许把解析失败冒充成真实数字)。这里改成「值无效就不表态」。
      // ⚠️ Number(null) === 0、Number('') === 0 —— 必须先把「空值」挡掉, 否则等于没挡
      const numOrNull = (v) => {
        if (v === null || v === undefined || v === '') return null
        const n = Number(v)
        return Number.isFinite(n) ? n : null
      }
      const grantedN = numOrNull(json?.total_granted)
      const usedN = numOrNull(json?.total_used)
      const availN = numOrNull(json?.total_available)
      if (availN === null && (grantedN === null || usedN === null)) return null
      const used = usedN ?? 0
      const hasAvail = availN !== null
      return { total: hasAvail ? availN : (grantedN - used), currency: 'USD', available: hasAvail ? availN : null, used, note: 'OpenAI 兼容额度' }
    }
    case 'siliconflow': {
      const d = json?.data
      if (!d) return null
      // 数据红线: totalBalance 字段名/单位未实测, 缺字段即放弃, 不造假 0。
      if (d.totalBalance == null) return null
      return { total: toAmount(d.totalBalance), currency: 'CNY', available: null, used: null, note: '硅基流动总余额(字段待实测)' }
    }
    case 'openrouter': {
      const d = json?.data
      if (!d) return null
      // 数据红线: total_credits / total_usage 字段名未用真实 key 实测, 可能不叫这个名。
      // v1.4.0 修复: 原守卫用 `&&`(两个都缺才放弃), 只缺 total_credits 时 toAmount(null)=0,
      // total 变成 `0 - usage` 的**负数**, 客户端渲染成红色「余额不足」—— 正好是这条红线要防的伪造数字。
      // 改为 `||`: 任一关键字段缺失即视为解析失败, 返回 null(前端显示「未开放」), 绝不编数。
      if (d.total_credits == null || d.total_usage == null) return null
      return { total: toAmount(d.total_credits) - toAmount(d.total_usage), currency: 'USD', available: toAmount(d.total_credits), used: toAmount(d.total_usage), note: 'OpenRouter 余额(字段待实测)' }
    }
    case 'novita': {
      if (!json || !('availableBalance' in json)) return null
      const raw = toAmount(json?.availableBalance)
      return { total: raw / 10000, currency: 'USD', available: null, used: null, note: 'Novita (0.0001单位)' }
    }
    case 'stepfun': {
      if (!json || json.balance == null) return null
      const b = toAmount(json.balance)
      return { total: b, currency: 'CNY', available: null, used: null, note: '阶跃星辰余额' }
    }
    case 'quota': {
      const q = json?.data
      if (!q || q.quota == null) return null
      const quota = toAmount(q.quota)
      return { total: quota / 500000, currency: 'USD', available: null, used: null, note: 'one-api quota (÷500000, 系数待实测)' }
    }
    case 'openai-billing': {
      const limit = toAmount(json?.hard_limit_usd)
      if (limit === 0 && !json?.has_credit_card) return null
      return { total: limit, currency: 'USD', available: limit, used: null, note: 'OpenAI 订阅硬上限' }
    }
    case 'glm': {
      // 智谱 Coding Plan 配额(实测 2026-08-30; unit 含义转自 z.ai 前端源码 / cc-switch)：
      //   unit=3 → TOKENS_LIMIT 5小时滚动窗口(主显示)      [Lite:2000]
      //   unit=6 → TOKENS_LIMIT 周配额(部分套餐/国际站)    [Lite:10000]
      //   unit=5 → TIME_LIMIT 工具/搜索类(月度)
      //   limit.remaining      = 该维度当前剩余(积分);
      //   limit.percentage     = 该维度【填充度/已用】(100=用完, 0=未用)——绝不是"剩余%";
      //   limit.nextResetTime  = 该维度下次重置时间(仅滚动/周期维度有)。
      //   ⚠️ 严禁把 percentage 当"剩余%"显示: 会把"周配额已用完(remaining:0)"误显示成"余额 100%, 剩 100"。
      //   真实返回: [{unit:3,remaining:2000,pct:0},{unit:6,remaining:0,pct:100,nextResetTime:...}]
      const limits = Array.isArray(json?.data?.limits) ? json.data.limits : []
      const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
      const rem = (l) => num(l?.remaining ?? l?.remaining_quota)
      const pctOf = (l) => { const n = Number(l?.percentage ?? l?.remaining_percentage); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null }
      const UNIT_LABEL = { 3: '5小时窗口', 6: '周配额', 5: '工具(月度)' }
      // 主显示优先: unit=3(5小时滚动窗口), 其次 unit=6(周配额), 再按剩余降序
      const score = (l) => (l.unit === 3 ? 0 : (l.unit === 6 ? 1 : 2))
      const sorted = limits.slice().sort((a, b) => score(a) - score(b) || (rem(b) ?? -1) - (rem(a) ?? -1))
      const main = sorted.find((l) => rem(l) !== null && rem(l) > 0)
      const usedUp = limits.filter((l) => rem(l) === 0 && pctOf(l) === 100)
      if (main) {
        const r = rem(main)
        const extra = usedUp.length
          ? '; ' + usedUp.map((l) => `${UNIT_LABEL[l.unit] ?? '其他'}已用完(${l.nextResetTime ? '待重置' : '已限流'})`).join('; ')
          : ''
        return {
          total: r, currency: 'tokens', available: r, used: null, percent: null,
          note: `智谱${UNIT_LABEL[main.unit] ?? ''}剩 ${r} 积分${extra}`,
          resetAt: usedUp[0]?.nextResetTime ?? main?.nextResetTime ?? null,
        }
      }
      // 无可用>0 → 全部用尽
      if (usedUp.length) {
        const l = usedUp[0]
        return { total: 0, currency: 'tokens', available: 0, used: null, percent: null, note: '智谱配额已用完(0)' + (l.nextResetTime ? ', 待重置' : ''), resetAt: l?.nextResetTime ?? null }
      }
      // 兜底: 只有 percentage 无 remaining。
      // v1.4.0 修复: percentage 是**已用/填充度**(100=用完), 不是余额, 方向还是反的 ——
      // 旧代码把它当 total 下发, 客户端 `percent ?? total` 取到 88 → getLevel 与 50 阈值比 → 判「绿灯」,
      // 于是「快用完」显示成「余额充足」, 同时踩 AGENTS.md 红线 4 与 README:9「查不到就如实显示未开放」。
      // 这里不再冒充余额, 直接返回 null, 交给 classifyBizError 走中性的 no-balance-api。
      return null
    }

    case 'kimi': {
      const u = json?.usage
      if (!u) return null
      if (u.limit == null && u.remaining == null) return null
      const limit = toAmount(u.limit), remaining = toAmount(u.remaining)
      // v1.4.0 修复: `limit` 是限流窗口的**上限**, 不是可用余额。旧代码把它当 total 下发, 而客户端
      // 的状态条/卡片/详情大数字都取 `b.total`(从不看 available) → 配额耗尽也显示满额 + 绿灯。
      // 与同文件 glm 适配器语义对齐: total = 剩余量; 上限与用量放在 note/used 里。
      return {
        total: remaining, currency: 'tokens', available: remaining, used: limit - remaining,
        note: `Kimi 套餐剩余 tokens (窗口上限 ${limit})`,
        percent: limit > 0 ? (remaining / limit) * 100 : null,
      }
    }
    case 'minimax': {
      const models = Array.isArray(json?.model_remains) ? json.model_remains : []
      const m = models[0]
      if (!m || !('remaining_credit' in m)) return null
      return { total: toAmount(m.remaining_credit), currency: 'CNY', available: toAmount(m.remaining_credit), used: null, note: 'MiniMax 剩余额度' }
    }
    default:
      return null
  }
}

/** 某些类型无法用普通 API key 查询余额 (需 OAuth 等) */
// ============================================================
// 业务层错误分类 (v1.2.6 抽出为可测函数)
// ============================================================
/**
 * 解析失败时对「接口 HTTP 200 但业务层报错」做分类。
 * ⚠️ 仅在 parseResponse 返回 null 时调用 —— 能解析出配额/余额的账户(如智谱 Coding Plan 套餐用户)
 *    根本不会走到这里, 本函数不影响他们。
 * @returns {{status: string, error: string}} 供 queryPreset 直接摊进返回体
 */
export function classifyBizError(queryType, json) {
  // 业务层错误消息: success:false 或 code!=200 且带 msg (JSON 解析失败 json=null 时不适用)
  const bizMsg = (json && typeof json === 'object' && typeof json.msg === 'string' && json.msg
    && (json.success === false || (json.code !== undefined && json.code !== 200))) ? json.msg : null

  // 智谱: 按量付费账户无公开余额接口 (实测 2026-09-03: /api/monitor/account/balance、
  // /api/paas/v4/dashboard/billing/{subscription,credit_grants,usage}、/api/paas/v4/users/me
  // 等候选端点全部 404; 唯一公开的 /api/monitor/usage/quota/limit 是 Coding Plan 套餐专用)。
  // 该情形属「平台未开放」而非「插件解析坏了」, 按中性状态展示, 不标红。
  if (queryType === 'glm' && bizMsg && /coding\s*plan/i.test(bizMsg)) {
    // ⚠️ 措辞不替平台断言账户类型: 按量付费用户与套餐已过期用户拿到的是【同一条】返回,
    //    接口层无法区分, 所以只说"无 Coding Plan 套餐", 不硬说成"按量付费"。
    return { status: 'no-balance-api', error: '无 Coding Plan 套餐，无余额接口 (按量付费 / 套餐已过期均返回此结果；套餐用户可正常显示配额)' }
  }

  // 其余业务错误: 透传原始 msg, 便于用户/维护者定位真实原因 (套餐过期、无权限、接口改名…)
  return { status: 'parse-error', error: bizMsg ? `无法解析余额数据 (接口返回: ${bizMsg})` : '无法解析余额数据' }
}

// ============================================================
// 查询单个预设平台
// ============================================================
async function queryPreset(platform, apiKey, config) {
  if (platform.noBalance) {
    return {
      platform: platform.id, name: platform.label, icon: platform.icon, color: platform.color,
      category: platform.category, status: 'no-balance-api', error: '该平台未开放余额查询', noBalance: true,
    }
  }
  if (!apiKey) {
    return {
      platform: platform.id, name: platform.label, icon: platform.icon, color: platform.color,
      category: platform.category, status: 'no-key', error: '未配置 API Key', noBalance: false,
    }
  }

  // 端点构造
  let url = '', headers = { Accept: 'application/json' }, method = 'GET'
  let queryType = platform.queryType
  const base = platform.baseUrl.replace(/\/+$/, '')

  switch (platform.queryType) {
    case 'deepseek': url = `${base}/user/balance`; headers['Authorization'] = `Bearer ${apiKey}`; break
    case 'openai': url = `${base}/v1/dashboard/billing/credit_grants`; headers['Authorization'] = `Bearer ${apiKey}`; break
    case 'siliconflow': url = `${base}/v1/user/info`; headers['Authorization'] = `Bearer ${apiKey}`; break
    case 'openrouter': url = `${base}/api/v1/credits`; headers['Authorization'] = `Bearer ${apiKey}`; break
    case 'novita': url = `${base}/v3/user/balance`; headers['Authorization'] = `Bearer ${apiKey}`; break
    case 'stepfun': url = `${base}/v1/accounts`; headers['Authorization'] = `Bearer ${apiKey}`; break
    case 'quota': url = `${base}/api/user/self`; headers['Authorization'] = `Bearer ${apiKey}`; method = 'POST'; break
    case 'openai-billing': url = `${base}/v1/dashboard/billing/subscription`; headers['Authorization'] = `Bearer ${apiKey}`; break
    case 'glm': url = `${base}/api/monitor/usage/quota/limit`; headers['Authorization'] = apiKey; break
    case 'kimi': url = `${base}/coding/v1/usages`; headers['Authorization'] = `Bearer ${apiKey}`; break
    case 'minimax': url = `${base}/v1/api/openplatform/coding_plan/remains`; headers['Authorization'] = `Bearer ${apiKey}`; break
    default: url = `${base}/v1/dashboard/billing/credit_grants`; headers['Authorization'] = `Bearer ${apiKey}`; queryType = 'openai'; break
  }

  try {
    const res = await fetchWithTimeout(url, headers, config.timeoutMs || 8000, method)
    if (!res.ok) {
      const isAuth = res.status === 401 || res.status === 403
      return {
        platform: platform.id, name: platform.label, icon: platform.icon, color: platform.color,
        category: platform.category,
        status: isAuth ? 'auth-error' : (res.status === 404 || res.status === 405 ? 'no-balance-api' : 'error'),
        error: `HTTP ${res.status}${isAuth ? ' (认证失败)' : res.status === 404 ? ' (未开放余额接口)' : ''}`,
        noBalance: res.status === 404 || res.status === 405,
      }
    }

    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = null }
    const parsed = parseResponse(queryType, json, config?.currency)

    if (!parsed) {
      // v1.2.6: 业务错误分类抽到 classifyBizError (可单测)。
      // 注意: 智谱 Coding Plan 套餐用户能解析出配额 → parsed 非空 → 不会走到这里。
      const { status, error } = classifyBizError(queryType, json)
      return {
        platform: platform.id, name: platform.label, icon: platform.icon, color: platform.color,
        category: platform.category, status, error, noBalance: true,
      }
    }

    return {
      platform: platform.id, name: platform.label, icon: platform.icon, color: platform.color,
      category: platform.category, status: 'ok', total: parsed.total, currency: parsed.currency,
      available: parsed.available, used: parsed.used, topup: parsed.topup, grant: parsed.grant,
      note: parsed.note, percent: parsed.percent,
      noBalance: false, fetchedAt: Date.now(),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      platform: platform.id, name: platform.label, icon: platform.icon, color: platform.color,
      category: platform.category,
      status: 'error', error: message.includes('abort') ? '请求超时' : '网络错误', noBalance: false,
    }
  }
}

// ============================================================
// 自定义中转站查询 (自动探测)
// ============================================================
function relayTypePath(queryType) {
  switch (queryType) {
    case 'openai-billing': return '/v1/dashboard/billing/subscription'
    case 'openai': return '/v1/dashboard/billing/credit_grants'
    case 'quota': return '/api/user/self'
    case 'auto': return null
    default: return '/v1/dashboard/billing/subscription'
  }
}

async function queryCustomRelay(relay, config) {
  const { id, name, baseUrl, apiKey, queryType } = relay
  // v1.4.0: 这条中转站是不是从 DSH settings.yaml 自动发现的 (客户端据此显示「DSH」标)
  const fromDsh = relay.fromDsh === true
  if (!apiKey) {
    return { platform: id, name: name || '中转站', icon: 'relay', color: '#64748B', category: '中转站', status: 'no-key', error: '未配置 API Key', noBalance: true, fromDsh }
  }
  const base = (baseUrl || '').replace(/\/+$/, '')

  // 候选端点探测
  const candidates = []
  if (queryType && queryType !== 'auto') {
    candidates.push({ type: queryType, path: relayTypePath(queryType) })
  } else {
    candidates.push(
      { type: 'openai-billing', path: '/v1/dashboard/billing/subscription' },
      { type: 'quota', path: '/api/user/self' },
      { type: 'openai', path: '/v1/dashboard/billing/credit_grants' },
    )
  }

  // A: 命中过的端点排到最前（只影响顺序, 不影响"全都会试一遍"的语义）
  if (candidates.length > 1 && relayEndpointHints.has(id)) {
    const hint = relayEndpointHints.get(id)
    const idx = candidates.findIndex((c) => c.type === hint)
    if (idx > 0) candidates.unshift(candidates.splice(idx, 1)[0])
  }

  for (const cand of candidates) {
    const headers = { Accept: 'application/json', Authorization: `Bearer ${apiKey}` }
    const method = cand.type === 'quota' ? 'POST' : 'GET'
    try {
      const res = await fetchWithTimeout(base + cand.path, headers, config.timeoutMs || 8000, method)
      if (!res.ok) continue
      const text = await res.text()
      let json
      try { json = JSON.parse(text) } catch { continue }
      const parsed = parseResponse(cand.type, json, config?.currency)
      if (parsed) {
        // A: 记住这次命中的端点（变了才落盘, 避免每次刷新都写状态文件）
        if (relayEndpointHints.get(id) !== cand.type) {
          relayEndpointHints.set(id, cand.type)
          try { savePersistedState({ relayEndpoints: Object.fromEntries(relayEndpointHints) }) } catch { /* 落盘失败不影响本次结果 */ }
        }
        return {
          platform: id, name: name || '中转站', icon: 'relay', color: '#64748B', category: '中转站',
          status: 'ok', total: parsed.total, currency: parsed.currency, available: parsed.available,
          used: parsed.used, note: parsed.note || cand.type, percent: parsed.percent,
          noBalance: false, queryType: cand.type, fetchedAt: Date.now(), fromDsh,
        }
      }
    } catch { /* 尝试下一个 */ }
  }

  return {
    platform: id, name: name || '中转站', icon: 'relay', color: '#64748B', category: '中转站',
    status: 'no-balance-api', error: '该平台未开放余额查询', noBalance: true, fromDsh,
  }
}

// ============================================================
// 自定义模型余额查询 (用户自己提供余额接口)
// 支持: 手动映射(totalPath/usedPath 点分路径) / 指定解析类型(queryType) / 自动探测(auto)
// ============================================================
export const dotGet = (obj, path) => {
  if (!path || obj == null) return undefined
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export async function queryCustomModel(model, config) {
  const { id, name, apiUrl, apiKey, queryType, totalPath, usedPath, currency } = model
  const base = { platform: id, name: name || '自定义模型', icon: 'relay', color: '#8B5CF6', category: '自定义' }
  if (!apiUrl) {
    return { ...base, status: 'no-key', error: '未配置接口 URL', noBalance: true }
  }
  const headers = { Accept: 'application/json' }
  if (apiKey) headers['Authorization'] = apiKey.trim().startsWith('Bearer') ? apiKey.trim() : `Bearer ${apiKey.trim()}`
  try {
    const res = await fetchWithTimeout(apiUrl, headers, config.timeoutMs || 8000, 'GET')
    if (!res.ok) {
      const isAuth = res.status === 401 || res.status === 403
      return { ...base, status: isAuth ? 'auth-error' : 'error', error: `HTTP ${res.status}${isAuth ? ' (认证失败)' : ''}`, noBalance: true }
    }
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { json = null }

    // 1) 手动映射优先 (totalPath 点分路径, 如 data.balance)
    if (totalPath) {
      const raw = dotGet(json, totalPath)
      const total = toAmount(raw)
      if (raw != null && Number.isFinite(Number(raw))) {
        const used = usedPath ? toAmount(dotGet(json, usedPath)) : null
        return {
          ...base, status: 'ok', total, currency: currency || 'CNY',
          available: used != null && used >= 0 ? total - used : total, used,
          note: '自定义映射', percent: null, noBalance: false, queryType: 'custom', fetchedAt: Date.now(),
        }
      }
    }

    // 2) 指定解析类型
    if (queryType && queryType !== 'auto') {
      const parsed = parseResponse(queryType, json, config?.currency)
      if (parsed) {
        return { ...base, status: 'ok', total: parsed.total, currency: parsed.currency, available: parsed.available, used: parsed.used, note: parsed.note, percent: parsed.percent, noBalance: false, queryType, fetchedAt: Date.now() }
      }
    } else {
      // 3) auto: 尝试常见格式
      for (const qt of ['openai', 'quota', 'deepseek', 'openai-billing']) {
        const parsed = parseResponse(qt, json, config?.currency)
        if (parsed) {
          return { ...base, status: 'ok', total: parsed.total, currency: parsed.currency, available: parsed.available, used: parsed.used, note: parsed.note, percent: parsed.percent, noBalance: false, queryType: qt, fetchedAt: Date.now() }
        }
      }
    }
    return { ...base, status: 'parse-error', error: '无法解析余额数据', noBalance: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ...base, status: 'error', error: message.includes('abort') ? '请求超时' : '网络错误', noBalance: true }
  }
}

// ============================================================
// 会话消耗投影 (学习 dsh-balance queryBalanceCost)
// ============================================================
/**
 * v1.4.0: 子代理消耗汇总。
 *
 * 背景: 本投影只折叠**本会话**的事件, 而子代理(subagent)跑在自己的子会话里 —— 手机会话
 * 开了子代理后, 子代理烧的 token 完全不在主板数字里。
 *
 * 数据源分两条, 因为子代理会话会「由热转冷」:
 *   ① **热路径(首选)**: `ctx.sessions.get(id)` + `sessionProjections.snapshot/stateOf`。
 *      父会话的 `subagentCatalog` 投影给出**按创建顺序**的直接子会话; 每个子会话的
 *      `queryBalanceCost` 投影(就是本插件注册的同一个 unit)给出它的消耗。
 *   ② **冷路径(兜底)**: 读持久化投影缓存文件 `storages/session_projcache/sessions/<id>.json`。
 *      ⚠️ 为什么必须要这条: 框架的 `SubagentListEntry.activity` 只有 `'running' | 'inactive'`,
 *      **inactive = 只存在于持久化里** —— 子代理跑完(或其 turn 结束)后就不在 `ctx.sessions`
 *      的常驻表里了, `sessions.get()` 取不到 → 面板显示 `~—`(实测踩到)。框架自己的
 *      `listChildren()` 走"投影缓存读"解决这件事, 但它是 **async**, 而投影的 `view()`
 *      契约要求**同步** —— 所以这里同步读缓存文件。形状取自实测, 读不到/形状不符一律静默返回 null。
 *
 * 递归展开孙代理并把金额**向上汇总**到直接子代理那一条 (深度 / 行数都有封顶)。
 *
 * @param services 惰性取服务: () => ({ sessions, projections }) | null。取不到就静默返回空数组
 *                 (老框架 / 单测环境), 绝不让子代理汇总拖垮主投影。
 */
const SUBAGENT_MAX_DEPTH = 4
const SUBAGENT_MAX_ROWS = 12
/** 冷路径的文件读缓存 TTL —— view() 会随每次投影变化被调用, 不能每次都去读盘。 */
const SUBAGENT_FILE_TTL_MS = 3000
const sessionCacheFiles = new Map()
let subagentCostSummarize = null

const safeSessionId = (id) => typeof id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(id) ? id : null

/** 读某会话的投影缓存记录(带 TTL 内存缓存)。任何异常 → null。 */
const readSessionCacheRecord = (sessionId) => {
  const id = safeSessionId(sessionId)
  if (id === null) return null
  const now = Date.now()
  const hit = sessionCacheFiles.get(id)
  if (hit !== undefined && now - hit.at < SUBAGENT_FILE_TTL_MS) return hit.rows
  let rows = null
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    const file = join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`)
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const r = parsed?.record?.rows
    if (r !== null && typeof r === 'object') rows = r
  } catch { rows = null }
  // 只缓存成功结果, 避免一次读失败被 TTL 钉住 3 秒
  if (rows !== null) sessionCacheFiles.set(id, { at: now, rows })
  if (sessionCacheFiles.size > 256) sessionCacheFiles.clear()
  return rows
}

/** 冷路径: 从缓存文件里取该会话的 queryBalanceCost **状态**(不是 wire 视图)。 */
const cachedCostState = (sessionId) => {
  const val = readSessionCacheRecord(sessionId)?.queryBalanceCost?.val
  return (val !== null && typeof val === 'object' && Array.isArray(val.modelOrder) && val.byModel !== null && typeof val.byModel === 'object') ? val : null
}

/** 冷路径: 从缓存文件里取该会话的 subagentCatalog 条目。 */
const cachedCatalog = (sessionId) => {
  const st = readSessionCacheRecord(sessionId)?.subagentCatalog?.val
  const values = st?.head?.values
  if (!Array.isArray(values)) return []
  return values
    .filter((v) => v !== null && typeof v === 'object' && typeof v.childId === 'string')
    .map((v) => ({
      id: v.childId,
      createdAt: typeof v.childCreatedAt === 'number' ? v.childCreatedAt : 0,
      mode: v.mode === 'continuable' ? 'continuable' : 'one-shot',
      label: typeof v.label === 'string' ? v.label : undefined,
    }))
}

export function collectSubagentCosts(services, rootSessionId, summarize) {
  const out = []
  if (typeof rootSessionId !== 'string' || rootSessionId === '') return out
  let sessions = null, projections = null
  try {
    const svc = typeof services === 'function' ? services() : services
    sessions = svc?.sessions ?? null
    projections = svc?.projections ?? null
  } catch { /* 服务取不到 → 只能走冷路径 */ }
  subagentCostSummarize = typeof summarize === 'function' ? summarize : null

  /** 取常驻会话对象。任何异常一律当成"取不到"(宿主服务在极端情况下可能抛)。 */
  const getSession = (id) => {
    try { return sessions?.get?.(id) ?? null } catch { return null }
  }

  /** 某会话的直接子会话(按创建顺序): 热路径优先, 空则回落到缓存文件。 */
  const childrenOf = (sessionId) => {
    const s = getSession(sessionId)
    if (s !== null && projections !== null) {
      try {
        const list = projections.snapshot(s, ['subagentCatalog'])?.values?.subagentCatalog
        if (Array.isArray(list) && list.length > 0) return list
      } catch { /* 落到冷路径 */ }
    }
    return cachedCatalog(sessionId)
  }

  /** 某会话的消耗投影状态: 热路径优先(更新鲜), 无数据则回落到缓存文件。 */
  const costStateOf = (sessionId) => {
    const s = getSession(sessionId)
    if (s !== null && projections !== null) {
      try {
        const st = projections.stateOf(s, 'queryBalanceCost')
        if (st !== null && st !== undefined && Array.isArray(st.modelOrder) && st.modelOrder.length > 0) return st
      } catch { /* 落到冷路径 */ }
    }
    return cachedCostState(sessionId)
  }

  /** 递归汇总: 自身 + 后代, 返回与 summarize 同形的汇总。 */
  const rollup = (sessionId, depth) => {
    const st = costStateOf(sessionId)
    let acc = (st !== null && subagentCostSummarize !== null) ? subagentCostSummarize(st) : null
    if (depth >= SUBAGENT_MAX_DEPTH) return acc
    for (const entry of childrenOf(sessionId)) {
      acc = mergeSummary(acc, rollup(entry.id, depth + 1))
    }
    return acc
  }

  for (const entry of childrenOf(rootSessionId)) {
    if (out.length >= SUBAGENT_MAX_ROWS) break
    const s = rollup(entry.id, 1) ?? emptySummary()
    out.push({
      id: String(entry.id),
      label: typeof entry.label === 'string' && entry.label !== '' ? entry.label : String(entry.id).slice(0, 12),
      mode: entry.mode === 'continuable' ? 'continuable' : 'one-shot',
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0,
      cost: s.cost,
      costByCurrency: s.costByCurrency,
      currencyByModel: s.currencyByModel,
      mixedCurrency: s.mixedCurrency,
      tokens: s.tokens,
      models: s.models,
    })
  }
  return out
}

/** 一份空的汇总 (与 summarize 同形)。 */
export const emptySummary = () => ({
  cost: 0, costByModel: {}, costByCurrency: {}, currencyByModel: {}, mixedCurrency: false, models: [],
  tokens: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, tokensByModel: {},
})

/** 把两份汇总按币种/模型/token 相加 (子代理树向上汇总用)。 */
export const mergeSummary = (a, b) => {
  const x = a ?? emptySummary(), y = b ?? emptySummary()
  const round6 = (n) => Math.round(n * 1e6) / 1e6
  const sumMap = (p, q) => {
    const out = { ...(p || {}) }
    for (const [k, v] of Object.entries(q || {})) out[k] = round6((out[k] ?? 0) + v)
    return out
  }
  const costByCurrency = sumMap(x.costByCurrency, y.costByCurrency)
  const costByModel = sumMap(x.costByModel, y.costByModel)
  const tokens = {
    uncachedInput: x.tokens.uncachedInput + y.tokens.uncachedInput,
    cacheRead: x.tokens.cacheRead + y.tokens.cacheRead,
    cacheWrite: x.tokens.cacheWrite + y.tokens.cacheWrite,
    output: x.tokens.output + y.tokens.output,
  }
  const tokensByModel = { ...(x.tokensByModel || {}) }
  for (const [m, t] of Object.entries(y.tokensByModel || {})) {
    const p = tokensByModel[m] ?? { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
    tokensByModel[m] = {
      uncachedInputTokens: p.uncachedInputTokens + (t?.uncachedInputTokens ?? 0),
      cacheReadTokens: p.cacheReadTokens + (t?.cacheReadTokens ?? 0),
      cacheWriteTokens: p.cacheWriteTokens + (t?.cacheWriteTokens ?? 0),
      outputTokens: p.outputTokens + (t?.outputTokens ?? 0),
    }
  }
  const models = [...new Set([...(x.models || []), ...(y.models || [])])]
  const mainCur = Object.keys(costByCurrency)[0]
  return {
    cost: mainCur === undefined ? 0 : costByCurrency[mainCur],
    costByModel, costByCurrency,
    currencyByModel: { ...x.currencyByModel, ...y.currencyByModel },
    mixedCurrency: Object.keys(costByCurrency).length > 1,
    models, tokens, tokensByModel,
  }
}

export function makeCostProjection(configOrGetter, services) {
  const getConfig = () => typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const zero = () => ({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })
  const bucketsOf = (usage) => ({
    uncachedInputTokens: usage.inputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  })
  const bucketsEqual = (a, b) =>
    a.uncachedInputTokens === b.uncachedInputTokens && a.cacheReadTokens === b.cacheReadTokens &&
    a.cacheWriteTokens === b.cacheWriteTokens && a.outputTokens === b.outputTokens
  const addBuckets = (a, b) => ({
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  })
  const subBuckets = (a, b) => ({
    uncachedInputTokens: a.uncachedInputTokens - b.uncachedInputTokens,
    cacheReadTokens: a.cacheReadTokens - b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens - b.cacheWriteTokens,
    outputTokens: a.outputTokens - b.outputTokens,
  })
  const round6 = (n) => Math.round(n * 1e6) / 1e6

  /**
   * v1.4.0: 从一条 assistant stream 里取**最后一次** usage chunk。
   * 与 dsh-llm 的 `lastAssistantStreamChunk(stream, 'usage')` 同语义, 本地实现以免给插件引入额外依赖
   * (`dependencies` 必须保持为空是硬约束)。
   */
  const lastUsageFromStream = (stream) => {
    if (!Array.isArray(stream)) return undefined
    for (let i = stream.length - 1; i >= 0; i -= 1) {
      const rec = stream[i]
      if (rec !== null && typeof rec === 'object' && rec.type === 'chunk' && rec.chunk?.type === 'usage') return rec.chunk.usage
    }
    return undefined
  }

  /**
   * v1.4.0: 一个事件所携带的用量样本。对齐 dsh-token-meter 的 usage-projection:
   *   - `assistant/message` 优先用自带 `usage`, 没有则回落到 stream 里的 usage chunk;
   *   - `assistant/attempt`(失败/重试/取消/流错误、没有产出可见消息的尝试) 从 stream 里取。
   * ⚠️ 旧代码读的是 `assistant/chunk` —— 该事件名**不在**框架 `KNOWN_SESSION_EVENT_TYPES` 里, 是死分支,
   *    导致上面两种真实事件里 `assistant/attempt` 的 token 被整段漏计。
   */
  const usageOfEvent = (event) => {
    if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
    return lastUsageFromStream(event.data.stream)
  }

  /**
   * v1.4.0: 把一份投影状态折成金额汇总 —— 主视图与子代理汇总**共用同一套口径**,
   * 保证「子代理那行」与「主板数字」算法完全一致 (含峰谷、币种、缓存读写分桶)。
   */
  const summarize = (state) => {
    const cfg = getConfig()
    const mainCurrency = (cfg.currency ?? 'CNY').toUpperCase()
    const tokens = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
    const costByModel = {}
    const costByCurrency = {}
    const currencyByModel = {}
    let cost = 0
    const order = Array.isArray(state?.modelOrder) ? state.modelOrder : []
    for (const model of order) {
      const b = state.byModel?.[model] ?? zero()
      tokens.uncachedInput += b.uncachedInputTokens
      tokens.cacheRead += b.cacheReadTokens
      tokens.cacheWrite += b.cacheWriteTokens
      tokens.output += b.outputTokens
      // 支持 DeepSeek 谷峰自动计费
      const price = resolveModelPrice(cfg, model)
      const c = ((b.uncachedInputTokens + b.cacheWriteTokens) * price.cacheMiss + b.cacheReadTokens * price.cacheHit + b.outputTokens * price.output) / 1e6
      // v1.3.2: 该模型实际币种 (海外模型可能与主货币不同)
      const cur = currencyForModel(cfg, model)
      if (c > 0) {
        costByModel[model] = round6(c)
        currencyByModel[model] = cur
        costByCurrency[cur] = round6((costByCurrency[cur] ?? 0) + c)
      }
      // cost 仍只汇总「主货币」那一份, 保持字段语义单一 (混合时另一半在 costByCurrency 里)。
      // overseasCurrency='follow' 时所有模型都是主货币, cost === 全部合计, 与 v1.2.6 一致。
      if (cur === mainCurrency) cost += c
    }
    return {
      cost: round6(cost), costByModel, costByCurrency, currencyByModel,
      mixedCurrency: Object.keys(costByCurrency).length > 1,
      tokens, tokensByModel: state?.byModel ?? {}, models: order, mainCurrency,
    }
  }

  return {
    key: 'queryBalanceCost',
    // 框架要求的投影定义 API: stateSchema(内部状态) + wire.{viewSchema,view}(客户端可见视图)。
    // 旧版误用顶层 schema+view, 导致 wire 缺失, 服务端 drive 永不通知、客户端永远拿不到值。
    stateSchema: z.object({
      currentModel: z.string().nullable(),
      currentProvider: z.string().nullable(),
      last: z.object({
        turn: z.number(),
        step: z.number(),
        model: z.string(),
        buckets: z.object({
          uncachedInputTokens: z.number(),
          cacheReadTokens: z.number(),
          cacheWriteTokens: z.number(),
          outputTokens: z.number(),
        }),
      }).nullable(),
      byModel: z.record(z.string(), z.object({
        uncachedInputTokens: z.number(),
        cacheReadTokens: z.number(),
        cacheWriteTokens: z.number(),
        outputTokens: z.number(),
      })),
      modelOrder: z.array(z.string()),
      /** v1.4.0: 本投影所属会话 id —— 子代理汇总要拿它去查 `subagentCatalog`。空串表示未知。 */
      sessionId: z.string(),
    }),
    init: (header) => ({
      currentModel: null, currentProvider: null, last: null, byModel: {}, modelOrder: [],
      sessionId: typeof header?.id === 'string' ? header.id : '',
    }),
    apply: (state, event) => {
      // v1.4.0: `llm/retry-started` 关闭「替换槽位」—— 被重试的那次 attempt 的用量要**留在总量里**,
      // 下一次 attempt 是**新增**而不是替换。与 dsh-token-meter 的 usage-projection 对齐。
      if (event.type === 'llm/retry-started') {
        const turn = event.data?.turn
        const step = event.data?.step
        return state.last !== null && state.last.turn === turn && state.last.step === step
          ? { ...state, last: null }
          : state
      }
      let nextModel = state.currentModel
      let nextProvider = state.currentProvider
      if (event.type === 'request/header') {
        const model = event.data.header?.config?.model
        if (typeof model === 'string' && model !== '') nextModel = model
        const prov = event.data.header?.config?.provider
        if (typeof prov === 'string' && prov !== '') nextProvider = prov
      } else if (event.type === 'request/context') {
        const model = event.data.model
        if (typeof model === 'string' && model !== '') nextModel = model
        const prov = event.data.provider
        if (typeof prov === 'string' && prov !== '') nextProvider = prov
      }
      let usage = null, turn = 0, step = 0
      const sample = usageOfEvent(event)
      if (sample !== undefined && sample !== null) {
        turn = event.data.turn
        step = event.data.step
        usage = sample
      }
      const unchanged = nextModel === state.currentModel && nextProvider === state.currentProvider
      if (usage === null) return unchanged ? state : { ...state, currentModel: nextModel, currentProvider: nextProvider }
      const model = nextModel ?? 'unknown'
      const buckets = bucketsOf(usage)
      const prev = state.last !== null && state.last.turn === turn && state.last.step === step ? state.last : null
      if (prev !== null && prev.model === model && bucketsEqual(prev.buckets, buckets)) {
        return unchanged ? state : { ...state, currentModel: nextModel, currentProvider: nextProvider }
      }
      const isNewModel = !(model in state.byModel)
      let byModel = state.byModel
      if (prev !== null) byModel = { ...byModel, [prev.model]: subBuckets(byModel[prev.model] ?? zero(), prev.buckets) }
      byModel = { ...byModel, [model]: addBuckets(byModel[model] ?? zero(), buckets) }
      return { ...state, currentModel: nextModel, currentProvider: nextProvider, last: { turn, step, model, buckets }, byModel, modelOrder: isNewModel ? [...state.modelOrder, model] : state.modelOrder }
    },
    wire: {
      viewSchema: z.object({
        models: z.array(z.string()),
        // v0.5.3: 暴露当前会话正在使用的模型, 客户端据此自动切换选中平台
        currentModel: z.string().nullable(),
        // 当前 provider (中转站/官方), 客户端据此判断是否走官方余额
        currentProvider: z.string().nullable().optional(),
        cost: z.number(),
        costByModel: z.record(z.string(), z.number().nonnegative()),
        // v1.3.2: 海外模型可独立走 USD, 于是一个会话可能同时产生两种货币的消耗。
        // 不做汇率折算合并 (折算=再引入 ×7 误差), 客户端两段拼接显示。
        costByCurrency: z.record(z.string(), z.number().nonnegative()).optional(),
        currencyByModel: z.record(z.string(), z.string()).optional(),
        mixedCurrency: z.boolean().optional(),
        tokens: z.object({ uncachedInput: z.number().int().nonnegative(), cacheRead: z.number().int().nonnegative(), cacheWrite: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).strict(),
        tokensByModel: z.record(z.string(), z.object({ uncachedInputTokens: z.number().int().nonnegative(), cacheReadTokens: z.number().int().nonnegative(), cacheWriteTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict()).optional(),
        currency: z.string(),
        isPeak: z.boolean().optional(),
        waiting: z.boolean().optional(),
        // v1.4.0: 子代理消耗, 按父会话 catalog 事件顺序 (= 创建顺序) 从左到右展示。
        // 金额是「该子代理 + 其后代」的向上汇总; 取不到会话服务时为空数组。
        subagents: z.array(z.object({
          id: z.string(),
          label: z.string(),
          mode: z.enum(['one-shot', 'continuable']),
          createdAt: z.number(),
          cost: z.number(),
          costByCurrency: z.record(z.string(), z.number().nonnegative()),
          currencyByModel: z.record(z.string(), z.string()),
          mixedCurrency: z.boolean(),
          tokens: z.object({
            uncachedInput: z.number().int().nonnegative(),
            cacheRead: z.number().int().nonnegative(),
            cacheWrite: z.number().int().nonnegative(),
            output: z.number().int().nonnegative(),
          }).strict(),
          models: z.array(z.string()),
        }).strict()).optional(),
      }).strict(),
      view: (state) => {
      const cfg = getConfig()
      const mainCurrency = (cfg.currency ?? 'CNY').toUpperCase()
      // v1.4.0: 子代理消耗 (换行单独展示)。取不到服务/没有子代理 → 空数组。
      const subagents = collectSubagentCosts(services, state.sessionId, summarize)
      // 无事件时返回 waiting 标记, 客户端据此显示 "~—" 而非 "~¥0"
      if (state.modelOrder.length === 0) {
        return { models: [], currentModel: state.currentModel ?? null, currentProvider: state.currentProvider ?? null, cost: -1, costByModel: {}, costByCurrency: {}, currencyByModel: {}, mixedCurrency: false, tokens: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, tokensByModel: {}, currency: mainCurrency, isPeak: isPeakTime(), waiting: true, subagents }
      }
      const s = summarize(state)
      return {
        models: s.models, currentModel: state.currentModel ?? null, currentProvider: state.currentProvider ?? null,
        cost: s.cost, costByModel: s.costByModel, costByCurrency: s.costByCurrency, currencyByModel: s.currencyByModel,
        mixedCurrency: s.mixedCurrency, tokens: s.tokens, tokensByModel: s.tokensByModel,
        currency: mainCurrency, isPeak: isPeakTime(), waiting: false, subagents,
      }
      },
    },
    stateVersion: 2,
  }
}

// ============================================================
// 插件主体
// ============================================================
export function apply(ctx, config) {
  // 用户保存的配置优先于 cordis.patch.yml 的默认 config (持久化状态)
  const persisted = loadPersistedState()
  // A: 载入上次记住的中转站端点
  try {
    relayEndpointHints.clear()
    const saved = persisted.relayEndpoints
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [k, v] of Object.entries(saved)) {
        if (typeof k === 'string' && k.length <= 128 && typeof v === 'string' && v.length <= 32) relayEndpointHints.set(k, v)
      }
    }
  } catch { /* 忽略 */ }
  const runtimeConfig = {
    refreshIntervalMs: persisted.refreshIntervalMs ?? config.refreshIntervalMs ?? 5000,
    clientPollIntervalMs: persisted.clientPollIntervalMs ?? config.clientPollIntervalMs ?? 5000,
    timeoutMs: persisted.timeoutMs ?? config.timeoutMs ?? 8000,
    presets: config.presets ?? PLATFORM_PRESETS.map(p => p.id),
    // H-1 (v1.4.1): 这里必须带 Array.isArray —— 状态文件形状跑偏时 apply() 抛出 =
    // 整个 dsh web 启动失败(migratePersistedState 已消毒, 这里是第二道防线)
    customRelays: (Array.isArray(persisted.customRelays) ? persisted.customRelays : (Array.isArray(config.customRelays) ? config.customRelays : [])).map(r => ({ ...r })),
    customModels: (Array.isArray(persisted.customModels) ? persisted.customModels : (Array.isArray(config.customModels) ? config.customModels : [])).map(m => ({ ...m })),
    prices: config.prices ?? { 'deepseek-chat': { cacheHit: 0.1, cacheMiss: 1, output: 2 } },
    defaultPrices: config.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 },
    currency: persisted.currency ?? config.currency ?? 'CNY',
    // v1.3.2: 海外模型独立计价货币 ('follow' = 跟随主货币, 默认, 行为同 v1.2.6)
    overseasCurrency: persisted.overseasCurrency ?? config.overseasCurrency ?? 'follow',
    safeThreshold: persisted.safeThreshold ?? config.safeThreshold ?? 50,
    warnThreshold: persisted.warnThreshold ?? config.warnThreshold ?? 10,
    whaleEnabled: persisted.whaleEnabled ?? config.whaleEnabled ?? false,
    showNoBalanceBrands: persisted.showNoBalanceBrands ?? config.showNoBalanceBrands ?? false,
    officialProviders: normalizeOfficialProviders(persisted.officialProviders ?? config.officialProviders ?? []),
    // v1.4.0「真自动」: 被用户关掉的 DSH provider (默认空 = 全部启用)。复用同一个名单规范化器。
    dshProviderOptOut: normalizeOfficialProviders(persisted.dshProviderOptOut ?? config.dshProviderOptOut ?? []),
    whaleSettings: {
      scale: 1, soundOn: true, soundSet: 'duck', volume: 0.5, bubbleOn: true,
      peakMode: 'default', snapOn: true, peekRatio: 0.5, left: null, top: null, side: 'right',
      ...(config.whaleSettings ?? {}),
      ...(persisted.whaleSettings ?? {}),
    },
  }

  const getConfig = () => runtimeConfig

  /** 直接读 ~/.dsh/.credentials.yaml 的 refs: 段 —— 拿不到 credentials 服务时的兜底。
   *  @param {string[]} names 要找的 ref 名 (遇到第一个有值的就返回) */
  const readCredentialRefs = (names) => {
    const wanted = Array.isArray(names) ? names : []
    if (wanted.length === 0) return ''
    try {
      const home = process.env.DSH_HOME || join(homedir(), '.dsh')
      const raw = readFileSync(join(home, '.credentials.yaml'), 'utf8')
      let inRefs = false
      for (const line of raw.split('\n')) {
        if (line === 'refs:') { inRefs = true; continue }
        if (!inRefs) continue
        if (!line.startsWith('  ')) { inRefs = false; continue }
        const idx = line.indexOf(':')
        if (idx === -1) continue
        const key = line.slice(0, idx).trim()
        const val = line.slice(idx + 1).trim()
        if (key && val && wanted.includes(key)) return val
      }
    } catch { /* 忽略 */ }
    return ''
  }

  /** 解析一个 apiKeyEnv 名 → 真实 key (环境变量 → credentials 服务 → 凭据文件)。
   *  v1.4.0「真自动」用它取 DSH provider 的 key, 与预设平台同一套三层兜底。 */
  const resolveApiKeyRef = async (ref) => {
    const name = typeof ref === 'string' ? ref.trim() : ''
    if (name === '') return ''
    if (process.env[name]) return process.env[name]
    const creds = ctx.get('credentials')
    if (creds !== undefined) {
      try {
        const hit = await creds.resolve(name)
        if (hit !== undefined) return hit.value
      } catch { /* 忽略 */ }
    }
    return readCredentialRefs([name])
  }

  /** 解析预设平台的 API key (从环境变量、credentials 系统或直接读凭据文件) */
  const resolvePresetKey = async (platform) => {
    const refs = platform.envKeys || []
    // 1) 环境变量
    for (const name of refs) {
      if (process.env[name]) return process.env[name]
    }
    // 2) DSH credentials 服务
    const creds = ctx.get('credentials')
    if (creds !== undefined) {
      for (const ref of refs) {
        try {
          const hit = await creds.resolve(ref)
          if (hit !== undefined) return hit.value
        } catch { /* 忽略 */ }
      }
    }
    // 3) 直接读 ~/.dsh/.credentials.yaml 文件兜底
    return readCredentialRefs(refs)
  }

  /**
   * v1.4.0「真自动」: 把 DSH settings.yaml 里的 provider 合成为可查余额的中转站条目。
   * 挑选规则见模块级纯函数 `selectDshProviders` (可单测)。
   * 这里只多一步: 解析 key —— 要访问 credentials 服务, 所以必须是异步的。
   * 与手填的 customRelays 合并时**手填优先** (同 id / 同 baseUrl 都算重复), 见 refreshAll。
   */
  const listDshProviderRelays = async () => {
    const { entries, kinds } = readSettingsDerived()
    const picked = selectDshProviders(entries, kinds, runtimeConfig.dshProviderOptOut)
    const out = []
    for (const p of picked) {
      out.push({
        id: 'dsh:' + p.name,
        name: p.name + ' (DSH)',
        baseUrl: p.baseURL,
        apiKey: await resolveApiKeyRef(p.apiKeyEnv),
        queryType: 'auto',
        fromDsh: true,
      })
    }
    return out
  }

  /** 设置面板用: DSH provider 自动发现结果 (只读展示 + 开关状态)。**绝不下发 key**。 */
  const readDshProviderStatus = () => {
    const { entries, kinds } = readSettingsDerived()
    const on = new Set(selectDshProviders(entries, kinds, runtimeConfig.dshProviderOptOut).map((p) => p.name))
    return Object.keys(entries).sort().map((name) => {
      const e = entries[name]
      const kind = e.baseURL ? (kinds[name] || 'unknown') : 'no-base-url'
      return {
        name,
        baseURL: e.baseURL,
        apiKeyEnv: e.apiKeyEnv,
        // official | relay | unknown(主机名解析不出) | no-base-url(没写 baseURL, 不表态)
        kind,
        enabled: on.has(name),
      }
    })
  }

  let cache = { balances: [], fetchedAt: 0, error: null }
  let inflight = null

  const refreshAll = async () => {
    if (inflight !== null) return inflight
    inflight = (async () => {
      const presetList = PLATFORM_PRESETS.filter(p => runtimeConfig.presets.includes(p.id))
      // v1.4.0「真自动」: 手填的 customRelays + 从 settings.yaml 自动发现的 DSH provider。
      // 手填优先 —— 同 id 或同 baseUrl 时不重复查一遍 (用户手填的那条口径由他自己定)。
      const manualRelays = runtimeConfig.customRelays
      const dshRelays = await listDshProviderRelays()
      const manualIds = new Set(manualRelays.map(r => String(r.id)))
      const manualUrls = new Set(manualRelays.map(r => String(r.baseUrl || '').replace(/\/+$/, '')))
      const relayList = [
        ...manualRelays,
        ...dshRelays.filter(r => !manualIds.has(r.id) && !manualUrls.has(r.baseUrl)),
      ]
      const modelList = runtimeConfig.customModels
      const tasks = [
        ...presetList.map(async (p) => queryPreset(p, await resolvePresetKey(p), runtimeConfig)),
        ...relayList.map(async (r) => queryCustomRelay(r, runtimeConfig)),
        ...modelList.map(async (m) => queryCustomModel(m, runtimeConfig)),
      ]
      const results = await Promise.allSettled(tasks)
      // v0.5.7: last-known-good 兜底 — 平台瞬时网络故障(超时/DNS抖动)不冲掉上次成功数据,
      // 避免看板红闪「异常」; 标注 stale 提示用户这是暂存值
      const prevBalances = Array.isArray(cache.balances) ? cache.balances : []
      const prevOf = new Map(prevBalances.map((b) => [b.platform, b]))
      const balances = results.map((r) => {
        const cur = r.status === 'fulfilled' ? r.value : { platform: 'unknown', name: '未知', icon: 'relay', color: '#64748B', category: '中转站', status: 'error', error: '查询失败', noBalance: true }
        if (cur && cur.status === 'error' && !String(cur.error || '').includes('认证')) {
          const old = prevOf.get(cur.platform)
          if (old && old.status === 'ok') {
            return { ...old, fetchedAt: old.fetchedAt, staleNote: '暂用上次数据(本次查询失败)', error: undefined }
          }
        }
        return cur
      })
      cache = {
        balances, fetchedAt: Date.now(), error: null,
        config: {
          refreshIntervalMs: runtimeConfig.refreshIntervalMs,
          clientPollIntervalMs: runtimeConfig.clientPollIntervalMs,
          safeThreshold: runtimeConfig.safeThreshold,
          warnThreshold: runtimeConfig.warnThreshold,
          currency: runtimeConfig.currency,
          overseasCurrency: runtimeConfig.overseasCurrency,
          isPeak: isPeakTime(),
          isWeekend: isWeekend(),
          whaleEnabled: !!runtimeConfig.whaleEnabled,
          showNoBalanceBrands: !!runtimeConfig.showNoBalanceBrands,
          // provider 官方/中转判定素材下发给客户端 (第 1 层: 用户名单; 第 2 层: baseURL 域名判定)
          officialProviders: runtimeConfig.officialProviders,
          providerKinds: readProviderKinds(),
          // v1.4.0「真自动」: DSH provider 发现结果 (只读, 不含 key)
          dshProviders: readDshProviderStatus(),
          // v1.5.0-desktop-preview: 版本与预发行标识 —— 客户端据此显示「预览版」横幅, 并停用一键更新
          version: PLUGIN_VERSION,
          preview: IS_PREVIEW,
        },
      }
      cache.etag = '"' + fnv1a(JSON.stringify(cache.balances) + '|' + JSON.stringify(cache.config)) + '"'
      // A3: 告警检测
      checkAlerts(balances, runtimeConfig, ctx)
    })().finally(() => { inflight = null })
    return inflight
  }

  let loopTimer = null
  const resetLoop = () => {
    if (loopTimer !== null) { clearTimeout(loopTimer); loopTimer = null }
    const run = () => { refreshAll().catch(() => {}).finally(() => { loopTimer = setTimeout(run, runtimeConfig.refreshIntervalMs) }) }
    loopTimer = setTimeout(run, 0)
  }

  ctx.effect(() => {
    resetLoop()
    return () => { if (loopTimer !== null) clearTimeout(loopTimer) }
  }, 'dsh-api-dashboard: refresh loop')

  // HTTP 路由
  ctx.inject(['webServer'], (webCtx) => {
    const sendJson = (res, code, data) => {
      const body = JSON.stringify(data)
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) })
      res.end(body)
    }

    /**
     * H-3 (v1.4.1): 插件路由的鉴权闸门。
     *
     * 为什么必须有这道闸: dsh 的 webserver 是「先查 exact 路由表, 再走 fallback」,
     * 而浏览器的登录 cookie 校验只写在 fallback 里(dsh-host-frontend-static) ——
     * 于是 `/api-dashboard/*` 全部绕过鉴权: 无需 token、无需 cookie 就能读配置、
     * 改配置、改挂件、甚至触发 `/update/install`(会重写插件目录)。
     * 更糟的是 `Content-Type: text/plain` 属于**浏览器不预检的 simple request**,
     * 用户手机上随便打开一个网页, 那个网页就能 POST 过来改配置(实测 HTTP 200 且真的改了)。
     *
     * 老版本 dsh 没有 connection 服务时放行(那时本来也没有鉴权概念), 避免把插件打死。
     */
    /**
     * H-3 (v1.4.1): 插件路由的鉴权闸门。
     *
     * 为什么必须有这道闸: dsh 的 webserver 是「先查 exact 路由表, 再走 fallback」,
     * 而浏览器的登录 cookie 校验只写在 fallback 里(dsh-host-frontend-static) ——
     * 于是 `/api-dashboard/*` 全部绕过鉴权: 无需 token、无需 cookie 就能读配置、
     * 改配置、改挂件、甚至触发 `/update/install`(会重写插件目录)。
     * 更糟的是 `Content-Type: text/plain` 属于**浏览器不预检的 simple request**,
     * 用户手机上随便打开一个网页, 那个网页就能 POST 过来改配置(实测 HTTP 200 且真的改了)。
     *
     * 用 `connection.requestRejection(req)`: 与 dsh-web-mobile 同一个闸门,
     * 同时覆盖「浏览器 cookie 鉴权」与「Host/来源可信」两项检查。
     * ⚠️ 不能写 `ctx.get('connection')` —— 实测在插件 fiber 上取不到(返回 undefined),
     *    必须用嵌套 inject 拿服务实例。
     */
    let connectionSvc = null
    ctx.inject(['connection'], (c) => { connectionSvc = c.connection })
    const allowRequest = (req, res) => {
      const conn = connectionSvc
      // 老版本 dsh 没有 connection 服务时放行(那时本来也没有鉴权概念), 避免把插件打死
      if (!conn || typeof conn.requestRejection !== 'function') return true
      let rejection
      try { rejection = conn.requestRejection(req) } catch { rejection = undefined }
      if (rejection === undefined) return true
      res.writeHead(rejection, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(rejection === 401 ? 'dsh web authentication required; reopen the URL printed by dsh web.\n' : 'forbidden\n')
      return false
    }

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/balances',
      async handler(req, res) {
        if (!allowRequest(req, res)) return
        if (!['GET', 'HEAD', 'POST'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD, POST' }); res.end(); return }
        const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
        const force = req.method === 'POST' || params.get('force') === '1'
        /**
         * v1.4.0 `?stale=1` = stale-while-revalidate:
         * 「把手上有的先给我」。应用切回前台 / 页面重载时用它打首屏。
         * 为什么需要它: `force=1` 是**阻塞**的 —— 底下 `await refreshAll()` 要等最慢的那个
         * 端点(最长 timeoutMs=8s)。首屏卡这么久, 用户看到的就是「插件加载很慢」。
         * 有缓存时改成「立刻回旧数据 + 后台刷新」, 由下一次轮询把新数据带上来。
         * 没有缓存(服务端刚重启)时仍然只能等 —— 那时确实没有东西可显示。
         */
        const peek = params.get('stale') === '1'
        const plan = planBalancesFetch({
          force, peek,
          hasData: cache.balances.length > 0,
          age: Date.now() - cache.fetchedAt,
          intervalMs: runtimeConfig.refreshIntervalMs,
        })
        if (plan === 'wait') await refreshAll()                    // 冷启动/显式强刷: 等新数据
        else if (plan === 'background') refreshAll().catch(() => {}) // 有缓存: 立刻回旧的, 刷新丢后台
        // v0.5.0: ETag 协商缓存 — 轮询期间数据没变就 304 空响应, 省 JSON 序列化与流量
        const etag = cache.etag || '"' + Number(cache.fetchedAt || 0).toString(36) + '"'
        if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ETag: etag }); res.end(); return }
        if (!force && req.headers['if-none-match'] === etag && cache.balances.length > 0) {
          res.writeHead(304, { ETag: etag })
          res.end()
          return
        }
        const body = JSON.stringify({ ok: true, balances: cache.balances, fetchedAt: cache.fetchedAt, config: cache.config, loading: cache.balances.length === 0 })
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'private, no-cache',
          ETag: etag,
          'Content-Length': Buffer.byteLength(body),
        })
        res.end(body)
      },
    }), 'dsh-api-dashboard: balances route')

    // v0.5.5: 价格表 (DeepSeek 峰谷全量 + 平价模型), 供详情页标注
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/prices',
      async handler(req, res) {
        if (!allowRequest(req, res)) return
        if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
        const cfg = runtimeConfig
        const cur = (cfg.currency ?? 'CNY').toUpperCase() === 'USD' ? 'USD' : 'CNY'
        const table = V4_RATES[cur] ?? V4_RATES.CNY
        const mk = (p) => p ? { cacheHit: p.cacheHit, cacheMiss: p.cacheMiss, output: p.output } : null
        // v1.3.4: 官方定价页与 GET https://api.deepseek.com/models (2026-09-10 实测) 一致 ——
        // 现役仅 deepseek-flash / deepseek-v4-pro 两个模型。旧名 deepseek-v4-flash / -vision-exp
        // 仍可调用但由 V4.1-Flash 服务、按 Flash 价计费, 解析层已映射到 flash 档, 故此处不再单列免误导。
        const models = []
        for (const key of ['deepseek-flash', 'deepseek-v4-pro']) {
          const src = key.startsWith('deepseek-v4-pro') ? 'deepseek-v4-pro' : 'deepseek-flash'
          models.push({ model: key, peak: mk(table.peak[src]), offPeak: mk(table.offPeak[src]), peakValley: true })
        }
        sendJson(res, 200, { ok: true, currency: cfg.currency ?? 'CNY', peakNow: isPeakTime(), weekend: isWeekend(), models })
      },
    }), 'dsh-api-dashboard: prices route')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/platforms',
      async handler(req, res) {
        if (!allowRequest(req, res)) return
        if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
        const presets = PLATFORM_PRESETS.filter(p => runtimeConfig.presets.includes(p.id)).map(p => ({
          id: p.id, name: p.label, icon: p.icon, color: p.color, category: p.category, queryType: p.queryType,
        }))
        sendJson(res, 200, { ok: true, presets })
      },
    }), 'dsh-api-dashboard: platforms route')

    // v0.6.0: 更新检查 (GET) — 对比远端 main 版本, 5 分钟内存缓存, ?force=1 绕过
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/update',
      async handler(req, res) {
        if (!allowRequest(req, res)) return
        if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
        const force = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('force') === '1'
        try {
          sendJson(res, 200, await getUpdateStatus(force))
        } catch {
          sendJson(res, 200, { ok: false, error: 'check failed', hasUpdate: false })
        }
      },
    }), 'dsh-api-dashboard: update check route')

    // v0.6.0: 执行自更新 (POST /install) — 下载+校验+备份+原子交换, 失败自动回滚
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/update/install',
      async handler(req, res) {
        if (!allowRequest(req, res)) return
        if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return }
        try {
          const result = await applyUpdate({})
          updateCache = { checkedAt: Date.now(), result: { ok: true, current: result.installed, remote: result.installed, hasUpdate: false, checkedAt: Date.now() } }
          sendJson(res, 200, { ok: true, installed: result.installed, targets: result.targets, backup: result.backup, needRestart: true })
        } catch (err) {
          const msg = /already up to date/.test(String(err?.message)) ? `already up to date`
            : /GitHub API|download|remote version/.test(String(err?.message)) ? 'network failed'
            : 'update failed'
          const code = /already up to date/.test(String(err?.message)) ? 200 : 500
          sendJson(res, code, { ok: false, error: msg })
        }
      },
    }), 'dsh-api-dashboard: update install route')

    // v0.7.1: 插件图标 (哦鲸鲸)
    const ICON_PATH = join(SELF_ROOT, 'assets', 'icon.png')
    let iconCache = null
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/icon',
      async handler(req, res) {
        if (!allowRequest(req, res)) return
        if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
        try {
          if (!iconCache) {
            const data = readFileSync(ICON_PATH)
            iconCache = { data, mtime: statSync(ICON_PATH).mtimeMs }
          }
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': iconCache.data.length,
          })
          res.end(iconCache.data)
        } catch {
          res.writeHead(404); res.end()
        }
      },
    }), 'dsh-api-dashboard: icon route')

    // v1.1.0: 大肥鱼互动挂件资产 (移植自 MeteorNOX/DeepSeek-Balance-Whale-Widget, MIT License)
    const WHALE_ASSET_ROOT = join(SELF_ROOT, 'assets', 'whale')
    const whaleAsset = (name) => join(WHALE_ASSET_ROOT, name)
    let whaleImgCache = null
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/whale/image.png',
      async handler(req, res) {
        if (!allowRequest(req, res)) return
        if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
        try {
          if (!whaleImgCache) whaleImgCache = readFileSync(whaleAsset('DSniang1.png'))
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': whaleImgCache.length,
          })
          res.end(whaleImgCache)
        } catch { res.writeHead(404); res.end() }
      },
    }), 'dsh-api-dashboard: whale image route')
    // rua.gif (随机台词动图)
    let whaleGifCache = null
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/whale/rua.gif',
      async handler(req, res) {
        if (!allowRequest(req, res)) return
        if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
        try {
          if (!whaleGifCache) whaleGifCache = readFileSync(whaleAsset('rua.gif'))
          res.writeHead(200, {
            'Content-Type': 'image/gif',
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': whaleGifCache.length,
          })
          res.end(whaleGifCache)
        } catch { res.writeHead(404); res.end() }
      },
    }), 'dsh-api-dashboard: whale gif route')
    // 音效 (每请求读盘 + no-store, 更换音频即生效; ?set=duck|fx1 选音效组)
    for (const kind of ['press', 'release']) {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'exact', path: `/api-dashboard/whale/sound/${kind}.mp3`,
        async handler(req, res) {
        if (!allowRequest(req, res)) return
          if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
          try {
            const set = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('set') === 'fx1' ? 'fx1' : 'duck'
            const table = { duck: { press: 'Ya1.mp3', release: 'Ya2.mp3' }, fx1: { press: 'D1.mp3', release: 'D2.mp3' } }
            const data = readFileSync(whaleAsset(table[set][kind]))
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'no-store',
              'Content-Length': data.length,
            })
            res.end(data)
          } catch { res.writeHead(404); res.end() }
        },
      }), `dsh-api-dashboard: whale sound ${kind} route`)
    }

    // v1.1.0: 大肥鱼挂件设置 (大小/音效/音量/气泡/峰谷文案/吸附/位置) —— 独立轻量端点,
    // 与看板主配置分开, 滑块拖动等高频写入不触发余额刷新
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/whale/settings',
      async handler(req, res) {
        if (!allowRequest(req, res)) return
        if (req.method === 'GET') { sendJson(res, 200, { ok: true, settings: runtimeConfig.whaleSettings }); return }
        if (req.method === 'PUT' || req.method === 'POST') {
          try {
            let raw = await readBody(req)
            const body = raw ? JSON.parse(raw) : {}
            const cur = runtimeConfig.whaleSettings
            const num = (v, lo, hi, dflt) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : dflt)
            runtimeConfig.whaleSettings = {
              scale: num(body.scale, 0.6, 2.5, cur.scale),
              soundOn: typeof body.soundOn === 'boolean' ? body.soundOn : cur.soundOn,
              soundSet: body.soundSet === 'fx1' ? 'fx1' : (body.soundSet === 'duck' ? 'duck' : cur.soundSet),
              volume: num(body.volume, 0, 1, cur.volume),
              bubbleOn: typeof body.bubbleOn === 'boolean' ? body.bubbleOn : cur.bubbleOn,
              peakMode: ['default', 'liangwen', 'qiangqiang'].includes(body.peakMode) ? body.peakMode : cur.peakMode,
              snapOn: typeof body.snapOn === 'boolean' ? body.snapOn : cur.snapOn,
              peekRatio: num(body.peekRatio, 0.15, 0.9, cur.peekRatio),
              left: typeof body.left === 'number' && Number.isFinite(body.left) ? body.left : cur.left,
              top: typeof body.top === 'number' && Number.isFinite(body.top) ? body.top : cur.top,
              // v1.1.0: 只保留左右吸附 (上下不再缩回); '' = 停在屏幕中间不缩
              side: ['left', 'right', ''].includes(body.side) ? body.side : cur.side,
            }
            savePersistedState({
              refreshIntervalMs: runtimeConfig.refreshIntervalMs,
              clientPollIntervalMs: runtimeConfig.clientPollIntervalMs,
              timeoutMs: runtimeConfig.timeoutMs,
              customRelays: runtimeConfig.customRelays,
              customModels: runtimeConfig.customModels,
              currency: runtimeConfig.currency,
              overseasCurrency: runtimeConfig.overseasCurrency,
              safeThreshold: runtimeConfig.safeThreshold,
              warnThreshold: runtimeConfig.warnThreshold,
              whaleEnabled: runtimeConfig.whaleEnabled,
              showNoBalanceBrands: runtimeConfig.showNoBalanceBrands,
              whaleSettings: runtimeConfig.whaleSettings,
            })
            sendJson(res, 200, { ok: true, settings: runtimeConfig.whaleSettings })
          } catch (err) {
            const code = err && err.statusCode === 413 ? 413 : 400
            sendJson(res, code, { ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          return
        }
        res.writeHead(405, { Allow: 'GET, PUT, POST' }); res.end()
      },
    }), 'dsh-api-dashboard: whale settings route')


    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/config',
      async handler(req, res) {
        if (!allowRequest(req, res)) return
        if (req.method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            customRelays: runtimeConfig.customRelays.map(r => ({ ...r, apiKey: r.apiKey ? '***' : '' })),
            customModels: runtimeConfig.customModels.map(m => ({ ...m, apiKey: m.apiKey ? '***' : '' })),
            presets: runtimeConfig.presets,
            refreshIntervalSec: Math.round(runtimeConfig.refreshIntervalMs / 1000),
            currency: runtimeConfig.currency,
            // C-2 (v1.4.1): 以前这里不返回阈值, 设置面板只能等 /balances 带过来;
            // 冷启动那几秒(/balances 可能要等 8~10s)打开面板 → 显示默认 50/10 →
            // 用户一点"保存并生效"就把自己存的阈值覆盖掉了。补上。
            safeThreshold: runtimeConfig.safeThreshold,
            warnThreshold: runtimeConfig.warnThreshold,
            overseasCurrency: runtimeConfig.overseasCurrency,
            whaleEnabled: !!runtimeConfig.whaleEnabled,
            showNoBalanceBrands: !!runtimeConfig.showNoBalanceBrands,
            officialProviders: runtimeConfig.officialProviders,
            // 只读: 供设置面板显示「自动判定结果」, 让用户知道哪些还需要手填
            providerKinds: readProviderKinds(),
            // v1.4.0「真自动」: 从 settings.yaml 自动发现的 provider 及启用状态 (不含 key)
            dshProviders: readDshProviderStatus(),
            dshProviderOptOut: runtimeConfig.dshProviderOptOut,
            version: PLUGIN_VERSION,
            preview: IS_PREVIEW,
          })
          return
        }
        if (req.method === 'POST') {
          try {
            let body = await readBody(req)
            body = body ? JSON.parse(body) : {}
            // 数组规模上限: 状态文件与每次轮询都要带它们, 防垃圾数据无限膨胀
            const MAX_ITEMS = 64
            const cleanId = (v) => cleanStr(v, 64).replace(/[^a-zA-Z0-9_-]/g, '')
            const cleanQueryType = (v) => { const s = cleanStr(v, 32); return /^[a-zA-Z0-9_-]+$/.test(s) ? s : 'auto' }
            if (Array.isArray(body.customRelays)) {
              runtimeConfig.customRelays = body.customRelays.slice(0, MAX_ITEMS).map(r => {
                const prev = runtimeConfig.customRelays.find(x => x.id === r.id)
                const rk = cleanStr(r.apiKey, 256)   // '***' / 空 = 保留旧 key (掩码回填约定)
                return {
                  id: cleanId(r.id) || Math.random().toString(36).slice(2), name: cleanStr(r.name, 128) || '中转站',
                  baseUrl: cleanUrl(r.baseUrl).replace(/\/+$/, ''), apiKey: (rk && rk !== '***') ? rk : (prev?.apiKey || ''), queryType: cleanQueryType(r.queryType),
                }
              })
            }
            if (Array.isArray(body.customModels)) {
              runtimeConfig.customModels = body.customModels.slice(0, MAX_ITEMS).map(m => {
                const prev = runtimeConfig.customModels.find(x => x.id === m.id)
                const mk = cleanStr(m.apiKey, 256)
                return {
                  id: cleanId(m.id) || Math.random().toString(36).slice(2), name: cleanStr(m.name, 128) || '自定义模型',
                  apiUrl: cleanUrl(m.apiUrl), apiKey: mk !== '***' && mk !== '' ? mk : (prev?.apiKey || ''),
                  queryType: cleanQueryType(m.queryType), totalPath: cleanStr(m.totalPath, 128), usedPath: cleanStr(m.usedPath, 128),
                  currency: cleanStr(m.currency, 8) || 'CNY',
                }
              })
            }
            // 自定义刷新时间 (1~60 秒; v1.4.0 下限由 5 秒放宽到 1 秒)
            if (typeof body.refreshIntervalSec === 'number' && Number.isFinite(body.refreshIntervalSec)) {
              const sec = clampRefreshSec(body.refreshIntervalSec)
              runtimeConfig.refreshIntervalMs = sec * 1000
              runtimeConfig.clientPollIntervalMs = sec * 1000
            }
            // 更新安全阈值
            if (typeof body.safeThreshold === 'number' && body.safeThreshold >= 0) runtimeConfig.safeThreshold = body.safeThreshold
            if (typeof body.warnThreshold === 'number' && body.warnThreshold >= 0) runtimeConfig.warnThreshold = body.warnThreshold
            if (typeof body.currency === 'string' && body.currency.trim()) runtimeConfig.currency = body.currency.trim().toUpperCase()
            // v1.3.2: 海外模型独立计价货币, 只接受白名单三值 (脏值一律落回 follow, 不放行任意字符串)
            if (typeof body.overseasCurrency === 'string') {
              const v = body.overseasCurrency.trim().toLowerCase()
              runtimeConfig.overseasCurrency = v === 'usd' ? 'USD' : v === 'cny' ? 'CNY' : 'follow'
            }
            // v1.1.0: 收养大肥鱼开关
            if (typeof body.whaleEnabled === 'boolean') runtimeConfig.whaleEnabled = body.whaleEnabled
            // 显示无余额模型品牌
            if (typeof body.showNoBalanceBrands === 'boolean') runtimeConfig.showNoBalanceBrands = body.showNoBalanceBrands
            // 官方直连 provider 名单 (第 1 层判定); 接受数组或逗号/换行分隔的字符串
            if (Array.isArray(body.officialProviders) || typeof body.officialProviders === 'string') {
              runtimeConfig.officialProviders = normalizeOfficialProviders(body.officialProviders)
            }
            // v1.4.0「真自动」: 被关掉的 DSH provider 名单 (默认空 = 全部启用)
            if (Array.isArray(body.dshProviderOptOut) || typeof body.dshProviderOptOut === 'string') {
              runtimeConfig.dshProviderOptOut = normalizeOfficialProviders(body.dshProviderOptOut)
            }
            // 持久化: 写入状态文件, 重启后恢复 (用户配置优先)
            savePersistedState({
              refreshIntervalMs: runtimeConfig.refreshIntervalMs,
              clientPollIntervalMs: runtimeConfig.clientPollIntervalMs,
              timeoutMs: runtimeConfig.timeoutMs,
              customRelays: runtimeConfig.customRelays,
              customModels: runtimeConfig.customModels,
              currency: runtimeConfig.currency,
              overseasCurrency: runtimeConfig.overseasCurrency,
              safeThreshold: runtimeConfig.safeThreshold,
              warnThreshold: runtimeConfig.warnThreshold,
              whaleEnabled: runtimeConfig.whaleEnabled,
              showNoBalanceBrands: runtimeConfig.showNoBalanceBrands,
              officialProviders: runtimeConfig.officialProviders,
              dshProviderOptOut: runtimeConfig.dshProviderOptOut,
            })
            resetLoop(); await refreshAll()
            sendJson(res, 200, {
              ok: true,
              customRelays: runtimeConfig.customRelays.map(r => ({ ...r, apiKey: r.apiKey ? '***' : '' })),
              customModels: runtimeConfig.customModels.map(m => ({ ...m, apiKey: m.apiKey ? '***' : '' })),
              refreshIntervalSec: Math.round(runtimeConfig.refreshIntervalMs / 1000),
              currency: runtimeConfig.currency,
              overseasCurrency: runtimeConfig.overseasCurrency,
              whaleEnabled: !!runtimeConfig.whaleEnabled,
              showNoBalanceBrands: !!runtimeConfig.showNoBalanceBrands,
              officialProviders: runtimeConfig.officialProviders,
              providerKinds: readProviderKinds(),
              dshProviders: readDshProviderStatus(),
              dshProviderOptOut: runtimeConfig.dshProviderOptOut,
              version: PLUGIN_VERSION,
              preview: IS_PREVIEW,
            })
          } catch (err) {
            const code = err && err.statusCode === 413 ? 413 : 400
            sendJson(res, code, { ok: false, error: err instanceof Error ? err.message : String(err) })
          }
          return
        }
        res.writeHead(405, { Allow: 'GET, POST' })
        res.end()
      },
    }), 'dsh-api-dashboard: config route')
  })

  // 会话消耗投影
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    // v1.4.0: 把 session 存储与投影注册表惰性交给投影, 用于汇总子代理消耗。
    // 惰性 (每次读取时才 get) 是为了不把服务解析绑死在注册时刻 —— 服务可能后挂载。
    const services = () => {
      let sessions = null
      try { sessions = ctx.get('sessions') ?? projectionCtx.get('sessions') ?? null } catch { sessions = null }
      return { sessions, projections: projectionCtx.sessionProjections }
    }
    projectionCtx.sessionProjections.register(makeCostProjection(getConfig, services))
  })
}