import { readFileSync } from 'node:fs'
const react = {
  createElement:(t,p,...c)=>({type:t,props:p||{},children:(c.length===1&&Array.isArray(c[0])?c[0]:c).flat(Infinity).filter(x=>x!=null&&x!==false)}),
  useState:(i)=>[i,()=>{}], useRef:(i)=>({current:i}), useEffect:()=>{}, useMemo:(f)=>f(), useCallback:(f)=>f, useSyncExternalStore:(s,g)=>g(),
}
const mkEl=()=>({tag:'',className:'',dataset:{},textContent:'',style:{setProperty(){},removeProperty(){}},classList:{add(){},remove(){},contains:()=>false},appendChild(){},removeChild(){},addEventListener(){},removeEventListener(){},setPointerCapture(){},releasePointerCapture(){},contains:()=>false,offsetWidth:120,offsetHeight:60,getBoundingClientRect:()=>({left:10,top:20,width:100,height:100}),parentNode:null})
const doc={head:{appendChild(){}},body:{appendChild(){},removeChild(){},addEventListener(){},removeEventListener(){},contains:()=>true},documentElement:{classList:{add(){}}},createElement:mkEl,addEventListener(){},removeEventListener(){},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],hidden:false}
globalThis.document=doc
globalThis.window={addEventListener(){},removeEventListener(){},innerWidth:412,innerHeight:892,location:{origin:'http://x'},confirm:()=>false,matchMedia:()=>({matches:false,addEventListener(){}})}
globalThis.localStorage={getItem:()=>'',setItem(){}}
globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({ok:true})})
globalThis.Audio=class{constructor(){this.volume=0}play(){return Promise.resolve()}}
globalThis.requestAnimationFrame=(f)=>{f(0);return 1}
globalThis.cancelAnimationFrame=()=>{}
let captured=null
globalThis.window.__ModuleLoader__={load({factory}){captured=factory((n)=>{if(n==='react')return react;if(n==='@deepseek-ai/dsh-client-ui-primitives')return {};throw new Error('未知依赖 '+n)})}}
let src=readFileSync(new URL('../client/client.js', import.meta.url).pathname, 'utf8')
const marker='    exports.apply = apply;'
src=src.replace(marker,`    exports.__test = { isRelayProvider, barAmountText, modelToPlatform };
`+marker)
new Function('window','document','navigator','localStorage',src)(globalThis.window,doc,{hardwareConcurrency:8,language:'zh-CN'},globalThis.localStorage)
const T=captured.__test
let pass=0,fail=0
const a=(n,c)=>{if(c){pass++}else{fail++;console.log('FAIL '+n)}}
const t=(k)=>k

// ==== 三层 provider 判定 (开源化改造后) ====
// 服务端下发的判定素材: providerKinds 来自 settings.yaml 的 baseURL 域名比对
const cfg = {
  officialProviders: ['myofficial', 'DS-CN'],
  providerKinds: { zhipu:'official', jiyuan:'relay', new:'relay', sw:'relay', dshzuoxhe:'relay' },
}

// 第 1 层: 用户显式名单 (最高优先级, 覆盖后缀规则与自动判定)
a('L1 用户名单 myofficial 是官方', T.isRelayProvider('myofficial', cfg)===false)
a('L1 名单大小写不敏感', T.isRelayProvider('ds-cn', cfg)===false)
a('L1 覆盖第2层 relay 判定', T.isRelayProvider('new', { officialProviders:['new'], providerKinds:{ new:'relay' } })===false)

// 第 2 层: baseURL 域名判定
a('L2 zhipu(open.bigmodel.cn) 是官方', T.isRelayProvider('zhipu', cfg)===false)
a('L2 jiyuan 是中转站', T.isRelayProvider('jiyuan', cfg)===true)
a('L2 new 是中转站', T.isRelayProvider('new', cfg)===true)
a('L2 sw 是中转站', T.isRelayProvider('sw', cfg)===true)
a('L2 dshzuoxhe 是中转站', T.isRelayProvider('dshzuoxhe', cfg)===true)
a('L2 覆盖第3层后缀规则(relay 胜出)', T.isRelayProvider('fake', { providerKinds:{ fake:'relay' } })===true)

// 第 3 层: -official / _official 后缀 (DSH 官方插件命名约定)
a('L3 deepseek-official 是官方', T.isRelayProvider('deepseek-official', cfg)===false)
a('L3 deepseek_official 是官方', T.isRelayProvider('deepseek_official', cfg)===false)

// 默认: 三层都不命中 → 按中转站 (保守, 不显示可能错的余额)
a('默认未知 provider 按中转站', T.isRelayProvider('whatever', cfg)===true)
a('xiaomi(无 baseURL) 按中转站', T.isRelayProvider('xiaomi', cfg)===true)
a('opencode(无 baseURL) 按中转站', T.isRelayProvider('opencode', cfg)===true)
a('裸 deepseek(无判定素材) 按中转站', T.isRelayProvider('deepseek', {})===true)
a('空 provider 不算中转站', T.isRelayProvider('', cfg)===false)
a('无 config 也不崩', T.isRelayProvider('new')===true && T.isRelayProvider('a-official')===false)
a('config 字段类型异常不崩', T.isRelayProvider('new', { officialProviders:'x', providerKinds:5 })===true)

// ==== 金额显示 ====
const bal={status:'ok',total:-0.19,currency:'CNY'}
a('官方 deepseek-official 显示金额', T.barAmountText(bal,t,T.isRelayProvider('deepseek-official',cfg))==='¥-0.190')
a('中转站 new 显示—', T.barAmountText(bal,t,T.isRelayProvider('new',cfg))==='—')
// 平台切换仍正常
a('deepseek 模型能切平台', T.modelToPlatform('deepseek-v4-pro-0813')==='deepseek')
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
// v1.3.2: 断言失败时以非 0 退出, 否则 CI(GitHub Actions)拦不住回归 —— 原来一律 exit 0
if (fail > 0) process.exitCode = 1
