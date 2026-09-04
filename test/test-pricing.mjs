const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass=0, fail=0
const a=(n,c)=>{ if(c){pass++}else{fail++;console.log('FAIL '+n)} }
// 通用表存 USD 基准; 选 USD 原样返回, 选 CNY ×7 换算 (与 V4_RATES 两套表口径一致)
const pUsd=(model)=>m.resolveModelPrice({currency:'USD'}, model)
const pCny=(model)=>m.resolveModelPrice({currency:'CNY'}, model)
// GPT-5.6 新价 (USD 基准)
a('gpt-5.6-sol 促销价 4/20', pUsd('gpt-5.6-sol').cacheMiss===4.0 && pUsd('gpt-5.6-sol').output===20.0)
a('gpt-5.6-luna 降价 0.2/1.2', pUsd('gpt-5.6-luna').cacheMiss===0.2 && pUsd('gpt-5.6-luna').output===1.2)
// Claude 5
a('claude-opus-5 5/25', pUsd('claude-opus-5').cacheMiss===5.0 && pUsd('claude-opus-5').output===25.0)
a('claude-sonnet-5 2/10', pUsd('claude-sonnet-5').cacheMiss===2.0 && pUsd('claude-sonnet-5').output===10.0)
// Gemini 3.7-flash
a('gemini-3.7-flash 0.75/3.75', pUsd('gemini-3.7-flash').cacheMiss===0.75 && pUsd('gemini-3.7-flash').output===3.75)
// Qwen3
a('qwen3.7-max 0.83/2.48', pUsd('qwen3.7-max').cacheMiss===0.83 && pUsd('qwen3.7-max').output===2.48)
a('qwen3.7-flash 0.03/0.13', pUsd('qwen3.7-flash').cacheMiss===0.03 && pUsd('qwen3.7-flash').output===0.13)
// GLM-5
a('glm-5.2 1.4/4.4', pUsd('glm-5.2').cacheMiss===1.4 && pUsd('glm-5.2').output===4.4)
a('glm-5.3-flash 0.15/0.5', pUsd('glm-5.3-flash').cacheMiss===0.15 && pUsd('glm-5.3-flash').output===0.5)
// v1.2.3 回归: GLM 系缓存读必须 < 输入价 (20% 口径), 修复"无缓存折扣"误标导致长会话消耗虚高 5 倍
a('glm-5.3-flash cacheHit=0.03 (20%)', pUsd('glm-5.3-flash').cacheHit===0.03)
a('GLM 系缓存读均低于输入价', ['glm-5.2','glm-5-turbo','glm-5.3-flash'].every(m => pUsd(m).cacheHit < pUsd(m).cacheMiss))
// Kimi K3 cache 修正
a('kimi-k3 cacheHit=0.3', pUsd('kimi-k3').cacheHit===0.3)
// 币种统一 (CNY 官方价 ÷7 → USD 基准)
a('qwen3.8-max 超额价 ÷7 = 1.71/5.14', pUsd('qwen3.8-max').cacheMiss===1.71 && pUsd('qwen3.8-max').output===5.14)
a('step-3.7-flash ÷7 = 0.193/1.157', pUsd('step-3.7-flash').cacheMiss===0.193 && pUsd('step-3.7-flash').output===1.157)
a('step-3.5-flash ÷7 = 0.10/0.30', pUsd('step-3.5-flash').cacheMiss===0.10 && pUsd('step-3.5-flash').output===0.30)
// CNY 口径 ×7 换算 (挑整数/精确值, 避开浮点误差)
a('gpt-5.6-sol CNY ×7 = 28/140', pCny('gpt-5.6-sol').cacheMiss===28 && pCny('gpt-5.6-sol').output===140)
a('claude-opus-5 CNY ×7 = 35/175', pCny('claude-opus-5').cacheMiss===35 && pCny('claude-opus-5').output===175)
a('gemini-3.7-flash CNY ×7 = 5.25/26.25', pCny('gemini-3.7-flash').cacheMiss===5.25 && pCny('gemini-3.7-flash').output===26.25)

// ===== v1.3.2 海外模型独立计价货币 =====
// 产地判定
a('R1 claude 判海外', m.modelRegion('claude-opus-5-thinking')==='海外')
a('R1 gpt 判海外', m.modelRegion('gpt-5.6-sol')==='海外')
a('R1 gemini 判海外', m.modelRegion('gemini-3.8-flash')==='海外')
a('R1 grok 判海外', m.modelRegion('grok-4')==='海外')
a('R1 deepseek 判国内', m.modelRegion('deepseek-v4-flash')==='国内')
a('R1 glm 判国内', m.modelRegion('glm-5.3-flash')==='国内')
a('R1 doubao/hunyuan 判国内', m.modelRegion('doubao-seed-2.0-pro-32k')==='国内' && m.modelRegion('hunyuan-turbo-s')==='国内')
a('R1 未知模型不表态', m.modelRegion('some-random-model')===null && m.modelRegion('')===null && m.modelRegion(null)===null)
// currencyForModel: follow(默认) 时一律跟主货币
a('R2 follow 时海外跟 CNY', m.currencyForModel({ currency:'CNY' }, 'claude-opus-5')==='CNY')
a('R2 follow 时海外跟 USD', m.currencyForModel({ currency:'USD' }, 'claude-opus-5')==='USD')
// 开启后只影响海外模型
a('R2 海外走 USD', m.currencyForModel({ currency:'CNY', overseasCurrency:'USD' }, 'claude-opus-5')==='USD')
a('R2 国内仍走 CNY', m.currencyForModel({ currency:'CNY', overseasCurrency:'USD' }, 'deepseek-v4-flash')==='CNY')
a('R2 未知模型走主货币(保守)', m.currencyForModel({ currency:'CNY', overseasCurrency:'USD' }, 'some-random-model')==='CNY')
a('R2 脏值当 follow', m.currencyForModel({ currency:'CNY', overseasCurrency:'EUR' }, 'claude-opus-5')==='CNY')
// 价格实际口径: 开启后 claude 不再 ×7, deepseek 仍是 CNY 表
const cfgMix = { currency:'CNY', overseasCurrency:'USD' }
a('R3 claude 开启后 = USD 原值 5/25', m.resolveModelPrice(cfgMix,'claude-opus-5').cacheMiss===5 && m.resolveModelPrice(cfgMix,'claude-opus-5').output===25)
a('R3 deepseek 不受影响(仍 CNY 峰谷表)', [3,1.5].includes(m.resolveModelPrice(cfgMix,'deepseek-v4-flash').cacheMiss))
a('R3 glm 不受影响 CNY ×7 = 1.05', Math.abs(m.resolveModelPrice(cfgMix,'glm-5.3-flash').cacheMiss - 1.05) < 1e-9)
// 回归: 默认配置(无 overseasCurrency)必须与 v1.2.6 完全一致
a('R4 默认 claude CNY ×7 = 35/175', pCny('claude-opus-5').cacheMiss===35 && pCny('claude-opus-5').output===175)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
// v1.3.2: 断言失败时以非 0 退出, 否则 CI(GitHub Actions)拦不住回归 —— 原来一律 exit 0
if (fail > 0) process.exitCode = 1
