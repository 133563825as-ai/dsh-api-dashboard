// 价格表断言 —— v1.4.0 起 MODEL_PRICES 按「模型原生币种」存储:
//   国内厂商官方页给 CNY → 表里直接写 CNY 原值; 海外厂商给 USD → 表里直接写 USD 原值。
//   resolveModelPrice 只在「显示币种 ≠ 原生币种」时换算。
//   默认 currency=CNY / overseasCurrency=USD ⇒ 国内读出来就是官方 CNY, 海外就是官方 USD。
const m = await import(new URL('../src/index.js', import.meta.url).pathname + '?v=' + Date.now())
let pass=0, fail=0
const a=(n,c)=>{ if(c){pass++}else{fail++;console.log('FAIL '+n)} }
// 默认配置 (overseasCurrency 缺省 → v1.4.0 起为 'USD')
const p=(model)=>m.resolveModelPrice({currency:'CNY'}, model)
// 显式回到 v1.2.x 老行为: 全部跟主货币
const pFollowCny=(model)=>m.resolveModelPrice({currency:'CNY', overseasCurrency:'follow'}, model)
const near=(x,y,eps=1e-9)=>Math.abs(x-y)<eps

// ===== 海外厂商: 原生 USD, 默认配置下原样返回 =====
a('gpt-5.6-sol 促销价 4/20 (USD 原生)', p('gpt-5.6-sol').cacheMiss===4.0 && p('gpt-5.6-sol').output===20.0)
a('gpt-5.6-luna 降价 0.2/1.2', p('gpt-5.6-luna').cacheMiss===0.2 && p('gpt-5.6-luna').output===1.2)
a('claude-opus-5 5/25', p('claude-opus-5').cacheMiss===5.0 && p('claude-opus-5').output===25.0)
a('claude-sonnet-5 2/10', p('claude-sonnet-5').cacheMiss===2.0 && p('claude-sonnet-5').output===10.0)
a('gemini-3.7-flash 0.75/3.75', p('gemini-3.7-flash').cacheMiss===0.75 && p('gemini-3.7-flash').output===3.75)

// ===== 国内厂商: 原生 CNY, 默认配置下**就是官方价**, 不再 ÷7 再 ×7 =====
// 官方来源已逐个抓原文核对 (2026-09-10): docs.bigmodel.cn / platform.kimi.com / platform.minimaxi.com /
// platform.stepfun.com / help.aliyun.com(百炼) / MiMo 官方降价公告。
a('glm-5.3 官方 ¥8/¥28/缓存¥2', p('glm-5.3').cacheMiss===8 && p('glm-5.3').output===28 && p('glm-5.3').cacheHit===2)
a('glm-5.2 官方 ¥8/¥28/缓存¥2', p('glm-5.2').cacheMiss===8 && p('glm-5.2').output===28)
a('glm-5.1 官方 ≥32K 档 ¥8/¥28/缓存¥2', p('glm-5.1').cacheMiss===8 && p('glm-5.1').output===28)
a('glm-5-turbo 官方 ≥32K 档 ¥7/¥26/缓存¥1.8 (v1.4.0 修正)', p('glm-5-turbo').cacheMiss===7 && p('glm-5-turbo').output===26 && p('glm-5-turbo').cacheHit===1.8)
a('glm-5.3-flash 官方 ¥0.8/¥2.8/缓存¥0.23', p('glm-5.3-flash').cacheMiss===0.8 && p('glm-5.3-flash').output===2.8 && p('glm-5.3-flash').cacheHit===0.23)
a('kimi-k3 官方 ¥2/¥20/¥100 (v1.4.0 修正 +5%)', p('kimi-k3').cacheHit===2 && p('kimi-k3').cacheMiss===20 && p('kimi-k3').output===100)
a('kimi-k2.7-code 官方 ¥1.3/¥6.5/¥27', p('kimi-k2.7-code').cacheHit===1.3 && p('kimi-k2.7-code').cacheMiss===6.5 && p('kimi-k2.7-code').output===27)
a('kimi-k2.6 官方缓存命中 ¥1.1 (v1.4.0 修正, 旧值误抄 k2.7-code 的 1.3)',
  p('kimi-k2.6').cacheHit===1.1 && p('kimi-k2.6').cacheMiss===6.5 && p('kimi-k2.6').output===27)
