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
a('gpt-5.6-sol 官方现价 5/30 (USD 原生, 2026-09-22 官方页)', p('gpt-5.6-sol').cacheMiss===5.0 && p('gpt-5.6-sol').output===30.0)
a('gpt-5.6-luna 降价 0.2/1.2', p('gpt-5.6-luna').cacheMiss===0.2 && p('gpt-5.6-luna').output===1.2)
a('claude-opus-5 5/25', p('claude-opus-5').cacheMiss===5.0 && p('claude-opus-5').output===25.0)
a('claude-sonnet-5 2/10', p('claude-sonnet-5').cacheMiss===2.0 && p('claude-sonnet-5').output===10.0)
a('gemini-3.7-flash 0.75/3.75', p('gemini-3.7-flash').cacheMiss===0.75 && p('gemini-3.7-flash').output===3.75)

// ===== 2026-09-22 ai.google.dev/gemini-api/docs/pricing (Standard 档) 官方原文核对 =====
// 官方口径: 缓存读 = 输入 ×10%。旧表 3 条标「无缓存折扣」是错的; 并补录 4 条此前**没有任何键**的模型。
a('gemini-3.7/3.8/3.6-flash 官方 $0.75/$3.75/缓存 $0.075 (促销至 2026-12-31)',
  ['gemini-3.7-flash','gemini-3.8-flash','gemini-3.6-flash'].every(k => p(k).cacheMiss===0.75 && p(k).output===3.75 && p(k).cacheHit===0.075))
a('gemini-3.5-flash 官方 $1.50/$9.00/缓存 $0.15 (v1.4.5 补录)',
  p('gemini-3.5-flash').cacheMiss===1.5 && p('gemini-3.5-flash').output===9.0 && p('gemini-3.5-flash').cacheHit===0.15)
a('BUG gemini-3.5-flash 此前落默认价($1/$2, 输出低估 4.5 倍)', p('gemini-3.5-flash').output!==2)
a('BUG gemini-3.5-flash-lite 缓存读 = 官方 $0.03 (旧值 0.3 且标「无缓存折扣」→ 高估 10 倍)',
  near(p('gemini-3.5-flash-lite').cacheHit, 0.03) && p('gemini-3.5-flash-lite').cacheMiss===0.3 && p('gemini-3.5-flash-lite').output===2.5)
a('BUG gemini-3.1-pro 缓存读 = 官方 $0.20 (旧值 2.0 且标「无缓存折扣」→ 高估 10 倍)',
  near(p('gemini-3.1-pro').cacheHit, 0.20) && p('gemini-3.1-pro').cacheMiss===2.0 && p('gemini-3.1-pro').output===12.0)
a('BUG gemini-3-flash-preview 缓存读 = 官方 $0.05 (旧值 0.025 = 输入的 5%, 官方是 10%)',
  near(p('gemini-3-flash-preview').cacheHit, 0.05) && p('gemini-3-flash-preview').cacheMiss===0.5 && p('gemini-3-flash-preview').output===3.0)
a('gemini-2.5-flash-lite 官方 $0.10/$0.40/缓存 $0.01 (补录: 旧表无此键 → 输入高估 10 倍)',
  p('gemini-2.5-flash-lite').cacheMiss===0.1 && p('gemini-2.5-flash-lite').output===0.4 && near(p('gemini-2.5-flash-lite').cacheHit, 0.01))
a('gemini-3.1-flash-lite 官方 $0.25/$1.50/缓存 $0.025 (补录)',
  p('gemini-3.1-flash-lite').cacheMiss===0.25 && p('gemini-3.1-flash-lite').output===1.5 && near(p('gemini-3.1-flash-lite').cacheHit, 0.025))
a('gemini-omni-flash 官方 $1.50/$9.00 (官方未列缓存价 → 按输入价计, 不假设折扣)',
  p('gemini-omni-flash').cacheMiss===1.5 && p('gemini-omni-flash').output===9.0 && p('gemini-omni-flash').cacheHit===1.5)
a('gemini-3.1-pro-preview 走安全后缀命中 gemini-3.1-pro (官方页名为 Preview)', p('gemini-3.1-pro-preview').cacheMiss===2.0)
a('gemini 历史条目(2.0/1.5)标注未取证后原值不变', near(p('gemini-2.0-flash').cacheHit,0.025) && p('gemini-1.5-pro').output===10.5)

