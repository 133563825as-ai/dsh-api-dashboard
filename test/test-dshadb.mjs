const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const assert = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name) } }

assert('S4 数字', m.parseResponse('novita', 3) === null)
assert('S4 字符串', m.parseResponse('novita', 'abc') === null)
assert('S4 数组', m.parseResponse('openai', [1,2,3]) === null)
assert('S4 null', m.parseResponse('deepseek', null) === null)
assert('S4 正常对象仍工作', m.parseResponse('deepseek', { balance_infos: [{ total_balance: '10', currency: 'CNY' }] })?.total === 10)

const bjtMon5 = Date.UTC(2026, 0, 4, 21, 0, 0)
assert('S5 周一05:00 非周末', m.isWeekend(bjtMon5) === false)
assert('S5 周一05:00 谷时', m.isPeakTime(bjtMon5) === false)
const bjtSat5 = Date.UTC(2026, 0, 9, 21, 0, 0)
assert('S5 周六05:00 是周末', m.isWeekend(bjtSat5) === true)

assert('S6 "g" 走默认价(USD cacheMiss=1)', m.resolveModelPrice({ currency: 'USD' }, 'g')?.cacheMiss === 1)
assert('S6b "g" 默认 CNY ×7 cacheMiss=7', m.resolveModelPrice({}, 'g')?.cacheMiss === 7)
assert('S7 available=0 → 0', m.parseResponse('openai', { total_granted: 100, total_used: 30, total_available: 0 })?.total === 0)
assert('S8 quota null → null', m.parseResponse('quota', { data: { username: 'x', quota: null } }) === null)
const s9 = m.parseResponse('glm', { data: { limits: [{ unit: 5, percentage: 60 }] } })
assert('S9 percent 非布尔', typeof s9?.percent !== 'boolean')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