a('kimi-k2.7-code-highspeed 新增 ¥2.6/¥13/¥54',
  p('kimi-k2.7-code-highspeed').cacheHit===2.6 && p('kimi-k2.7-code-highspeed').cacheMiss===13 && p('kimi-k2.7-code-highspeed').output===54)
a('minimax-m2.7 官方缓存读 ¥0.42 (v1.4.0 修正: 旧值拿 cacheMiss 顶替, 高估 5 倍)',
  p('minimax-m2.7').cacheHit===0.42 && p('minimax-m2.7').cacheMiss===2.1 && p('minimax-m2.7').output===8.4)
a('minimax-m2.7-highspeed 新增 ¥4.2/¥16.8', p('minimax-m2.7-highspeed').cacheMiss===4.2 && p('minimax-m2.7-highspeed').output===16.8)
a('mimo-v2.5 官方永久降价后 ¥1/¥2/缓存¥0.02', near(p('mimo-v2.5').cacheHit,0.02) && p('mimo-v2.5').cacheMiss===1 && p('mimo-v2.5').output===2)
a('mimo-v2.5-pro 官方 ¥3/¥6/缓存¥0.025', near(p('mimo-v2.5-pro').cacheHit,0.025) && p('mimo-v2.5-pro').cacheMiss===3 && p('mimo-v2.5-pro').output===6)
a('step-3.7-flash 官方 ¥1.35/¥8.1/缓存¥0.27', p('step-3.7-flash').cacheMiss===1.35 && p('step-3.7-flash').output===8.1 && p('step-3.7-flash').cacheHit===0.27)
a('step-3.5-flash 官方 ¥0.7/¥2.1/缓存¥0.14', p('step-3.5-flash').cacheMiss===0.7 && p('step-3.5-flash').output===2.1 && p('step-3.5-flash').cacheHit===0.14)
a('qwen3.8-max 官方 ¥12/¥36', p('qwen3.8-max').cacheMiss===12 && p('qwen3.8-max').output===36)
a('qwen3.7-max 官方 ¥12/¥36 (v1.4.0 删掉查无实据的 5 折值)', p('qwen3.7-max').cacheMiss===12 && p('qwen3.7-max').output===36)
a('qwen3.7-plus 官方限时 8 折 ¥1.6/¥6.4', p('qwen3.7-plus').cacheMiss===1.6 && p('qwen3.7-plus').output===6.4)
a('qwen3.7-flash 官方 ¥0.2/¥0.8 (v1.4.0 修正, 旧值是中转站高档位)', p('qwen3.7-flash').cacheMiss===0.2 && p('qwen3.7-flash').output===0.8)
a('qwen3.8-flash 官方 ¥0.8/¥2.7', p('qwen3.8-flash').cacheMiss===0.8 && p('qwen3.8-flash').output===2.7)
a('qwen3.8-27b 官方 ¥3/¥12, 缓存命中按 10% = ¥0.3 (v1.4.0 修正)', p('qwen3.8-27b').cacheMiss===3 && p('qwen3.8-27b').output===12 && near(p('qwen3.8-27b').cacheHit,0.3))
a('qwen3.6-plus 官方 ¥2/¥12', p('qwen3.6-plus').cacheMiss===2 && p('qwen3.6-plus').output===12)
a('seed-2.1-turbo 实测 ¥3/¥15/缓存¥0.6', p('seed-2.1-turbo').cacheMiss===3 && p('seed-2.1-turbo').output===15 && p('seed-2.1-turbo').cacheHit===0.6)
a('seed-2.1-pro 实测 ¥6/¥30/缓存¥1.2', p('seed-2.1-pro').cacheMiss===6 && p('seed-2.1-pro').output===30 && p('seed-2.1-pro').cacheHit===1.2)
a('longcat-2.0 实测 ¥5/¥20/缓存¥0.1', p('longcat-2.0').cacheMiss===5 && p('longcat-2.0').output===20 && p('longcat-2.0').cacheHit===0.1)

