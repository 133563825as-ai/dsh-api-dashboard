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
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
