// v1.4.0: 余额解析的「红线」回归 —— 这几条都会让面板显示**错误且危险**的数字。
// 对应 AGENTS.md 第三节: ① 不要造假 ② 耗尽/负数必须红 ③ 区分「真实 0」与「解析失败」④ 限流配额 ≠ 余额
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name) } }

// ===== ① Kimi: limit 是**窗口上限**, 不是余额 =====
// 旧代码 `total: limit` → 客户端状态条/卡片/详情都取 total(从不看 available) → 配额耗尽也显示满额 + 绿灯。
{
  const r = m.parseResponse('kimi', { usage: { limit: 1000, remaining: 0 } })
  a('K1 剩余为 0 时 total = 0 (旧代码给的是上限 1000)', r !== null && r.total === 0)
  a('K1 但上限仍可在 note 里看到', r.note.includes('1000'))
  const r2 = m.parseResponse('kimi', { usage: { limit: 1000, remaining: 990 } })
  a('K2 有剩余时 total = 剩余量 990', r2.total === 990)
  a('K2 available 与 total 一致', r2.available === 990)
  a('K3 缺字段仍返回 null', m.parseResponse('kimi', { usage: {} }) === null)
}

// ===== ② 智谱: 只有 percentage 时**不能**当余额下发 =====
// percentage 是「已用/填充度」(100=用完), 方向还是反的。旧代码把它当 total → 88 分被判「绿灯余额充足」。
{
  a('G1 只有 percentage → null (不再冒充余额)', m.parseResponse('glm', { data: { limits: [{ unit: 5, percentage: 88 }] } }) === null)
  a('G2 没有 limits → null', m.parseResponse('glm', { data: {} }) === null)
  // 回归: 正常 Coding Plan 套餐路径必须**不受影响**
  const plan = m.parseResponse('glm', { data: { limits: [
    { unit: 3, remaining: 2000, percentage: 0 },
    { unit: 6, remaining: 0, percentage: 100, nextResetTime: '2026-09-08T00:00:00Z' },
  ] } })
  a('G3 套餐路径仍返回剩余积分 (2000)', plan !== null && plan.total === 2000)
  a('G3 用完的周配额在 note 里提示', plan.note.includes('周配额'))
  const usedUp = m.parseResponse('glm', { data: { limits: [{ unit: 3, remaining: 0, percentage: 100 }] } })
  a('G4 全部用尽 → total 0 且 note 说明', usedUp !== null && usedUp.total === 0 && usedUp.note.includes('已用完'))
}

// ===== ③ OpenRouter: 缺任一关键字段 → null, 绝不伪造负数余额 =====
// 旧守卫是 `&&`(两个都缺才放弃), 只缺 total_credits 时 toAmount(null)=0 → total = 0 - usage = 负数。
{
  const r = m.parseResponse('openrouter', { data: { total_usage: 100 } })
  a('O1 只缺 total_credits → null (旧代码算出 -100 的假负数)', r === null)
  const r2 = m.parseResponse('openrouter', { data: { total_credits: 50 } })
  a('O2 只缺 total_usage → null', r2 === null)
  const ok = m.parseResponse('openrouter', { data: { total_credits: 50, total_usage: 10 } })
  a('O3 字段齐全仍正常计算 (50-10=40)', ok !== null && ok.total === 40)
  a('O4 两字段都缺 → null', m.parseResponse('openrouter', { data: {} }) === null)
}

// ===== ④ DeepSeek: total_balance 缺失 → null, 不伪造「余额 0」 =====
{
  a('D1 缺 total_balance → null', m.parseResponse('deepseek', { balance_infos: [{ currency: 'CNY' }] }) === null)
  const ok = m.parseResponse('deepseek', { balance_infos: [{ total_balance: '10', granted_balance: '2', topped_up_balance: '9', currency: 'CNY' }] })
  a('D2 字段齐全仍正常', ok !== null && ok.total === 10 && ok.currency === 'CNY')
  a('D3 真实余额 0 仍应返回 0 (不是解析失败)', m.parseResponse('deepseek', { balance_infos: [{ total_balance: '0', currency: 'CNY' }] })?.total === 0)
  a('D4 空 balance_infos → null', m.parseResponse('deepseek', { balance_infos: [] }) === null)
}

// ===== 回归: 其它解析器没被误伤 =====
a('X1 siliconflow 缺字段 → null', m.parseResponse('siliconflow', { data: {} }) === null)
a('X2 siliconflow 正常', m.parseResponse('siliconflow', { data: { totalBalance: '12.5' } })?.total === 12.5)
a('X3 novita 缺字段 → null', m.parseResponse('novita', {}) === null)
a('X4 非对象输入一律 null', m.parseResponse('kimi', null) === null && m.parseResponse('openrouter', []) === null)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
