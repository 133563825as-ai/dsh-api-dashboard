// v1.7.4+account-login: DeepSeek 官方账号登录（不是 API Key）也能显示余额。
//
// 依据宿主 `@deepseek-ai/dsh-deepseek-account-platform/lib/index.js`:
//   · 凭据 records["deepseek-account-platform/default"] = { kind:'grant', payload:{ token, issuer } }
//   · GET {issuer}/api/v0/users/get_user_summary
//     header `x-dsh-auth-token`（不是 Authorization: Bearer）
//   · envelope { code:0, data:{ biz_code:0, biz_data:{ normal_wallets, bonus_wallets } } }
//   · wallet { currency:'CNY'|'USD', balance:'<数值字符串>' }
//
// 这里只用注入的 fake fetch，绝不真联网；凭据文件用临时夹具，绝不读运行机器的 ~/.dsh。
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name) } }
const eq = (name, got, want) => a(name + ' (got ' + JSON.stringify(got) + ')', JSON.stringify(got) === JSON.stringify(want))

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PRESET = {
  id: 'deepseek', label: 'DeepSeek', icon: 'deepseek', color: '#4D6BFE', category: '国内',
  baseUrl: 'https://api.deepseek.com', queryType: 'deepseek', envKeys: [],
}
const OTHER = {
  id: 'moonshot', label: 'Kimi', icon: 'moonshot', color: '#000000', category: '国内',
  baseUrl: 'https://api.moonshot.cn', queryType: 'kimi', envKeys: [],
}
const ISSUER = 'https://platform.deepseek.com'
const TOKEN = 'acct-token-must-not-leak-7f3a9c'
const CONFIG = { currency: 'CNY', timeoutMs: 2000 }

/** 记录每次请求的 fake fetch。 */
const makeFetch = (handler) => {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {} })
    return handler(String(url), init)
  }
  fn.calls = calls
  return fn
}
const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})
const summary = (normalWallets, bonusWallets) => ({
  code: 0,
  data: { biz_code: 0, biz_data: { normal_wallets: normalWallets, bonus_wallets: bonusWallets } },
})
const keyBalanceBody = {
  is_available: true,
  balance_infos: [{ currency: 'CNY', total_balance: '42.00', granted_balance: '0.00', topped_up_balance: '42.00' }],
}

// ============================================================
// A. 优先级：有显式 API Key 时绝不走账号路径
// ============================================================
let accountReads = 0
const keyFetch = makeFetch(() => jsonRes(keyBalanceBody))
const keyResult = await m.queryPresetWithAccountFallback(PRESET, 'sk-explicit-key', CONFIG, {
  readAccount: async () => { accountReads++; throw new Error('account path must not run') },
  fetchImpl: keyFetch,
})
a('A1 有 API Key → ok', keyResult.status === 'ok' && keyResult.total === 42)
a('A2 有 API Key → 打的是 API Key 端点 /user/balance', keyFetch.calls.length === 1 && keyFetch.calls[0].url === 'https://api.deepseek.com/user/balance')
a('A3 有 API Key → 用 Authorization: Bearer', keyFetch.calls[0]?.headers?.Authorization === 'Bearer sk-explicit-key')
a('A4 有 API Key → 不带账号头', keyFetch.calls[0]?.headers?.['x-dsh-auth-token'] === undefined)
a('A5 有 API Key → readAccount 一次都没被调用', accountReads === 0)
a('A6 有 API Key → 来源不是账号（note 无「账号」字样）', !String(keyResult.note ?? '').includes('账号'))

// 非 DeepSeek 平台即使没 key，也不该去读账号凭据
let otherReads = 0
const otherResult = await m.queryPresetWithAccountFallback(OTHER, '', CONFIG, {
  readAccount: async () => { otherReads++; return { token: TOKEN, issuer: ISSUER } },
  fetchImpl: makeFetch(() => jsonRes({})),
})
a('A7 非 DeepSeek 无 key → no-key，且不读账号凭据', otherResult.status === 'no-key' && otherReads === 0)

