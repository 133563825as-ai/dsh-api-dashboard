// #4（2026-11-11，issue wbxhxjj）：智谱 Coding Plan「只有 percentage、没有 remaining」的账号。
//
// 真机返回（issue 原文，GET /api/monitor/usage/quota/limit）：
//   TOKENS_LIMIT unit=3 percentage=28（5 小时窗口）  ← 没有 remaining
//   TOKENS_LIMIT unit=6 percentage=88（周配额）      ← 没有 remaining
//   TIME_LIMIT   unit=5 remaining=3868               ← 唯一带 remaining 的
// 旧逻辑 `find(rem>0)` 会跳过两个 token 窗口，把「工具月度剩 3868」当主显示 —— 周配额 88% 消失。
//
// 这批钉子钉三件事：
//  ① 百分比模式：total = 100 - 最紧窗口已用%，currency '%'，windows 逐窗透出；
//  ② 红线不破：percentage 仍按「已用」解释，绝不冒充余额；
//  ③ Lite 档（token 窗口带 remaining）行为一字不变。
import { parseResponse } from '../src/index.js'

let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const maxPlan = {
  code: 200,
  data: {
    limits: [
      { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 28, nextResetTime: 1794339544572 },
      { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 88, nextResetTime: 1794509880984 },
      { type: 'TIME_LIMIT', unit: 5, number: 1, usage: 4000, currentValue: 132, remaining: 3868, percentage: 3, nextResetTime: 1795366961983 },
    ],
    level: 'max',
  },
}

const r = parseResponse('glm', maxPlan, { currency: 'CNY' })
a('R1 百分比模式: currency 为 %', r && r.currency === '%', JSON.stringify(r))
a('R2 total = 100 - 最紧窗口(88) = 12', r && r.total === 12, '得到 ' + (r && r.total))
a('R3 percent 同 total（三色灯方向: 剩得越少越红）', r && r.percent === 12)
a('R4 used = 最紧窗口已用 88', r && r.used === 88)
a('R5 windows 透出两个窗口', Array.isArray(r && r.windows) && r.windows.length === 2, JSON.stringify(r && r.windows))
a('R6 windows 内容 = 5小时 28% / 周 88%',
  r && Array.isArray(r.windows) && r.windows[0].percent === 28 && r.windows[1].percent === 88)
a('R7 note 里点名两个窗口与工具剩余', !!r && /5小时窗口已用28%/.test(r.note) && /周配额已用88%/.test(r.note) && /工具\(月度\)剩3868/.test(r.note), r && r.note)
a('R8 红线: 主显示不是 3868（工具月度剩余不得冒充余额）', r && r.total !== 3868)

// 周配额用完 → 剩余 0、红
const usedUp = { code: 200, data: { limits: [
  { type: 'TOKENS_LIMIT', unit: 3, percentage: 10 },
  { type: 'TOKENS_LIMIT', unit: 6, percentage: 100 },
] } }
const r2 = parseResponse('glm', usedUp, { currency: 'CNY' })
a('R9 周配额 100% → total 0', r2 && r2.total === 0, JSON.stringify(r2))
a('R10 周配额 100% → percent 0（红）', r2 && r2.percent === 0)

// Lite 档: token 窗口带 remaining → 老行为
const lite = { code: 200, data: { limits: [
  { type: 'TOKENS_LIMIT', unit: 3, remaining: 2000, percentage: 0 },
  { type: 'TOKENS_LIMIT', unit: 6, remaining: 10000, percentage: 0 },
] } }
const r3 = parseResponse('glm', lite, { currency: 'CNY' })
a('R11 Lite 档仍是 tokens 计数、total = 剩余 2000', r3 && r3.currency === 'tokens' && r3.total === 2000, JSON.stringify(r3))
a('R12 Lite 档不下发 windows（行为不变）', r3 && r3.windows === undefined)

// 空 limits 仍走 no-balance（不猜）
const r4 = parseResponse('glm', { code: 200, data: { limits: [] } }, { currency: 'CNY' })
a('R13 limits 为空 → null（交给 no-balance-api）', r4 === null, JSON.stringify(r4))


// ===== 客户端侧（结构断言，不能跑 DOM）: 状态条要真的把 windows 渲染出来 =====
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../client/client.js'), 'utf8')
a('C1 barAmountText 有 windows 分支（并排显示各窗口已用%）', /Array\.isArray\(current\.windows\)/.test(client))
a('C2 windows 分支把 label 拼进文案', /w\.label \|\| "窗口"\}\)已用/.test(client) || /已用\$\{Math\.round\(w\.percent\)\}%/.test(client))

console.log(`结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
