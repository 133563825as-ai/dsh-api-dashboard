// v1.3.2: 会话消耗投影 —— 海外模型独立计价货币 (costByCurrency 不折算合并)
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass = 0, fail = 0
const a = (name, cond) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name) } }

// 构造事件: 指定模型 + 一步 usage
const hdr = (model) => ({ type: 'request/header', data: { header: { config: { model } } } })
const use = (turn, step, u) => ({ type: 'assistant/chunk', data: { turn, step, chunk: { type: 'usage', usage: u } } })

const run = (cfg, events) => {
  const proj = m.makeCostProjection(() => cfg)
  let st = proj.init()
  for (const ev of events) st = proj.apply(st, ev)
  return proj.wire.view(st)
}

// 1M 未缓存输入 + 0 输出, 便于对着单价直接核对
const oneM = { inputTokens: 1_000_000, outputTokens: 0 }

// ---- 默认 (overseasCurrency 缺省) : 行为必须与 v1.2.6 一致 ----
const vDefault = run({ currency: 'CNY' }, [hdr('claude-opus-5'), use(1, 1, oneM)])
a('P1 默认 claude 1M 输入 = ¥35', Math.abs(vDefault.cost - 35) < 1e-6)
a('P1 默认 currency=CNY', vDefault.currency === 'CNY')
a('P1 默认不标混合', vDefault.mixedCurrency === false)
a('P1 默认 costByCurrency 只有 CNY', Object.keys(vDefault.costByCurrency).join() === 'CNY')

// ---- 开启海外 USD: 单一海外模型 ----
const vSea = run({ currency: 'CNY', overseasCurrency: 'USD' }, [hdr('claude-opus-5'), use(1, 1, oneM)])
a('P2 海外 USD 后 1M 输入 = $5', Math.abs(vSea.costByCurrency.USD - 5) < 1e-6)
a('P2 主货币段为 0 (claude 不计入 CNY)', Math.abs(vSea.cost) < 1e-9)
a('P2 currencyByModel 标 USD', vSea.currencyByModel['claude-opus-5'] === 'USD')
a('P2 单一货币不算混合', vSea.mixedCurrency === false)

// ---- 混合会话: claude(USD) + glm(CNY) ----
const vMix = run({ currency: 'CNY', overseasCurrency: 'USD' }, [
  hdr('claude-opus-5'), use(1, 1, oneM),
  hdr('glm-5.3-flash'), use(1, 2, oneM),
])
a('P3 混合标记', vMix.mixedCurrency === true)
a('P3 USD 段 = $5 (claude)', Math.abs(vMix.costByCurrency.USD - 5) < 1e-6)
a('P3 CNY 段 = ¥1.05 (glm 0.15×7)', Math.abs(vMix.costByCurrency.CNY - 1.05) < 1e-6)
a('P3 cost 只含主货币那份', Math.abs(vMix.cost - 1.05) < 1e-6)
a('P3 两种货币不相加合并', Math.abs(vMix.costByCurrency.USD + vMix.costByCurrency.CNY - 6.05) < 1e-6)
a('P3 currencyByModel 两条各自正确',
  vMix.currencyByModel['claude-opus-5'] === 'USD' && vMix.currencyByModel['glm-5.3-flash'] === 'CNY')

// ---- 主货币本来就是 USD 时, follow 与 USD 结果应一致 ----
const vU1 = run({ currency: 'USD' }, [hdr('claude-opus-5'), use(1, 1, oneM)])
const vU2 = run({ currency: 'USD', overseasCurrency: 'USD' }, [hdr('claude-opus-5'), use(1, 1, oneM)])
a('P4 主货币 USD 时开关无影响', Math.abs(vU1.cost - vU2.cost) < 1e-9 && Math.abs(vU1.cost - 5) < 1e-6)

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