// ============================================================
// B. 无 key + 有账号 token → 命中账号接口并正确解析
// ============================================================
const acctFetch = makeFetch(() => jsonRes(summary(
  [{ currency: 'CNY', balance: '10.50' }],
  [{ currency: 'CNY', balance: '1.25' }],
)))
const acct = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
  fetchImpl: acctFetch,
})
a('B1 账号路径 → ok', acct.status === 'ok')
eq('B2 充值 + 赠送 = 总余额', acct.total, 11.75)
eq('B3 充值额单独保留', acct.topup, 10.5)
eq('B4 赠送额单独保留', acct.grant, 1.25)
eq('B5 币种取主货币', acct.currency, 'CNY')
a('B6 note 标明来源「DeepSeek 账号余额」', acct.note === 'DeepSeek 账号余额')
a('B7 source=account（用户看得出不是 API Key 那条路）', acct.source === 'account')
a('B8 账号接口路径正确', acctFetch.calls[0]?.url === ISSUER + '/api/v0/users/get_user_summary')
a('B9 用 x-dsh-auth-token 头', acctFetch.calls[0]?.headers?.['x-dsh-auth-token'] === TOKEN)
a('B10 **没有** Authorization: Bearer', acctFetch.calls[0]?.headers?.Authorization === undefined)
a('B11 已用口径未知 → used 为 null（不拿充值额冒充）', acct.used === null)

// 钱包顺序不保证：USD 在前也应按主货币 CNY 选
const reordered = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
  fetchImpl: makeFetch(() => jsonRes(summary(
    [{ currency: 'USD', balance: '0.00' }, { currency: 'CNY', balance: '10.50' }],
    [{ currency: 'USD', balance: '0.00' }, { currency: 'CNY', balance: '1.25' }],
  ))),
})
eq('B12 钱包顺序翻转不影响结果（仍 CNY 11.75）', [reordered.total, reordered.currency], [11.75, 'CNY'])

const pickedUsd = await m.queryPresetWithAccountFallback(PRESET, '', { ...CONFIG, currency: 'USD' }, {
  readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
  fetchImpl: makeFetch(() => jsonRes(summary(
    [{ currency: 'CNY', balance: '10.50' }, { currency: 'USD', balance: '3.00' }],
    [{ currency: 'USD', balance: '0.50' }],
  ))),
})
eq('B13 主货币设为 USD → 取 USD 钱包', [pickedUsd.total, pickedUsd.currency], [3.5, 'USD'])

// 真 0 账户：结构合法就如实给 0，不返回 null
const zero = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
  fetchImpl: makeFetch(() => jsonRes(summary([{ currency: 'CNY', balance: '0.00' }], []))),
})
a('B14 全 0 账户如实给 0（真 0 ≠ 解析失败）', zero.status === 'ok' && zero.total === 0)

// ============================================================
// C. 账号 token 缺失 → no-key（既有语义）
// ============================================================
const noTokenFetch = makeFetch(() => jsonRes(summary([{ currency: 'CNY', balance: '1' }], [])))
const noToken = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => null,
  fetchImpl: noTokenFetch,
})
a('C1 无 key 且无账号 token → no-key', noToken.status === 'no-key')
a('C2 无 token 不发任何请求', noTokenFetch.calls.length === 0)
a('C3 no-key 不冒充余额（无 total）', noToken.total === undefined)

const readFailed = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => { throw new Error('credentials broken ' + TOKEN) },
  fetchImpl: makeFetch(() => jsonRes({})),
})
a('C4 读账号凭据抛错 → 中性 no-key，不崩', readFailed.status === 'no-key')

// 有 token 但缺 issuer → 中性 no-balance-api，不猜默认域名
const noIssuer = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => ({ token: TOKEN, issuer: '' }),
  fetchImpl: makeFetch(() => jsonRes({})),
})
a('C5 token 有、issuer 缺失 → no-balance-api（不猜域名）', noIssuer.status === 'no-balance-api' && noIssuer.total === undefined)