// ===== v1.4.0 关键回归: 「历史/参考」段的国内条目曾被当 USD 又 ×7 =====
a('R-hist glm-4-plus 官方 ¥2.5/¥5/¥5 (旧口径下显示 ¥17.5/¥35/¥35)',
  p('glm-4-plus').cacheHit===2.5 && p('glm-4-plus').cacheMiss===5 && p('glm-4-plus').output===5)
a('R-hist qwen-plus 官方 ¥0.8/¥2', p('qwen-plus').cacheMiss===0.8 && p('qwen-plus').output===2)
a('R-hist qwen-turbo 官方 ¥0.3/¥0.6', p('qwen-turbo').cacheMiss===0.3 && p('qwen-turbo').output===0.6)
a('R-hist qwen-max 官方现价 ¥2.4/¥9.6', p('qwen-max').cacheMiss===2.4 && p('qwen-max').output===9.6)
a('R-hist qwen2.5-72b 官方 ¥4/¥12', p('qwen2.5-72b-instruct').cacheMiss===4 && p('qwen2.5-72b-instruct').output===12)
// 海外历史条目的缓存读口径修正 (Anthropic 10% / Gemini 25%)
a('R-hist claude-3-5-sonnet 缓存读 = 输入×10%', near(p('claude-3-5-sonnet').cacheHit, 0.3))
a('R-hist claude-3-opus 缓存读 = 输入×10%', near(p('claude-3-opus').cacheHit, 1.5))
a('R-hist gemini-1.5-pro 缓存读 = 输入×25%', near(p('gemini-1.5-pro').cacheHit, 0.875))

// ===== v1.2.3 红线回归: 缓存读必须 < 输入价 (真无折扣才写等值, 且要注明) =====
a('GLM 系缓存读均低于输入价', ['glm-5.2','glm-5-turbo','glm-5.3-flash','glm-5.1','glm-5.3'].every(k => m.MODEL_PRICES[k].cacheHit < m.MODEL_PRICES[k].cacheMiss))
a('Kimi 系缓存读均低于输入价', ['kimi-k3','kimi-k2.6','kimi-k2.7-code','kimi-k2.7-code-highspeed'].every(k => m.MODEL_PRICES[k].cacheHit < m.MODEL_PRICES[k].cacheMiss))
a('MiniMax 缓存读低于输入价', m.MODEL_PRICES['minimax-m2.7'].cacheHit < m.MODEL_PRICES['minimax-m2.7'].cacheMiss)
a('全表 cacheHit 均不高于 cacheMiss', Object.entries(m.MODEL_PRICES).every(([,v]) => v.cacheHit <= v.cacheMiss))
a('全表 output 均为正数', Object.entries(m.MODEL_PRICES).every(([,v]) => v.output > 0))

// ===== v1.4.0: 原生币种可判定性 —— 每个键都必须能定性, 否则会静默按 CNY 解读 =====
a('MODEL_PRICES 所有键的产地均可判定', Object.keys(m.MODEL_PRICES).every(k => m.modelRegion(k) !== null))
a('nativeCurrencyOf: 国内→CNY / 海外→USD / 未知→CNY',
  m.nativeCurrencyOf('glm-5.3')==='CNY' && m.nativeCurrencyOf('claude-opus-5')==='USD' && m.nativeCurrencyOf('who-knows')==='CNY')

