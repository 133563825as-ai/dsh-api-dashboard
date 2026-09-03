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
src=src.replace(marker,`    exports.__test = { modelToPlatform, metaFor };
`+marker)
new Function('window','document','navigator','localStorage',src)(globalThis.window,doc,{hardwareConcurrency:8,language:'zh-CN'},globalThis.localStorage)
const T=captured.__test
let pass=0,fail=0
const a=(n,c)=>{if(c){pass++}else{fail++;console.log('FAIL '+n)}}
a('mimo→mimo', T.modelToPlatform('mimo-v2.5')==='mimo')
a('mimo-pro→mimo', T.modelToPlatform('mimo-v2.5-pro')==='mimo')
a('metaFor mimo', T.metaFor('mimo').name==='MiMo')
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
