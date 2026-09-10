// v1.3.2: 会话消耗投影 —— 海外模型独立计价货币 (costByCurrency 不折算合并)
// v1.4.0: 默认 overseasCurrency 由 'follow' 改为 'USD' —— 国内用国内价(CNY)、海外用海外价(USD);
//         并把夹具事件从**死事件** `assistant/chunk` 改为框架真实的 `assistant/message`。
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name) } }

// 构造事件: 指定模型 + 一步 usage。
// ⚠️ 必须用 `assistant/message`(KNOWN_SESSION_EVENT_TYPES 里的真实事件)。
//    旧夹具用的 `assistant/chunk` 框架里根本不存在 —— 那正是 v1.4.0 修掉的漏计 bug,
//    而夹具本身也一直没走真实路径, 所以回归没拦住。
const hdr = (model) => ({ type: 'request/header', data: { header: { config: { model } } } })
const use = (turn, step, u) => ({ type: 'assistant/message', data: { turn, step, message: {}, stream: [], usage: u } })

const run = (cfg, events) => {
  const proj = m.makeCostProjection(() => cfg)
  let st = proj.init()
  for (const ev of events) st = proj.apply(st, ev)
  return proj.wire.view(st)
}

// 1M 未缓存输入 + 0 输出, 便于对着单价直接核对
const oneM = { inputTokens: 1_000_000, outputTokens: 0 }

// ---- 默认配置: 海外模型走 USD 原生价, 不再 ×7 ----
const vDefault = run({ currency: 'CNY' }, [hdr('claude-opus-5'), use(1, 1, oneM)])
a('P1 默认 claude 1M 输入 = $5 (原生 USD)', Math.abs(vDefault.costByCurrency.USD - 5) < 1e-6)
a('P1 默认 claude 不计入 CNY 主货币段', Math.abs(vDefault.cost) < 1e-9)
a('P1 默认 currency=CNY', vDefault.currency === 'CNY')
a('P1 默认 currencyByModel 标 USD', vDefault.currencyByModel['claude-opus-5'] === 'USD')
a('P1 默认单一币种不算混合', vDefault.mixedCurrency === false)

// ---- 显式回到 v1.2.6 老行为 (follow): 海外模型跟着主货币 ×7 ----
const vFollow = run({ currency: 'CNY', overseasCurrency: 'follow' }, [hdr('claude-opus-5'), use(1, 1, oneM)])
a('P2 follow 时 claude 1M 输入 = ¥35 (×7)', Math.abs(vFollow.cost - 35) < 1e-6)
a('P2 follow 时只有 CNY 一段', Object.keys(vFollow.costByCurrency).join() === 'CNY')

// ---- 混合会话: claude(USD) + glm(CNY 原生) ----
const vMix = run({ currency: 'CNY', overseasCurrency: 'USD' }, [
  hdr('claude-opus-5'), use(1, 1, oneM),
  hdr('glm-5.3-flash'), use(1, 2, oneM),
])
a('P3 混合标记', vMix.mixedCurrency === true)
a('P3 USD 段 = $5 (claude)', Math.abs(vMix.costByCurrency.USD - 5) < 1e-6)
a('P3 CNY 段 = ¥0.80 (glm 原生价, 不再 ×7 舍入)', Math.abs(vMix.costByCurrency.CNY - 0.8) < 1e-9)
a('P3 cost 只含主货币那份', Math.abs(vMix.cost - 0.8) < 1e-9)
a('P3 两种货币不相加合并', Math.abs(vMix.costByCurrency.USD + vMix.costByCurrency.CNY - 5.8) < 1e-9)
a('P3 currencyByModel 两条各自正确',
  vMix.currencyByModel['claude-opus-5'] === 'USD' && vMix.currencyByModel['glm-5.3-flash'] === 'CNY')

// ---- 主货币本来就是 USD ----
const vU1 = run({ currency: 'USD' }, [hdr('claude-opus-5'), use(1, 1, oneM)])
const vU2 = run({ currency: 'USD', overseasCurrency: 'USD' }, [hdr('claude-opus-5'), use(1, 1, oneM)])
a('P4 主货币 USD 时开关无影响', Math.abs(vU1.cost - vU2.cost) < 1e-9 && Math.abs(vU1.cost - 5) < 1e-6)

// ---- 国内模型在主货币 USD 下才做 ÷7 换算 ----
const vDomUsd = run({ currency: 'USD', overseasCurrency: 'USD' }, [hdr('glm-5.3'), use(1, 1, oneM)])
a('P4b 主货币 USD 时国内模型 ÷7 (¥8 → $1.1428...)', Math.abs(vDomUsd.cost - 8 / 7) < 1e-6)

// ---- waiting 态字段齐全 ----
const proj = m.makeCostProjection(() => ({ currency: 'CNY', overseasCurrency: 'USD' }))
const vWait = proj.wire.view(proj.init())
a('P5 waiting 带 costByCurrency 空对象', vWait.waiting === true && Object.keys(vWait.costByCurrency).length === 0)
a('P5 waiting 不标混合', vWait.mixedCurrency === false)

// ---- viewSchema 必须能校验通过新字段 (strict, 漏加就会炸) ----
let schemaOk = true
try { m.makeCostProjection(() => ({ currency: 'CNY', overseasCurrency: 'USD' })).wire.viewSchema.parse(vMix) } catch (e) { schemaOk = false; console.log('  schema 报错: ' + e.message.slice(0, 160)) }
a('P6 混合视图通过 viewSchema (strict)', schemaOk)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
// v1.3.2: 断言失败时以非 0 退出, 否则 CI(GitHub Actions)拦不住回归 —— 原来一律 exit 0
if (fail > 0) process.exitCode = 1