// ===== v1.4.0: 前缀兜底只吃「安全后缀」, 不再把未收录模型吞进老键 =====
a('BUG gpt-4.1 不再命中 gpt-4 价 ($15/$30/$60)', p('gpt-4.1').cacheMiss!==30 && p('gpt-4.1').output!==60)
a('BUG gpt-4.1 落 defaultPrices', p('gpt-4.1').cacheMiss===1 && p('gpt-4.1').output===2)
a('BUG gpt-4.5-preview 不再命中 gpt-4 价', p('gpt-4.5-preview').cacheMiss!==30)
a('BUG gemini-2.5-flash-lite 不再命中 gemini-2.5-flash 价', p('gemini-2.5-flash-lite').cacheMiss!==0.3)
a('安全后缀仍生效: gpt-4o-mini-2024-07-18 → gpt-4o-mini', near(p('gpt-4o-mini-2024-07-18').cacheMiss, 0.15))
a('安全后缀仍生效: claude-3-5-sonnet-20241022 → claude-3-5-sonnet', near(p('claude-3-5-sonnet-20241022').cacheMiss, 3))
a('安全后缀仍生效: qwen3.8-max-0902 → qwen3.8-max', p('qwen3.8-max-0902').cacheMiss===12)
a('安全后缀仍生效: -latest/-preview', near(p('gpt-5.6-luna-preview').cacheMiss, 0.2))
a('"g" 走默认价(USD cacheMiss=1, 主货币 CNY → ¥7)', m.resolveModelPrice({currency:'CNY'},'g').cacheMiss===7)

// ===== v1.4.0: resolveModelPrice 对非字符串不再抛异常 =====
a('null 不抛异常', (()=>{ try { m.resolveModelPrice({currency:'CNY'}, null); return true } catch { return false } })())
a('undefined 不抛异常', (()=>{ try { m.resolveModelPrice({currency:'CNY'}, undefined); return true } catch { return false } })())
a('数字 不抛异常', (()=>{ try { m.resolveModelPrice({currency:'CNY'}, 123); return true } catch { return false } })())
a('空串落默认价', m.resolveModelPrice({currency:'USD'}, '')?.cacheMiss===1)

// ===== 产地判定 =====
a('R1 claude 判海外', m.modelRegion('claude-opus-5-thinking')==='海外')
a('R1 gpt 判海外', m.modelRegion('gpt-5.6-sol')==='海外')
a('R1 gemini 判海外', m.modelRegion('gemini-3.8-flash')==='海外')
a('R1 grok 判海外', m.modelRegion('grok-4')==='海外')
a('R1 deepseek 判国内', m.modelRegion('deepseek-v4-flash')==='国内')
a('R1 glm 判国内', m.modelRegion('glm-5.3-flash')==='国内')
a('R1 doubao/hunyuan 判国内', m.modelRegion('doubao-seed-2.0-pro-32k')==='国内' && m.modelRegion('hunyuan-turbo-s')==='国内')
a('R1 新模型产地 (seed/minimax/longcat → 国内)', m.modelRegion('seed-2.1-pro')==='国内' && m.modelRegion('minimax-m2.7')==='国内' && m.modelRegion('longcat-2.0')==='国内')
a('R1 未知模型不表态', m.modelRegion('some-random-model')===null && m.modelRegion('')===null && m.modelRegion(null)===null)