// ===== 2026-09-22 docs.x.ai/docs/pricing (Text API 表) 官方原文 —— Grok 整段补录 =====
// 官方口径: 每模型两档, 长上下文阈值 200k; ≥200k 输入/输出/缓存各 ×2。本表取主档(短上下文)。
// 交叉验证: 页面内嵌 __XAI_PUBLIC_MODELS__ 的 us-east-1/us-west-2 集群逐项吻合 (us-central-1 为 US 区域端点 ×1.1)。
a('BUG grok-4.7 官方 $2.00/$6.00/缓存 $0.50 (旧表无 grok 键 → 落默认价 $1/$2, 输出少算 3 倍)',
  p('grok-4.7').cacheMiss===2.0 && p('grok-4.7').output===6.0 && p('grok-4.7').cacheHit===0.50)
a('grok-4.6 与 4.7 同价 $2.00/$6.00/缓存 $0.50', p('grok-4.6').cacheMiss===2.0 && p('grok-4.6').output===6.0 && p('grok-4.6').cacheHit===0.50)
a('grok-4.5 官方 $2.00/$6.00/缓存 $0.30', p('grok-4.5').cacheMiss===2.0 && p('grok-4.5').output===6.0 && p('grok-4.5').cacheHit===0.30)
a('grok-4.3 官方 $1.25/$2.50/缓存 $0.20', p('grok-4.3').cacheMiss===1.25 && p('grok-4.3').output===2.5 && p('grok-4.3').cacheHit===0.20)
a('grok-4.20 三变体同价 $1.25/$2.50/缓存 $0.20',
  ['grok-4.20-0309-reasoning','grok-4.20-0309-non-reasoning','grok-4.20-multi-agent-0309']
    .every(k => p(k).cacheMiss===1.25 && p(k).output===2.5 && p(k).cacheHit===0.20))
a('grok-build-0.1 官方 $1.00/$2.00/缓存 $0.20 (输入输出恰好等于默认价, 缓存读旧为 0.1)',
  p('grok-build-0.1').cacheMiss===1.0 && p('grok-build-0.1').output===2.0 && p('grok-build-0.1').cacheHit===0.20)
a('grok-code-fast-1 为官方别名, 与 grok-build-0.1 同价', p('grok-code-fast-1').cacheMiss===1.0 && p('grok-code-fast-1').cacheHit===0.20)
a('grok 官方别名经安全后缀命中: -latest / -0825 / -0309',
  p('grok-4.3-latest').cacheMiss===1.25 && p('grok-code-fast-1-0825').cacheMiss===1.0 && p('grok-4.20-0309').cacheMiss===1.25)
a('未收录 grok(grok-3/grok-4/grok-4-fast)仍落默认价, 不假装有官方价',
  p('grok-3').cacheMiss===1 && p('grok-4').output===2 && p('grok-4-fast').cacheMiss===1)

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
// 2026-09-22 platform.xiaomimimo.com/docs/zh-CN/price/pay-as-you-go 官方原文 —— V2.6 系列当日发布, 与 V2.5 同价
a('BUG mimo-v2.6-flash 官方 ¥1/¥2/缓存 ¥0.02 (此前无键 → 落默认价 ¥7/¥14, 高估 7 倍)',
  p('mimo-v2.6-flash').cacheMiss===1 && p('mimo-v2.6-flash').output===2 && near(p('mimo-v2.6-flash').cacheHit,0.02))
a('BUG mimo-v2.6-pro 官方 ¥3/¥6/缓存 ¥0.025 (此前无键 → 落默认价 ¥7/¥14, 高估 2.33 倍)',
  p('mimo-v2.6-pro').cacheMiss===3 && p('mimo-v2.6-pro').output===6 && near(p('mimo-v2.6-pro').cacheHit,0.025))
a('mimo-v2.6-pro-ultraspeed 官方 ¥30/¥60/缓存 ¥0.25',
  p('mimo-v2.6-pro-ultraspeed').cacheMiss===30 && p('mimo-v2.6-pro-ultraspeed').output===60 && near(p('mimo-v2.6-pro-ultraspeed').cacheHit,0.25))
a('mimo v2.6 与 v2.5 实时档同价(官方原文两行同价)', p('mimo-v2.6-pro').cacheMiss===p('mimo-v2.5-pro').cacheMiss && p('mimo-v2.6-flash').cacheMiss===p('mimo-v2.5').cacheMiss)
a('mimo-v2.5 系键保留(官方 2026-10-21 10:00 下线, 仅供旧会话估算)',
  p('mimo-v2.5').cacheMiss===1 && p('mimo-v2.5-pro').cacheMiss===3)
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
a('R3 follow CNY: gpt-5.6-sol ×7 = 35/210 (随官方现价 5/30 更新)', pFollowCny('gpt-5.6-sol').cacheMiss===35 && pFollowCny('gpt-5.6-sol').output===210)
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