// ============================================================
// D. 账号接口 401 / 40003 → auth-error（中性，不静默）
// ============================================================
const unauthorized = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
  // 故意让响应体带 token：错误路径绝不能把它读出来拼进结果
  fetchImpl: makeFetch(() => jsonRes({ error: 'expired', echo: TOKEN }, 401)),
})
a('D1 401 → auth-error', unauthorized.status === 'auth-error')
a('D2 auth-error 无余额字段', unauthorized.total === undefined && unauthorized.noBalance === false)
a('D3 401 文案不包含 token', !String(unauthorized.error ?? '').includes(TOKEN))

const forbidden = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
  fetchImpl: makeFetch(() => jsonRes({}, 403)),
})
a('D4 403 → auth-error（与既有 key 路径口径一致）', forbidden.status === 'auth-error')

const bizExpired = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
  fetchImpl: makeFetch(() => jsonRes({ code: 40003, data: { biz_code: 40003 } })),
})
a('D5 业务码 40003 → auth-error（宿主同口径）', bizExpired.status === 'auth-error')

// ============================================================
// E. 返回结构异常 → 不冒充余额
// ============================================================
const cases = [
  ['E1 biz_data 空对象', { code: 0, data: { biz_code: 0, biz_data: {} } }],
  ['E2 缺 envelope（直接给钱包）', { normal_wallets: [{ currency: 'CNY', balance: '1' }], bonus_wallets: [] }],
  ['E3 biz_code 非 0', { code: 0, data: { biz_code: 1, biz_data: { normal_wallets: [{ currency: 'CNY', balance: '1' }], bonus_wallets: [] } } }],
  ['E4 normal_wallets 不是数组', { code: 0, data: { biz_code: 0, biz_data: { normal_wallets: 'x', bonus_wallets: [] } } }],
  ['E5 金额非法字符串', summary([{ currency: 'CNY', balance: 'abc' }], [])],
  ['E6 币种不在宿主枚举', summary([{ currency: 'EUR', balance: '1.00' }], [])],
  ['E7 两个钱包都空', summary([], [])],
  ['E8 钱包项为 null', summary([null], [])],
  ['E9 非 JSON body', 'not-json'],
]
for (const [name, body] of cases) {
  const r = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
    readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
    fetchImpl: makeFetch(() => jsonRes(body)),
  })
  a(name + ' → no-balance-api，不冒充余额', r.status === 'no-balance-api' && r.total === undefined)
}

// HTTP 404/405 → no-balance-api；其他状态 → error
const notFound = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
  fetchImpl: makeFetch(() => jsonRes('nope', 404)),
})
a('E10 404 → no-balance-api', notFound.status === 'no-balance-api')

const serverError = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
  fetchImpl: makeFetch(() => jsonRes('boom ' + TOKEN, 500)),
})
a('E11 500 → error，不冒充余额', serverError.status === 'error' && serverError.total === undefined)

const network = await m.queryPresetWithAccountFallback(PRESET, '', CONFIG, {
  readAccount: async () => ({ token: TOKEN, issuer: ISSUER }),
  fetchImpl: async () => { throw new Error('connection reset by peer ' + TOKEN) },
})
a('E12 网络异常 → error，错误文案不含 token', network.status === 'error' && !String(network.error).includes(TOKEN))

// ============================================================
// F. token 不泄露：扫描所有返回对象与错误文案
// ============================================================
const allResults = [
  keyResult, otherResult, acct, reordered, pickedUsd, zero, noToken, readFailed, noIssuer,
  unauthorized, forbidden, bizExpired, notFound, serverError, network,
]
a('F1 所有返回对象序列化后都不含 token', !JSON.stringify(allResults).includes(TOKEN))
a('F2 所有 error 字段都不含 token', !allResults.map((r) => String(r?.error ?? '')).join('|').includes(TOKEN))