// ===== currencyForModel =====
a('R2 默认(缺省) 海外走 USD —— v1.4.0 新默认', m.currencyForModel({ currency:'CNY' }, 'claude-opus-5')==='USD')
a('R2 默认 国内仍走 CNY', m.currencyForModel({ currency:'CNY' }, 'glm-5.3')==='CNY')
a('R2 follow 时海外跟主货币', m.currencyForModel({ currency:'CNY', overseasCurrency:'follow' }, 'claude-opus-5')==='CNY')
a('R2 follow 时主货币 USD 仍 USD', m.currencyForModel({ currency:'USD', overseasCurrency:'follow' }, 'claude-opus-5')==='USD')
a('R2 显式 USD 生效', m.currencyForModel({ currency:'CNY', overseasCurrency:'USD' }, 'claude-opus-5')==='USD')
a('R2 国内不受 overseasCurrency 影响', m.currencyForModel({ currency:'CNY', overseasCurrency:'USD' }, 'deepseek-v4-flash')==='CNY')
a('R2 未知模型走主货币(保守)', m.currencyForModel({ currency:'CNY', overseasCurrency:'USD' }, 'some-random-model')==='CNY')
a('R2 脏值当 CNY (非 follow 且非 USD)', m.currencyForModel({ currency:'CNY', overseasCurrency:'EUR' }, 'claude-opus-5')==='CNY')

// ===== 显式 follow 时, 国内/海外都按主货币换算 (老行为可用) =====
a('R3 follow CNY: claude ×7 = 35/175', pFollowCny('claude-opus-5').cacheMiss===35 && pFollowCny('claude-opus-5').output===175)
a('R3 follow CNY: gpt-5.6-sol ×7 = 28/140', pFollowCny('gpt-5.6-sol').cacheMiss===28 && pFollowCny('gpt-5.6-sol').output===140)
a('R3 follow CNY: 国内模型不受影响, 仍是原生价', pFollowCny('glm-5.3').cacheMiss===8)

// ===== v1.3.4: DeepSeek 2026-09-10 12:00 起 Flash 降价 60% + 模型名收敛 (官方中英双页已复核) =====
const pUsd=(model)=>m.resolveModelPrice({currency:'USD', overseasCurrency:'USD'}, model)
a('DS1 deepseek-flash CNY 新价 (高峰2/8 或 空闲1/4)', [2,1].includes(p('deepseek-flash').cacheMiss) && [8,4].includes(p('deepseek-flash').output))
a('DS2 deepseek-flash USD 新价 (高峰0.3/1.2 或 空闲0.15/0.6)', [0.3,0.15].includes(pUsd('deepseek-flash').cacheMiss) && [1.2,0.6].includes(pUsd('deepseek-flash').output))
a('DS3 旧名 deepseek-v4-flash 与 flash 同价', pUsd('deepseek-v4-flash').cacheMiss===pUsd('deepseek-flash').cacheMiss && pUsd('deepseek-v4-flash').output===pUsd('deepseek-flash').output)
a('DS4 旧名 vision-exp 亦同 flash 价', pUsd('deepseek-v4-flash-vision-exp').output===pUsd('deepseek-flash').output)
a('DS5 deepseek-v4-pro 价未变 (USD 高峰1.32/3.96 或 空闲0.66/1.98)', [1.32,0.66].includes(pUsd('deepseek-v4-pro').cacheMiss) && [3.96,1.98].includes(pUsd('deepseek-v4-pro').output))
a('DS6 flash 缓存读仍低于未命中输入价', pUsd('deepseek-flash').cacheHit < pUsd('deepseek-flash').cacheMiss)
// ⚠️ chat/reasoner 必须仍走**通用表**, 不能被 startsWith('deepseek') 劫持进 V4 峰谷表
a('DS7 chat/reasoner 不被劫持进峰谷表', p('deepseek-chat').cacheMiss===1 && p('deepseek-chat').output===2 && !(p('deepseek-reasoner').output===4 || p('deepseek-reasoner').output===8 && p('deepseek-reasoner').cacheMiss===1))
a('DS7b deepseek-chat 走通用表且按原生 CNY', m.MODEL_PRICES['deepseek-chat'].cacheMiss === p('deepseek-chat').cacheMiss)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
// v1.3.2: 断言失败时以非 0 退出, 否则 CI(GitHub Actions)拦不住回归 —— 原来一律 exit 0
if (fail > 0) process.exitCode = 1