// ===== 2026-09-22 官方定价页复核新增条目 =====
// 来源: docs.bigmodel.cn/cn/guide/start/pricing (智谱) / help.aliyun.com/zh/model-studio/model-pricing (百炼)
//       platform.minimaxi.com/docs/guides/pricing-paygo / platform.stepfun.com/docs/zh/guides/pricing/details
a('G1 glm-5.3-flashx 官方 ¥2/¥7/缓存¥0.57', p('glm-5.3-flashx').cacheMiss===2 && p('glm-5.3-flashx').output===7 && p('glm-5.3-flashx').cacheHit===0.57)
a('G2 glm-5 官方 >=32K 档 ¥6/¥22/缓存¥1.5', p('glm-5').cacheMiss===6 && p('glm-5').output===22 && p('glm-5').cacheHit===1.5)
a('G3 glm-4.7 官方 [32K,200K) 档 ¥4/¥16/缓存¥0.8', p('glm-4.7').cacheMiss===4 && p('glm-4.7').output===16 && p('glm-4.7').cacheHit===0.8)
a('G4 glm-4.7-flashx 官方 ¥0.5/¥3/缓存¥0.1', p('glm-4.7-flashx').cacheMiss===0.5 && p('glm-4.7-flashx').output===3 && p('glm-4.7-flashx').cacheHit===0.1)
a('G5 glm-4.5-air 官方 [32K,128K) 档 ¥1.2/¥8', p('glm-4.5-air').cacheMiss===1.2 && p('glm-4.5-air').output===8)
a('G6 glm-4-air-250414 官方 ¥0.5/¥0.5/缓存¥0.25', p('glm-4-air-250414').cacheMiss===0.5 && p('glm-4-air-250414').cacheHit===0.25)
a('G7 glm-4-long 官方 ¥1/¥1/缓存¥0.5', p('glm-4-long').cacheMiss===1 && p('glm-4-long').output===1)
// 🔴 键名错配修复: 官方 GLM-4-Flash-250414 是免费、GLM-4-FlashX-250414 才是 ¥0.1/¥0.1 ——
//    旧表把 FlashX 的价挂在 glm-4-flash 上, 且 glm-4-flashx-250414 没有任何键能收(落 defaultPrices)。
a('G8 glm-4-flashx 官方 ¥0.1/¥0.1/缓存¥0.05', p('glm-4-flashx').cacheMiss===0.1 && p('glm-4-flashx').cacheHit===0.05)
a('G9 glm-4-flashx-250414 命中 FlashX 键(不再落默认价)', p('glm-4-flashx-250414').cacheMiss===0.1 && p('glm-4-flashx-250414').output===0.1)
a('G10 未收录模型才落默认价(对照)', p('zzz-not-a-real-model').cacheMiss!==0.1)
a('M1 minimax-m3 官方永久五折 ¥2.1/¥8.4/缓存¥0.42', p('minimax-m3').cacheMiss===2.1 && p('minimax-m3').output===8.4 && p('minimax-m3').cacheHit===0.42)
a('S1 step-5-preview 官方 ¥7/¥20/缓存¥0.35', p('step-5-preview').cacheMiss===7 && p('step-5-preview').output===20 && p('step-5-preview').cacheHit===0.35)
a('S2 step-1o-turbo-vision 官方 ¥2.5/¥8/缓存¥0.5', p('step-1o-turbo-vision').cacheMiss===2.5 && p('step-1o-turbo-vision').output===8 && p('step-1o-turbo-vision').cacheHit===0.5)
a('Q1 qwen3.8-max-prime 官方优速模式 ¥24/¥72', p('qwen3.8-max-prime').cacheMiss===24 && p('qwen3.8-max-prime').output===72)
a('Q2 qwen3.8-omni-flash 官方 ¥0.8/¥2.7/缓存¥0.1', p('qwen3.8-omni-flash').cacheMiss===0.8 && p('qwen3.8-omni-flash').output===2.7 && p('qwen3.8-omni-flash').cacheHit===0.1)
a('Q3 qwen3.5-plus 官方 ¥0.8/¥4.8', p('qwen3.5-plus').cacheMiss===0.8 && p('qwen3.5-plus').output===4.8)
// 全表红线 (AGENTS.md 第三节): 缓存命中价绝不能高于标准输入价
a('X1 全表 cacheHit <= cacheMiss', Object.entries(m.MODEL_PRICES).every(([,v]) => v.cacheHit <= v.cacheMiss))
// 新条目产地判定必须为国内 (决定按 CNY 原生价读)
a('X2 新增条目产地均判国内', ['glm-5','glm-4.7','glm-5.3-flashx','minimax-m3','step-5-preview','step-1o-turbo-vision','qwen3.8-max-prime','qwen3.5-plus'].every(k => m.modelRegion(k)==='国内'))
// ===== 2026-09-22 海外两家官方原文核对 (OpenAI / Anthropic, 均取自官方页内嵌 JSON 而非二手源) =====
a('OA1 gpt-6-astra 官方 $10 / cached $1 / $50', p('gpt-6-astra').cacheMiss===10 && p('gpt-6-astra').cacheHit===1 && p('gpt-6-astra').output===50)
a('OA2 gpt-5.6-terra 官方 $2/$0.2/$12 未变动', p('gpt-5.6-terra').cacheMiss===2 && p('gpt-5.6-terra').cacheHit===0.2 && p('gpt-5.6-terra').output===12)
a('OA3 gpt-5.6-luna 官方 $0.2/$0.02/$1.2 未变动', p('gpt-5.6-luna').cacheMiss===0.2 && p('gpt-5.6-luna').cacheHit===0.02 && p('gpt-5.6-luna').output===1.2)
a('AN1 claude-fable-5.1 官方 $10 / cached $0.25 / $50', p('claude-fable-5.1').cacheMiss===10 && p('claude-fable-5.1').cacheHit===0.25 && p('claude-fable-5.1').output===50)
a('AN2 claude-fable-5 官方 $10 / cached $1 / $50', p('claude-fable-5').cacheMiss===10 && p('claude-fable-5').cacheHit===1 && p('claude-fable-5').output===50)
a('AN3 claude-opus-4-8 官方 $5 / cached $0.5 / $25', p('claude-opus-4-8').cacheMiss===5 && p('claude-opus-4-8').cacheHit===0.5 && p('claude-opus-4-8').output===25)
a('AN4 claude-sonnet-4-5 官方 $3 / cached $0.30 / $15', p('claude-sonnet-4-5').cacheMiss===3 && p('claude-sonnet-4-5').cacheHit===0.3 && p('claude-sonnet-4-5').output===15)
a('AN5 既有四条 Anthropic 条目仍与官方一致(未被误改)', p('claude-opus-5').cacheMiss===5 && p('claude-opus-5').cacheHit===0.5 && p('claude-sonnet-5').cacheMiss===2 && p('claude-haiku-4-5').cacheMiss===1 && p('claude-sonnet-4-6').cacheMiss===3)
a('AN6 Anthropic 缓存读价一律低于输入价(官方口径 10%, Fable5.1 仅 2.5%)', ['claude-opus-5','claude-sonnet-5','claude-haiku-4-5','claude-fable-5.1','claude-fable-5','claude-opus-4-8','claude-sonnet-4-5'].every(k => p(k).cacheHit < p(k).cacheMiss))
// ===== 缓存写入价 (2026-09-22 官方原文: Anthropic 一律 = 输入 ×125%) =====
a('CW1 Anthropic 缓存写 = 输入 ×125%', ['claude-opus-5','claude-sonnet-5','claude-sonnet-4-6','claude-haiku-4-5','claude-fable-5.1','claude-fable-5','claude-opus-4-8','claude-sonnet-4-5'].every(k => Math.abs(m.MODEL_PRICES[k].cacheWrite - m.MODEL_PRICES[k].cacheMiss*1.25) < 1e-9))
a('CW2 未给 cacheWrite 的条目保持 undefined (回落 cacheMiss, 旧行为不变)', m.MODEL_PRICES['glm-5.3'].cacheWrite === undefined && m.MODEL_PRICES['gpt-5.6-terra'].cacheWrite === undefined && m.MODEL_PRICES['kimi-k3'].cacheWrite === undefined)
// ===== 阿里百炼缓存规则 (官方明文: 显式缓存命中 = 标准输入价 10%) =====
a('Q4 qwen-plus cacheHit = 输入 ×10% → 0.08 (旧值 0.4=50% 无官方依据)', Math.abs(p('qwen-plus').cacheHit - 0.08) < 1e-9)
a('Q5 qwen-turbo cacheHit = 输入 ×10% → 0.03 (旧值 0.15=50%)', Math.abs(p('qwen-turbo').cacheHit - 0.03) < 1e-9)
a('Q6 阿里 qwen 系 cacheHit 一律 = 输入 ×10% (官方规则; 3.8-max/flash 例外不在此列)', ['qwen3.7-max','qwen3.7-plus','qwen3.7-flash','qwen3.8-27b','qwen3.6-plus','qwen-max','qwen-plus','qwen-turbo','qwen3.5-plus','qwen3.8-max-prime'].every(k => Math.abs(m.MODEL_PRICES[k].cacheHit - m.MODEL_PRICES[k].cacheMiss * 0.1) < 1e-9))
a('Q7 官方单列缓存价的 qwen3.8-omni-flash 保留官方值 0.1', Math.abs(p('qwen3.8-omni-flash').cacheHit - 0.1) < 1e-9)
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
// v1.3.2: 断言失败时以非 0 退出, 否则 CI(GitHub Actions)拦不住回归 —— 原来一律 exit 0
if (fail > 0) process.exitCode = 1
