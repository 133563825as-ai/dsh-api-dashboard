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

import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync, mkdirSync, rmSync, cpSync, statSync, readdirSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join, dirname, basename } from 'node:path'

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
const SELF_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 读取指定目录中 package.json 的 version, 异常返回 null */
const readVersionAt = (dir) => {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' && /^\d+\.\d+\.\d+/.test(pkg.version) ? pkg.version : null
  } catch { return null }
}

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
      if (legacyReal && selfReal && legacyReal !== selfReal && existsSync(join(legacyReal, 'package.json'))) {
        dirs.push(legacyReal)
      }
    } catch { /* 探测失败不影响主流程 */ }
  }
  for (const dir of dirs) {
    if (!existsSync(join(dir, 'package.json'))) throw new Error(`target missing: ${dir}`)
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
      const keep = new Set(['node_modules'])
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

const loadPersistedState = () => {
  try {
    const raw = readFileSync(STATE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

const savePersistedState = (state) => {
  try {
    const merged = { ...loadPersistedState(), ...state }
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
 * 手写最小缩进解析器: 从 settings.yaml 文本里抓 `llm-pi-ai.providers.<name>.baseURL`。
 * 刻意不引 yaml 依赖 —— package.json 的 dependencies 保持为空 (只有 4 个可选 peerDeps),
 * 引依赖会破坏零依赖安装。只认这一条路径, 别的 YAML 语法一概不管。
 * @param {string} text settings.yaml 全文
 * @returns {Record<string,string>} { providerName: baseURL }
 */
export function parseProviderBaseURLs(text) {
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
    if (kv.key === 'baseURL' || kv.key === 'baseUrl') {
      const value = cleanValue(kv.value)
      if (value !== '') out[current] = value
    }
  }
  return out
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
let providerKindsCache = { mtimeMs: -1, kinds: {} }

/** 读 settings.yaml 算第 2 层判定, 按 mtime 缓存 (轮询每 5s 一次, 别每次都解析) */
const readProviderKinds = () => {
  try {
    const mtimeMs = statSync(SETTINGS_FILE).mtimeMs
    if (mtimeMs === providerKindsCache.mtimeMs) return providerKindsCache.kinds
    const kinds = computeProviderKinds(readFileSync(SETTINGS_FILE, 'utf8'))
    providerKindsCache = { mtimeMs, kinds }
    return kinds
  } catch {
    // settings.yaml 不存在/读不动: 不表态, 全交给第 1、3 层
    providerKindsCache = { mtimeMs: -1, kinds: {} }
    return providerKindsCache.kinds
  }
}

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
export const V4_RATES = {
  CNY: {
    peak: { 'deepseek-v4-flash': { cacheHit: 0.1, cacheMiss: 3, output: 9 }, 'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 } },
    offPeak: { 'deepseek-v4-flash': { cacheHit: 0.05, cacheMiss: 1.5, output: 4.5 }, 'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 } },
  },
  USD: {
    peak: { 'deepseek-v4-flash': { cacheHit: 0.014, cacheMiss: 0.44, output: 1.32 }, 'deepseek-v4-pro': { cacheHit: 0.044, cacheMiss: 1.32, output: 3.96 } },
    offPeak: { 'deepseek-v4-flash': { cacheHit: 0.007, cacheMiss: 0.22, output: 0.66 }, 'deepseek-v4-pro': { cacheHit: 0.022, cacheMiss: 0.66, output: 1.98 } },
  },
}

/** 通用表 USD → CNY 换算汇率 (与 V4_RATES.USD 表的 ~7 汇率一致) */
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
// 通用模型价格表 — 每百万token, **统一存 USD 基准**。
// resolveModelPrice 返回时会按用户「计价货币」换算: 选 CNY 则 ×7, 选 USD 原样。
// (CNY 官方价的 StepFun/MiMo/Qwen3.8-max 入库前已 ÷7 换算回 USD, 注释里标了原 CNY 价。)
// ⚠️ DeepSeek 计费请走上面 V4_RATES 峰谷表(自带 CNY/USD 两套, 官方价, 准确); 本通用表覆盖 OpenAI/Claude/Gemini/国产等。
// 来源: ① 现役主力(2026-08) 来自 NousResearch hermes-agent usage_pricing.py(追踪各官方文档, 逐条注明 source_url);
//       ② 旧模型(2025-08) 为历史参考价. 仅做参考, 实际以平台为准.
// ============================================================
export const MODEL_PRICES = {
  // —— 现役主力 (2026-09-03 更新; 统一 USD/百万tokens) ——
  // 来源: ① model_pricing_2026_09.json (USD) + StepFun/MiMo/Qwen3.8 官方页 (CNY, 已 ÷7 换算并标注)
  //       ② v1.2.0 补充: modelradar.cn/data/models.json 2026-09-03 快照 (各模型 sourceUrl 均指官方定价页)。
  //          仅采纳与官方口径无分歧的条目; 与原表冲突时保留原值并注明 ——
  //          radar 的 GPT-5.6 系输出价全呈「输入×1.25」异常模式, 疑似抓错列, 未采纳;
  //          促销价 (qwen3.7-max 5折等) radar 不跟踪, 保留原促销值。
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
  // —— 国产主力 (2026-09) ——
  // 阿里云百炼 Qwen3
  'qwen3.8-max':          { cacheHit: 1.71,  cacheMiss: 1.71,  output: 5.14 },  // 100万token/90天免费额度, 超出按 ¥12/¥36 (÷7); 夜间22:00-08:00五折未实现
  'qwen3.7-max':          { cacheHit: 0.83,  cacheMiss: 0.83,  output: 2.48 },  // 5折促销, 无缓存折扣
  'qwen3.7-plus':         { cacheHit: 0.55,  cacheMiss: 0.55,  output: 1.65 },  // 无缓存折扣
  'qwen3.7-flash':        { cacheHit: 0.03,  cacheMiss: 0.03,  output: 0.13 },  // 0-32k 最优价
  'qwen3.8-flash':        { cacheHit: 0.011, cacheMiss: 0.11,  output: 0.372 }, // radar 2026-09-03 (官方页 CNY ÷7), 1M ctx
  'qwen3.8-27b':          { cacheHit: 0.05,  cacheMiss: 0.503, output: 3.017 }, // radar (CNY ÷7)
  'qwen3.6-plus':         { cacheHit: 0.028, cacheMiss: 0.276, output: 1.655 }, // radar (CNY ÷7), 256K ctx
  // 智谱 GLM-5
  'glm-5.2':              { cacheHit: 0.26,  cacheMiss: 1.4,   output: 4.4 },
  'glm-5-turbo':          { cacheHit: 0.24,  cacheMiss: 1.2,   output: 4.0 },
  'glm-5.3-flash':        { cacheHit: 0.03,  cacheMiss: 0.15,  output: 0.5 },   // v1.2.3 修正缓存读价: GLM 系缓存读=输入×20% (与 glm-5.2 0.26/1.4、glm-5-turbo 0.24/1.2 口径一致; 原误标"无缓存折扣"致长会话消耗虚高 5 倍)
  // Kimi
  'kimi-k3':              { cacheHit: 0.3,   cacheMiss: 3.0,   output: 15.0 },  // 缓存价已修正
  'kimi-k2.6':            { cacheHit: 0.152, cacheMiss: 0.897, output: 3.724 }, // radar 2026-09-03, 262K ctx (官方页 CNY ÷7)
  'kimi-k2.5':            { cacheHit: 0.097, cacheMiss: 0.552, output: 2.897 }, // radar, 262K ctx
  // 字节豆包 Seed 2.0 (radar 2026-09-03, 火山方舟官方页; 计费随上下文档位不同, 前缀匹配按最长命中)
  'doubao-seed-2.0-pro-32k':   { cacheHit: 0.088, cacheMiss: 0.441, output: 2.207 },
  'doubao-seed-2.0-pro-128k':  { cacheHit: 0.132, cacheMiss: 0.662, output: 3.31 },
  'doubao-seed-2.0-pro-256k':  { cacheHit: 0.265, cacheMiss: 1.324, output: 6.621 },
  'doubao-seed-2.0-lite-32k':  { cacheHit: 0.017, cacheMiss: 0.083, output: 0.497 },
  'doubao-seed-2.0-lite-128k': { cacheHit: 0.025, cacheMiss: 0.124, output: 0.745 },
  'doubao-seed-2.0-lite-256k': { cacheHit: 0.05,  cacheMiss: 0.248, output: 1.49 },
  'doubao-seed-2.0-mini-32k':  { cacheHit: 0.006, cacheMiss: 0.028, output: 0.276 },
  'doubao-seed-2.0-mini-128k': { cacheHit: 0.011, cacheMiss: 0.055, output: 0.552 },
  'doubao-seed-2.0-mini-256k': { cacheHit: 0.022, cacheMiss: 0.11,  output: 1.103 },
  'doubao-seed-2.0-code-32k':  { cacheHit: 0.088, cacheMiss: 0.441, output: 2.207 },
  'doubao-seed-2.0-code-128k': { cacheHit: 0.132, cacheMiss: 0.662, output: 3.31 },
  'doubao-seed-2.0-code-256k': { cacheHit: 0.265, cacheMiss: 1.324, output: 6.621 },
  // 腾讯混元 (radar 2026-09-03, cloud.tencent.com 官方页; 无缓存价 → cacheHit=cacheMiss)
  'hunyuan-2.0-instruct-128k': { cacheHit: 0.621, cacheMiss: 0.621, output: 1.535 },
  'hunyuan-2.0-think-128k':    { cacheHit: 0.731, cacheMiss: 0.731, output: 2.924 },
  'hunyuan-turbo-s':           { cacheHit: 0.11,  cacheMiss: 0.11,  output: 0.276 },
  // 阶跃星辰 (官方页为 CNY, 已 ÷7 换 USD)
  'step-3.7-flash':       { cacheHit: 0.039, cacheMiss: 0.193, output: 1.157 },
  'step-3.5-flash':       { cacheHit: 0.02,  cacheMiss: 0.10,  output: 0.30 },
  // 小米 MiMo (官方页为 CNY ¥1/0.02/2 与 ¥3/0.025/6, 已 ÷7 换 USD)
  'mimo-v2.5':            { cacheHit: 0.0004, cacheMiss: 0.020, output: 0.041 },
  'mimo-v2.5-pro':        { cacheHit: 0.001,  cacheMiss: 0.061, output: 0.122 },
  // —— 以下为历史/参考模型 (2025-08, 实际以平台为准) ——
  'gpt-4o':               { cacheHit: 1.25,  cacheMiss: 2.5,  output: 10 },
  'gpt-4o-mini':          { cacheHit: 0.075, cacheMiss: 0.15, output: 0.6 },
  'gpt-4-turbo':          { cacheHit: 5,     cacheMiss: 10,   output: 30 },
  'gpt-4':                { cacheHit: 15,    cacheMiss: 30,   output: 60 },
  'o1':                   { cacheHit: 7.5,   cacheMiss: 15,   output: 60 },
  'o1-mini':              { cacheHit: 0.55,  cacheMiss: 1.1,  output: 4.4 },
  'o3-mini':              { cacheHit: 0.55,  cacheMiss: 1.1,  output: 4.4 },
  // Claude
  'claude-3-5-sonnet':    { cacheHit: 1.5,   cacheMiss: 3,    output: 15 },
  'claude-3-5-haiku':     { cacheHit: 0.4,   cacheMiss: 0.8,  output: 4 },
  'claude-3-opus':        { cacheHit: 7.5,   cacheMiss: 15,   output: 75 },
  // Gemini
  'gemini-2.0-flash':     { cacheHit: 0.05,  cacheMiss: 0.1,  output: 0.4 },
  'gemini-2.0-pro':       { cacheHit: 1.25,  cacheMiss: 2.5,  output: 10 },
  'gemini-1.5-pro':       { cacheHit: 1.75,  cacheMiss: 3.5,  output: 10.5 },
  // DeepSeek (标准价兜底) — ⚠️ 2026-07-24 起 deepseek-chat / deepseek-reasoner / deepseek-r1 已 RETIRED,
  // 官方 API 调用会直接报错(不再重定向到 V4)。现役仅 deepseek-v4-flash / deepseek-v4-pro / deepseek-v4-flash-vision-exp。
  // 保留这三条仅作为「若仍在用的旧配置」的估算占位, 真实计费请走上面 V4 峰谷表。
  'deepseek-chat':        { cacheHit: 0.1,   cacheMiss: 1,    output: 2 },
  'deepseek-reasoner':    { cacheHit: 0.2,   cacheMiss: 2,    output: 8 },
  'deepseek-r1':          { cacheHit: 0.2,   cacheMiss: 2,    output: 8 },
  // 智谱
  'glm-4-plus':           { cacheHit: 2.5,   cacheMiss: 5,    output: 5 },
  'glm-4-flash':          { cacheHit: 0.05,  cacheMiss: 0.1,  output: 0.1 },
  // 通义千问
  'qwen-plus':            { cacheHit: 0.4,   cacheMiss: 0.8,  output: 2 },
  'qwen-max':             { cacheHit: 10,    cacheMiss: 20,   output: 60 },
  'qwen-turbo':           { cacheHit: 0.15,  cacheMiss: 0.3,  output: 0.6 },
  'qwen2.5-72b-instruct': { cacheHit: 2,     cacheMiss: 4,    output: 12 },
  // Kimi
  'moonshot-v1-8k':       { cacheHit: 0.6,   cacheMiss: 1.2,  output: 2.4 },
  'moonshot-v1-32k':      { cacheHit: 1.2,   cacheMiss: 2.4,  output: 4.8 },
  'moonshot-v1-128k':     { cacheHit: 3,     cacheMiss: 6,    output: 12 },
  // 阶跃星辰
  'step-1-flash':         { cacheHit: 0.5,   cacheMiss: 1,    output: 2 },
  'step-1-8k':            { cacheHit: 2,     cacheMiss: 4,    output: 8 },
  'step-1-32k':           { cacheHit: 4,     cacheMiss: 8,    output: 15 },
  // 其他
  'mistral-large':        { cacheHit: 1.5,   cacheMiss: 3,    output: 9 },
  'groq-llama-3.3-70b':  { cacheHit: 0.29,  cacheMiss: 0.59, output: 0.79 },
  'openrouter-auto':      { cacheHit: 0.5,   cacheMiss: 1,    output: 2 },
}

/** 解析模型单价, 仅 deepseek-v4-* 支持峰谷自动切换; chat/reasoner 等走通用价格表 */
export const resolveModelPrice = (configOrGetter, model, timestamp = Date.now()) => {
  const config = typeof configOrGetter === 'function' ? configOrGetter() : configOrGetter
  const peak = isPeakTime(timestamp)
  const isUsd = (config?.currency ?? 'CNY').toUpperCase() === 'USD'
  // MODEL_PRICES 与 defaultPrices 都存 USD 基准; 用户计价货币非 USD 时 ×7 换算, 与 V4_RATES 两套表口径一致
  const toCurrency = (price) => (isUsd ? price : { cacheHit: price.cacheHit * USD_TO_CNY_RATE, cacheMiss: price.cacheMiss * USD_TO_CNY_RATE, output: price.output * USD_TO_CNY_RATE })

  // 自定义价格优先 (用户自填, 币种由用户自己把握, 不做换算)
  if (config?.prices && Object.prototype.hasOwnProperty.call(config.prices, model) && config.prices[model]) {
    return config.prices[model]
  }

  // v0.5.3 修复: 原 startsWith('deepseek') 会把 deepseek-chat/reasoner 劫持进 V4 峰谷表,
  // 导致其按 v4-flash 价格计费 (output 虚高至 4.5 倍)。仅精确匹配 v4 系列。
  // DeepSeek v4 走 V4_RATES 峰谷表 (自带 CNY/USD 两套, 按 currency 选表; 兜底 defaultPrices 也按 USD 基准换算)
  if (model === 'deepseek-v4-pro' || model === 'deepseek-v4-flash' || model.startsWith('deepseek-v4')) {
    const table = V4_RATES[isUsd ? 'USD' : 'CNY'] ?? V4_RATES.CNY
    const key = model === 'deepseek-v4-pro' || model.startsWith('deepseek-v4-pro') ? 'deepseek-v4-pro' : 'deepseek-v4-flash'
    return (peak ? table.peak[key] : table.offPeak[key]) ?? toCurrency(config?.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 })
  }

  // 查询 MODEL_PRICES 表兜底 (优先匹配完整模型名, 再试前缀匹配; 单向最长前缀, 避免短输入 "g" 命中长键 "gpt-5.6-sol")
  const exact = MODEL_PRICES[model]
  if (exact) return toCurrency(exact)
  const prefix = Object.keys(MODEL_PRICES).filter(k => model.startsWith(k)).sort((a, b) => b.length - a.length)[0]
  if (prefix) return toCurrency(MODEL_PRICES[prefix])
  return toCurrency(config?.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 })
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
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) throw Object.assign(new Error('request body too large'), { statusCode: 413 })
  }
  return body
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
export function parseResponse(queryType, json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  switch (queryType) {
    case 'deepseek': {
      const infos = Array.isArray(json?.balance_infos) ? json.balance_infos : []
      const p = infos[0]
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
      const total = toAmount(json?.total_granted)
      const used = toAmount(json?.total_used)
      const hasAvail = json?.total_available != null
      const available = hasAvail ? toAmount(json.total_available) : null
      return { total: hasAvail ? available : (total - used), currency: 'USD', available, used, note: 'OpenAI 兼容额度' }
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
      // 若两个预期字段都缺失 → 视为解析失败(返回 null, 前端标"无法解析/未开放"), 绝不显示假"余额0"。
      if (d.total_credits == null && d.total_usage == null) return null
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
      // 兜底: 只有 percentage 无 remaining → 限流填充度(非余额)
      if (limits.length > 0) {
        const p = pctOf(limits[0])
        if (p !== null) return { total: p, currency: '%', available: null, used: null, percent: null, note: '智谱限流填充度%(非余额)', resetAt: limits[0]?.nextResetTime ?? null }
      }
      return null
    }

    case 'kimi': {
      const u = json?.usage
      if (!u) return null
      if (u.limit == null && u.remaining == null) return null
      const limit = toAmount(u.limit), remaining = toAmount(u.remaining)
      return { total: limit, currency: 'tokens', available: remaining, used: limit - remaining, note: 'Kimi 套餐剩余 tokens', percent: limit > 0 ? (remaining / limit) * 100 : null }
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
    const parsed = parseResponse(queryType, json)

    if (!parsed) {
      // v1.2.4: 业务层错误优先透传 —— 接口 HTTP 200 但 success:false / code!=200 时(实测智谱套餐过期返回
      // {"code":500,"msg":"当前用户不存在coding plan","success":false}), 笼统报"无法解析"会误导用户往解析坏
      // 的方向排查; 原始 msg 才是真实原因(套餐没了/无权限), 透传给用户。JSON 解析失败(json=null)仍走原文案。
      const bizMsg = (json && typeof json === 'object' && typeof json.msg === 'string' && json.msg
        && (json.success === false || (json.code !== undefined && json.code !== 200))) ? json.msg : null
      // v1.2.5: 智谱按量付费账户无公开余额接口(实测 2026-09-03: /api/monitor/account/balance、
      // /api/paas/v4/dashboard/billing/* 等候选端点全 404) —— 仅 Coding Plan 套餐可查配额。
      // 识别"不存在coding plan"后按「未开放」中性展示, 不再标红报错吓用户。
      if (queryType === 'glm' && bizMsg && /coding\s*plan/i.test(bizMsg)) {
        return {
          platform: platform.id, name: platform.label, icon: platform.icon, color: platform.color,
          category: platform.category, status: 'no-balance-api',
          error: '按量付费账户未开放余额查询 (仅 Coding Plan 套餐可查配额)', noBalance: true,
        }
      }
      return {
        platform: platform.id, name: platform.label, icon: platform.icon, color: platform.color,
        category: platform.category, status: 'parse-error',
        error: bizMsg ? `无法解析余额数据 (接口返回: ${bizMsg})` : '无法解析余额数据', noBalance: true,
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
  if (!apiKey) {
    return { platform: id, name: name || '中转站', icon: 'relay', color: '#64748B', category: '中转站', status: 'no-key', error: '未配置 API Key', noBalance: true }
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

  for (const cand of candidates) {
    const headers = { Accept: 'application/json', Authorization: `Bearer ${apiKey}` }
    const method = cand.type === 'quota' ? 'POST' : 'GET'
    try {
      const res = await fetchWithTimeout(base + cand.path, headers, config.timeoutMs || 8000, method)
      if (!res.ok) continue
      const text = await res.text()
      let json
      try { json = JSON.parse(text) } catch { continue }
      const parsed = parseResponse(cand.type, json)
      if (parsed) {
        return {
          platform: id, name: name || '中转站', icon: 'relay', color: '#64748B', category: '中转站',
          status: 'ok', total: parsed.total, currency: parsed.currency, available: parsed.available,
          used: parsed.used, note: parsed.note || cand.type, percent: parsed.percent,
          noBalance: false, queryType: cand.type, fetchedAt: Date.now(),
        }
      }
    } catch { /* 尝试下一个 */ }
  }

  return {
    platform: id, name: name || '中转站', icon: 'relay', color: '#64748B', category: '中转站',
    status: 'no-balance-api', error: '该平台未开放余额查询', noBalance: true,
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
      const parsed = parseResponse(queryType, json)
      if (parsed) {
        return { ...base, status: 'ok', total: parsed.total, currency: parsed.currency, available: parsed.available, used: parsed.used, note: parsed.note, percent: parsed.percent, noBalance: false, queryType, fetchedAt: Date.now() }
      }
    } else {
      // 3) auto: 尝试常见格式
      for (const qt of ['openai', 'quota', 'deepseek', 'openai-billing']) {
        const parsed = parseResponse(qt, json)
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
export function makeCostProjection(configOrGetter) {
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
    }),
    init: () => ({ currentModel: null, currentProvider: null, last: null, byModel: {}, modelOrder: [] }),
    apply: (state, event) => {
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
      if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
        ({ turn, step } = event.data); usage = event.data.chunk.usage
      } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
        ({ turn, step, usage } = event.data)
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
        tokens: z.object({ uncachedInput: z.number().int().nonnegative(), cacheRead: z.number().int().nonnegative(), cacheWrite: z.number().int().nonnegative(), output: z.number().int().nonnegative() }).strict(),
        tokensByModel: z.record(z.string(), z.object({ uncachedInputTokens: z.number().int().nonnegative(), cacheReadTokens: z.number().int().nonnegative(), cacheWriteTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() }).strict()).optional(),
        currency: z.string(),
        isPeak: z.boolean().optional(),
        waiting: z.boolean().optional(),
      }).strict(),
      view: (state) => {
      const cfg = getConfig()
      // 无事件时返回 waiting 标记, 客户端据此显示 "~—" 而非 "~¥0"
      if (state.modelOrder.length === 0) {
        return { models: [], currentModel: state.currentModel ?? null, currentProvider: state.currentProvider ?? null, cost: -1, costByModel: {}, tokens: { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, tokensByModel: {}, currency: cfg.currency ?? 'CNY', isPeak: isPeakTime(), waiting: true }
      }
      const tokens = { uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }
      const costByModel = {}
      let cost = 0
      const defaultPrice = cfg.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 }
      const peak = isPeakTime()
      for (const model of state.modelOrder) {
        const b = state.byModel[model] ?? zero()
        tokens.uncachedInput += b.uncachedInputTokens
        tokens.cacheRead += b.cacheReadTokens
        tokens.cacheWrite += b.cacheWriteTokens
        tokens.output += b.outputTokens
        // 支持 DeepSeek 谷峰自动计费
        const price = resolveModelPrice(cfg, model)
        const c = ((b.uncachedInputTokens + b.cacheWriteTokens) * price.cacheMiss + b.cacheReadTokens * price.cacheHit + b.outputTokens * price.output) / 1e6
        if (c > 0) costByModel[model] = round6(c)
        cost += c
      }
      return { models: state.modelOrder, currentModel: state.currentModel ?? null, currentProvider: state.currentProvider ?? null, cost: round6(cost), costByModel, tokens, tokensByModel: state.byModel, currency: cfg.currency ?? 'CNY', isPeak: peak, waiting: false }
      },
    },
    stateVersion: 1,
  }
}

// ============================================================
// 插件主体
// ============================================================
export function apply(ctx, config) {
  // 用户保存的配置优先于 cordis.patch.yml 的默认 config (持久化状态)
  const persisted = loadPersistedState()
  const runtimeConfig = {
    refreshIntervalMs: persisted.refreshIntervalMs ?? config.refreshIntervalMs ?? 5000,
    clientPollIntervalMs: persisted.clientPollIntervalMs ?? config.clientPollIntervalMs ?? 5000,
    timeoutMs: persisted.timeoutMs ?? config.timeoutMs ?? 8000,
    presets: config.presets ?? PLATFORM_PRESETS.map(p => p.id),
    customRelays: (persisted.customRelays ?? config.customRelays ?? []).map(r => ({ ...r })),
    customModels: (persisted.customModels ?? config.customModels ?? []).map(m => ({ ...m })),
    prices: config.prices ?? { 'deepseek-chat': { cacheHit: 0.1, cacheMiss: 1, output: 2 } },
    defaultPrices: config.defaultPrices ?? { cacheHit: 0.1, cacheMiss: 1, output: 2 },
    currency: persisted.currency ?? config.currency ?? 'CNY',
    safeThreshold: persisted.safeThreshold ?? config.safeThreshold ?? 50,
    warnThreshold: persisted.warnThreshold ?? config.warnThreshold ?? 10,
    whaleEnabled: persisted.whaleEnabled ?? config.whaleEnabled ?? false,
    showNoBalanceBrands: persisted.showNoBalanceBrands ?? config.showNoBalanceBrands ?? false,
    officialProviders: normalizeOfficialProviders(persisted.officialProviders ?? config.officialProviders ?? []),
    whaleSettings: {
      scale: 1, soundOn: true, soundSet: 'duck', volume: 0.5, bubbleOn: true,
      peakMode: 'default', snapOn: true, peekRatio: 0.5, left: null, top: null, side: 'right',
      ...(config.whaleSettings ?? {}),
      ...(persisted.whaleSettings ?? {}),
    },
  }

  const getConfig = () => runtimeConfig

  /** 解析预设平台的 API key (从环境变量、credentials 系统或直接读凭据文件) */
  const resolvePresetKey = async (platform) => {
    // 1) 环境变量
    for (const name of platform.envKeys || []) {
      if (process.env[name]) return process.env[name]
    }
    // 2) DSH credentials 服务
    const creds = ctx.get('credentials')
    if (creds !== undefined) {
      for (const ref of (platform.envKeys || [])) {
        try {
          const hit = await creds.resolve(ref)
          if (hit !== undefined) return hit.value
        } catch { /* 忽略 */ }
      }
    }
    // 3) 直接读 ~/.dsh/.credentials.yaml 文件兜底
    try {
      const { readFileSync } = await import('node:fs')
      const { homedir } = await import('node:os')
      const { join } = await import('node:path')
      const home = process.env.DSH_HOME || join(homedir(), '.dsh')
      const raw = readFileSync(join(home, '.credentials.yaml'), 'utf8')
      const lines = raw.split('\n')
      let inRefs = false
      for (const line of lines) {
        if (line === 'refs:') { inRefs = true; continue }
        if (inRefs) {
          if (!line.startsWith('  ')) { inRefs = false; continue }
          const idx = line.indexOf(':')
          if (idx === -1) continue
          const key = line.slice(0, idx).trim()
          const val = line.slice(idx + 1).trim()
          if (key && val && (platform.envKeys || []).includes(key)) return val
        }
      }
    } catch { /* 忽略 */ }
    return ''
  }

  let cache = { balances: [], fetchedAt: 0, error: null }
  let inflight = null

  const refreshAll = async () => {
    if (inflight !== null) return inflight
    inflight = (async () => {
      const presetList = PLATFORM_PRESETS.filter(p => runtimeConfig.presets.includes(p.id))
      const relayList = runtimeConfig.customRelays
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
          isPeak: isPeakTime(),
          isWeekend: isWeekend(),
          whaleEnabled: !!runtimeConfig.whaleEnabled,
          showNoBalanceBrands: !!runtimeConfig.showNoBalanceBrands,
          // provider 官方/中转判定素材下发给客户端 (第 1 层: 用户名单; 第 2 层: baseURL 域名判定)
          officialProviders: runtimeConfig.officialProviders,
          providerKinds: readProviderKinds(),
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

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/balances',
      async handler(req, res) {
        if (!['GET', 'HEAD', 'POST'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD, POST' }); res.end(); return }
        const force = req.method === 'POST' || new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('force') === '1'
        // 自动刷新: 缓存为空 或 缓存超过 refreshIntervalMs 时自动拉取最新 (解决进入页面要手动刷新)
        const stale = Date.now() - cache.fetchedAt > (runtimeConfig.refreshIntervalMs || 300000)
        if ((force || stale || cache.balances.length === 0) && (Date.now() - cache.fetchedAt > 2000 || cache.balances.length === 0)) await refreshAll()
        // v0.5.0: ETag 协商缓存 — 轮询期间数据没变就 304 空响应, 省 JSON 序列化与流量
        const etag = cache.etag || '"' + Number(cache.fetchedAt || 0).toString(36) + '"'
        if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ETag: etag }); res.end(); return }
        if (!force && req.headers['if-none-match'] === etag && cache.balances.length > 0) {
          res.writeHead(304, { ETag: etag })
          res.end()
          return
        }
        const body = JSON.stringify({ ok: true, balances: cache.balances, fetchedAt: cache.fetchedAt, config: cache.config })
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
        if (req.method !== 'GET') { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
        const cfg = runtimeConfig
        const cur = (cfg.currency ?? 'CNY').toUpperCase() === 'USD' ? 'USD' : 'CNY'
        const table = V4_RATES[cur] ?? V4_RATES.CNY
        const mk = (p) => p ? { cacheHit: p.cacheHit, cacheMiss: p.cacheMiss, output: p.output } : null
        // v4 峰谷系列
        const models = []
        for (const key of ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']) {
          // v4-flash-vision-exp 与 flash 同价 (vision 不加价), 复用 flash 费率
          const src = key === 'deepseek-v4-flash-vision-exp' ? 'deepseek-v4-flash' : key
          models.push({ model: key, peak: mk(table.peak[src]), offPeak: mk(table.offPeak[src]), peakValley: true })
        }
        sendJson(res, 200, { ok: true, currency: cfg.currency ?? 'CNY', peakNow: isPeakTime(), weekend: isWeekend(), models })
      },
    }), 'dsh-api-dashboard: prices route')

    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/platforms',
      async handler(req, res) {
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
        if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); res.end(); return }
        try {
          const result = await applyUpdate({})
          updateCache = { checkedAt: Date.now(), result: { ok: true, current: result.installed, remote: result.installed, hasUpdate: false, checkedAt: Date.now() } }
          sendJson(res, 200, { ok: true, installed: result.installed, targets: result.targets, backup: result.backup, needRestart: true })
        } catch (err) {
          const msg = /already up to date/.test(String(err?.message)) ? `already up to date`
            : /GitHub API|download|remote version/.test(String(err?.message)) ? 'network failed'
            : 'update failed'
          sendJson(res, 500, { ok: false, error: msg })
        }
      },
    }), 'dsh-api-dashboard: update install route')

    // v0.7.1: 插件图标 (哦鲸鲸)
    const ICON_PATH = join(SELF_ROOT, 'assets', 'icon.png')
    let iconCache = null
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact', path: '/api-dashboard/icon',
      async handler(req, res) {
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
        if (req.method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            customRelays: runtimeConfig.customRelays.map(r => ({ ...r, apiKey: r.apiKey ? '***' : '' })),
            customModels: runtimeConfig.customModels.map(m => ({ ...m, apiKey: m.apiKey ? '***' : '' })),
            presets: runtimeConfig.presets,
            refreshIntervalSec: Math.round(runtimeConfig.refreshIntervalMs / 1000),
            whaleEnabled: !!runtimeConfig.whaleEnabled,
            showNoBalanceBrands: !!runtimeConfig.showNoBalanceBrands,
            officialProviders: runtimeConfig.officialProviders,
            // 只读: 供设置面板显示「自动判定结果」, 让用户知道哪些还需要手填
            providerKinds: readProviderKinds(),
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
            // 自定义刷新时间 (5~60 秒, 最高一分钟)
            if (typeof body.refreshIntervalSec === 'number' && Number.isFinite(body.refreshIntervalSec)) {
              const sec = Math.min(Math.max(Math.round(body.refreshIntervalSec), 5), 60)
              runtimeConfig.refreshIntervalMs = sec * 1000
              runtimeConfig.clientPollIntervalMs = sec * 1000
            }
            // 更新安全阈值
            if (typeof body.safeThreshold === 'number' && body.safeThreshold >= 0) runtimeConfig.safeThreshold = body.safeThreshold
            if (typeof body.warnThreshold === 'number' && body.warnThreshold >= 0) runtimeConfig.warnThreshold = body.warnThreshold
            if (typeof body.currency === 'string' && body.currency.trim()) runtimeConfig.currency = body.currency.trim().toUpperCase()
            // v1.1.0: 收养大肥鱼开关
            if (typeof body.whaleEnabled === 'boolean') runtimeConfig.whaleEnabled = body.whaleEnabled
            // 显示无余额模型品牌
            if (typeof body.showNoBalanceBrands === 'boolean') runtimeConfig.showNoBalanceBrands = body.showNoBalanceBrands
            // 官方直连 provider 名单 (第 1 层判定); 接受数组或逗号/换行分隔的字符串
            if (Array.isArray(body.officialProviders) || typeof body.officialProviders === 'string') {
              runtimeConfig.officialProviders = normalizeOfficialProviders(body.officialProviders)
            }
            // 持久化: 写入状态文件, 重启后恢复 (用户配置优先)
            savePersistedState({
              refreshIntervalMs: runtimeConfig.refreshIntervalMs,
              clientPollIntervalMs: runtimeConfig.clientPollIntervalMs,
              timeoutMs: runtimeConfig.timeoutMs,
              customRelays: runtimeConfig.customRelays,
              customModels: runtimeConfig.customModels,
              currency: runtimeConfig.currency,
              safeThreshold: runtimeConfig.safeThreshold,
              warnThreshold: runtimeConfig.warnThreshold,
              whaleEnabled: runtimeConfig.whaleEnabled,
              showNoBalanceBrands: runtimeConfig.showNoBalanceBrands,
              officialProviders: runtimeConfig.officialProviders,
            })
            resetLoop(); await refreshAll()
            sendJson(res, 200, {
              ok: true,
              customRelays: runtimeConfig.customRelays.map(r => ({ ...r, apiKey: r.apiKey ? '***' : '' })),
              customModels: runtimeConfig.customModels.map(m => ({ ...m, apiKey: m.apiKey ? '***' : '' })),
              refreshIntervalSec: Math.round(runtimeConfig.refreshIntervalMs / 1000),
              whaleEnabled: !!runtimeConfig.whaleEnabled,
              showNoBalanceBrands: !!runtimeConfig.showNoBalanceBrands,
              officialProviders: runtimeConfig.officialProviders,
              providerKinds: readProviderKinds(),
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
    projectionCtx.sessionProjections.register(makeCostProjection(getConfig))
  })
}