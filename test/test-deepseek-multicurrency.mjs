// v1.4.2: DeepSeek `balance_infos` 是「一个币种钱包一条」，且**数组顺序不保证**。
// 真机实测（2026-09-11，DSHA，同一 key 连打 5 次）：第 4 次顺序翻成 [USD=0.00, CNY=123.45]。
// 旧代码 `const p = infos[0]` 盲取第一条 → 读到 USD 那条 → 有 123.45 元的账户显示成「$0.00 · 异常」。
// ⚠️ 顺带钉住一条红线：旧代码下面那道 `if (p.total_balance == null) return null` **拦不住**它 ——
//    USD 那条的 total_balance 是合法字符串 "0.00"，守卫被绕过、0 被当成真实余额渲染。
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name) } }

const CNY = { currency: 'CNY', total_balance: '123.45', granted_balance: '0.00', topped_up_balance: '123.45' }
const USD = { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }
const cnyFirst = { is_available: true, balance_infos: [CNY, USD] }
const usdFirst = { is_available: true, balance_infos: [USD, CNY] }

const r1 = m.parseResponse('deepseek', cnyFirst)
const r2 = m.parseResponse('deepseek', usdFirst)
a('D1  CNY 在前 → 123.45 / CNY', r1 !== null && r1.total === 123.45 && r1.currency === 'CNY')
a('D2  USD 在前 → 仍然 123.45 / CNY（旧代码这里是 0 / USD）', r2 !== null && r2.total === 123.45 && r2.currency === 'CNY')
a('D3  顺序翻转不改变结果', JSON.stringify(r1) === JSON.stringify(r2))
a('D4  不传主货币时也优先非 0', m.parseResponse('deepseek', usdFirst)?.total === 123.45)

a('D5  显式指定 USD → 拿 USD 那条', m.parseResponse('deepseek', cnyFirst, 'USD')?.currency === 'USD')
a('D6  大小写不敏感', m.parseResponse('deepseek', cnyFirst, 'usd')?.currency === 'USD')
a('D7  主货币不存在 → 退到「余额 > 0」的那条', m.parseResponse('deepseek', cnyFirst, 'EUR')?.currency === 'CNY')

// 全 0 账户：没有 >0 的可挑 → 取首条。如实给 0，**不返回 null** —— 真 0 ≠ 解析失败
const zero = m.parseResponse('deepseek', {
  balance_infos: [{ currency: 'CNY', total_balance: '0.00' }, { currency: 'USD', total_balance: '0.00' }],
})
a('D8  全 0 账户如实给 0（不返回 null）', zero !== null && zero.total === 0)

// 红线不动：关键字段缺失/非法一律 null，且不能被「首条」兜住
a('D9  total_balance 缺失 → null', m.parseResponse('deepseek', { balance_infos: [{ currency: 'CNY' }] }) === null)
a('D10 非法字符串 → null', m.parseResponse('deepseek', { balance_infos: [{ currency: 'CNY', total_balance: 'abc' }] }) === null)
a('D11 空字符串 → null（Number("") === 0，必须显式挡掉）', m.parseResponse('deepseek', { balance_infos: [{ currency: 'CNY', total_balance: '' }] }) === null)
a('D12 空数组 → null', m.parseResponse('deepseek', { balance_infos: [] }) === null)
a('D13 全非法条目 → null（不能被首条兜住）', m.parseResponse('deepseek', { balance_infos: [{ currency: 'CNY', total_balance: null }, { currency: 'USD', total_balance: '' }] }) === null)
a('D14 一非法一合法 → 取合法那条', m.parseResponse('deepseek', { balance_infos: [{ currency: 'USD', total_balance: null }, { currency: 'CNY', total_balance: '5.00' }] })?.total === 5)
a('D15 非对象输入仍为 null', m.parseResponse('deepseek', null) === null && m.parseResponse('deepseek', []) === null)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
