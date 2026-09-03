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
src=src.replace(marker,`    exports.__test = { modelToPlatform, isRelayProvider, barAmountText };
`+marker)
new Function('window','document','navigator','localStorage',src)(globalThis.window,doc,{hardwareConcurrency:8,language:'zh-CN'},globalThis.localStorage)
const T=captured.__test
let pass=0,fail=0
const a=(n,c)=>{if(c){pass++}else{fail++;console.log('FAIL '+n)}}
const t=(k)=>k
// 模型名映射: 不再受 provider 影响, 状态条能跟着切
a('deepseek→deepseek(中转站也切)', T.modelToPlatform('deepseek-v4-pro-0813')==='deepseek')
a('claude→claude', T.modelToPlatform('claude-opus-5')==='claude')
a('mimo→mimo', T.modelToPlatform('mimo-v2.5')==='mimo')
a('glm→zhipu', T.modelToPlatform('glm-5.2')==='zhipu')
// provider 判定
a('new是中转站', T.isRelayProvider('new')===true)
a('jiyuanlvdong是中转站', T.isRelayProvider('jiyuanlvdong')===true)
a('dshzuoxhe是中转站', T.isRelayProvider('dshzuoxhe')===true)
a('xiaomi是中转站', T.isRelayProvider('xiaomi')===true)
a('zhipu是官方(L2域名)', T.isRelayProvider('zhipu', { providerKinds: { zhipu: 'official' } })===false)
a('deepseek是官方(L1名单)', T.isRelayProvider('deepseek', { officialProviders: ['deepseek'] })===false)
a('裸deepseek默认中转站', T.isRelayProvider('deepseek', {})===true)
a('空provider不算中转站', T.isRelayProvider('')===false)
// 金额显示
const okBal={status:'ok',total:-0.19,currency:'CNY'}
a('官方显示金额', T.barAmountText(okBal,t,false)==='¥-0.190')
a('中转站显示—', T.barAmountText(okBal,t,true)==='—')
const nbBal={status:'no-balance-api'}
a('无余额品牌显示—', T.barAmountText(nbBal,t,false)==='—')
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