// ============================================================
// G. 凭据文件解析（临时夹具，结构对齐宿主 records 段）
// ============================================================
const credentialsText = [
  'version: 1',
  'records:',
  '  client-connection/browser-session:',
  '    kind: grant',
  '    payload:',
  '      version: 1',
  '      secret: unrelated-secret',
  '  deepseek-account-platform/default:',
  '    kind: grant',
  '    payload:',
  '      version: 1',
  '      token: ' + TOKEN,
  '      issuer: ' + ISSUER,
  '  deepseek-account-platform/device:',
  '    kind: grant',
  '    payload:',
  '      id: device-id',
  '',
].join('\n')

const parsed = m.parseAccountGrantText(credentialsText)
a('G1 从 records 段读出 token', parsed?.token === TOKEN)
a('G2 读出 issuer', parsed?.issuer === ISSUER)
a('G3 不误读相邻 record 的 secret', !JSON.stringify(parsed ?? {}).includes('unrelated-secret'))

const wrongKind = m.parseAccountGrantText([
  'records:',
  '  deepseek-account-platform/default:',
  '    kind: api-key',
  '    payload:',
  '      token: ' + TOKEN,
  '',
].join('\n'))
a('G4 kind 不是 grant → null', wrongKind === null)

const missing = m.parseAccountGrantText('version: 1\nrecords:\n  other/default:\n    kind: grant\n')
a('G5 没有该 record → null', missing === null)

const badYaml = m.parseAccountGrantText('records:\n  deepseek-account-platform/default: [not a mapping]\n')
a('G6 畸形 record → null（不抛）', badYaml === null)

const quoted = m.parseAccountGrantText([
  'records:',
  '  "deepseek-account-platform/default":',
  "    kind: 'grant'",
  '    payload:',
  '      token: "' + TOKEN + '"',
  "      issuer: '" + ISSUER + "'",
  '',
].join('\n'))
a('G7 引号包裹的 key/值也能读', quoted?.token === TOKEN && quoted?.issuer === ISSUER)

const weirdIssuer = m.parseAccountGrantText([
  'records:',
  '  deepseek-account-platform/default:',
  '    kind: grant',
  '    payload:',
  '      token: ' + TOKEN,
  '      issuer: https://user:pass@platform.deepseek.com/evil?x=1',
  '',
].join('\n'))
a('G8 issuer 带凭据/路径 → 不接受（issuer 置空，不猜）', weirdIssuer?.token === TOKEN && weirdIssuer?.issuer === '')

// 临时文件 + readAccountGrant
const dir = mkdtempSync(join(tmpdir(), 'dshadb-acct-'))
try {
  const file = join(dir, '.credentials.yaml')
  writeFileSync(file, credentialsText, 'utf8')
  const fromFile = await m.readAccountGrant({ filePath: file })
  a('G9 readAccountGrant 从文件读到 token/issuer', fromFile?.token === TOKEN && fromFile?.issuer === ISSUER)

  const absent = await m.readAccountGrant({ filePath: join(dir, 'nope.yaml') })
  a('G10 文件不存在 → null（不抛）', absent === null)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// credentials 服务优先于文件
const serviceGrant = await m.readAccountGrant({
  credentials: { readRecord: async (key) => (key === 'deepseek-account-platform/default' ? { kind: 'grant', payload: { token: TOKEN, issuer: ISSUER } } : undefined) },
  filePath: join(tmpdir(), 'definitely-missing-' + Date.now() + '.yaml'),
})
a('G11 credentials 服务 readRecord 优先', serviceGrant?.token === TOKEN)

const serviceBroken = await m.readAccountGrant({
  credentials: { readRecord: async () => { throw new Error('service down') } },
  filePath: join(tmpdir(), 'definitely-missing-' + Date.now() + '-b.yaml'),
})
a('G12 服务抛错 → 退回文件（这里文件不存在 → null）', serviceBroken === null)

const serviceWrongKind = await m.readAccountGrant({
  credentials: { readRecord: async () => ({ kind: 'api-key', payload: { token: TOKEN } }) },
  filePath: join(tmpdir(), 'definitely-missing-' + Date.now() + '-c.yaml'),
})
a('G13 服务返回非 grant record → 不采纳', serviceWrongKind === null)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
