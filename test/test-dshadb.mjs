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

// ===== v1.2.6 智谱套餐用户回归 (开源前重点: 别让「按量付费」改动伤到 Coding Plan 套餐用户) =====
// 真实套餐返回形状 (2026-08-30 真实 key 实测): unit=3 五小时窗口 + unit=6 周配额
const planJson = { code: 200, success: true, data: { limits: [
  { unit: 3, remaining: 2000, percentage: 0 },
  { unit: 6, remaining: 0, percentage: 100, nextResetTime: '2026-09-08T00:00:00Z' },
] } }
const plan = m.parseResponse('glm', planJson)
assert('P1 套餐用户仍解析出配额', plan !== null && plan.total === 2000)
assert('P2 套餐主显示走 5小时窗口', /5小时窗口/.test(plan?.note ?? ''))
assert('P3 套餐顺带提示周配额已用完', /周配额已用完/.test(plan?.note ?? ''))
assert('P4 套餐 available 与 total 一致', plan?.available === 2000)
// 套餐额度全用尽: 必须显示 0 而非报错
const usedUp = m.parseResponse('glm', { data: { limits: [{ unit: 3, remaining: 0, percentage: 100 }] } })
assert('P5 配额用尽显示 0 不报错', usedUp !== null && usedUp.total === 0)
// 按量付费账户: 中性「未开放」, 不标红
const payg = m.classifyBizError('glm', { code: 500, msg: '当前用户不存在coding plan', success: false })
assert('P6 按量付费 → no-balance-api', payg.status === 'no-balance-api')
assert('P7 文案提到 Coding Plan', /Coding Plan/.test(payg.error))
assert('P7b 文案不替平台断言账户类型(兼容套餐过期)', /过期/.test(payg.error))
// 其他业务错误: 仍透传原始 msg
const other = m.classifyBizError('glm', { code: 401, msg: 'token 已过期', success: false })
assert('P8 其他业务错误 → parse-error', other.status === 'parse-error')
assert('P9 其他业务错误透传 msg', other.error.includes('token 已过期'))
// 非智谱平台不受 coding plan 规则影响
const notGlm = m.classifyBizError('kimi', { code: 500, msg: '当前用户不存在coding plan', success: false })
assert('P10 非 glm 不套用按量付费规则', notGlm.status === 'parse-error')
// JSON 解析失败 / 无 msg: 保持原文案
assert('P11 json=null 走原文案', m.classifyBizError('glm', null).error === '无法解析余额数据')
assert('P12 success:true 无 msg 走原文案', m.classifyBizError('glm', { code: 200, success: true }).error === '无法解析余额数据')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
