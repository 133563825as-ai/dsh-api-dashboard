import { readFileSync } from 'node:fs'

const react = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: (children.length===1&&Array.isArray(children[0])?children[0]:children).flat(Infinity).filter(c=>c!=null&&c!==false) }),
  useState: (init) => [init, () => {}],
  useRef: (init) => ({ current: init }),
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useSyncExternalStore: (sub, get) => get(),
}
const mkEl = () => ({ tag:'', className:'', dataset:{}, textContent:'', style:{ setProperty(){}, removeProperty(){} }, classList:{ add(){}, remove(){}, contains:()=>false }, appendChild(){}, removeChild(){}, addEventListener(){}, removeEventListener(){}, setPointerCapture(){}, releasePointerCapture(){}, contains:()=>false, offsetWidth:120, offsetHeight:60, getBoundingClientRect:()=>({left:10,top:20,width:100,height:100}), parentNode:null })
const doc = { head:{ appendChild(){} }, body:{ appendChild(){}, removeChild(){}, addEventListener(){}, removeEventListener(){}, contains:()=>true }, documentElement:{ classList:{ add(){} } }, createElement: mkEl, addEventListener(){}, removeEventListener(){}, getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], hidden:false }
globalThis.document = doc
globalThis.window = { addEventListener(){}, removeEventListener(){}, innerWidth:412, innerHeight:892, location:{origin:'http://x'}, confirm:()=>false, matchMedia:()=>({matches:false,addEventListener(){}}) }
const nav = { hardwareConcurrency:8, language:'zh-CN' }
globalThis.localStorage = { getItem:()=>'', setItem(){} }
globalThis.fetch = async () => ({ ok:true, status:200, json: async () => ({ ok:true }) })
globalThis.Audio = class { constructor(){ this.volume=0 } play(){ return Promise.resolve() } }
globalThis.requestAnimationFrame = (fn) => { fn(0); return 1 }
globalThis.cancelAnimationFrame = () => {}

let captured = null
globalThis.window.__ModuleLoader__ = { load({factory}){ captured = factory((name)=>{ if(name==='react') return react; if(name==='@deepseek-ai/dsh-client-ui-primitives') return {}; throw new Error('未知依赖 '+name) }) } }

let src = readFileSync(new URL('../client/client.js', import.meta.url).pathname, 'utf8')
const marker = '    exports.apply = apply;'
if (!src.includes(marker)) throw new Error('找不到导出锚点')
src = src.replace(marker, `    exports.__test = { formatMoney, formatSessionCost, getLevel, acquireWhaleWidget, releaseWhaleWidget, getWhaleRefs: () => whaleRefs, getWidget: () => whaleWidget };
` + marker)
new Function('window','document','navigator','localStorage',src)(globalThis.window, doc, nav, globalThis.localStorage)

const T = captured.__test
let pass=0, fail=0
const assert=(n,c)=>{ if(c){pass++}else{fail++;console.log('FAIL '+n)} }

// C2 formatMoney 负数/零
assert('C2 -0.19 → ¥-0.190 (3位)', T.formatMoney(-0.19, 'CNY') === '¥-0.190')
assert('C2 -5.5 → ¥-5.50 (2位)', T.formatMoney(-5.5, 'CNY') === '¥-5.50')
assert('C2 0 → $0.00 (2位)', T.formatMoney(0, 'USD') === '$0.00')

// C12 引用计数
T.acquireWhaleWidget()
assert('C12 首次 acquire refs=1', T.getWhaleRefs() === 1)
assert('C12 首次 acquire widget 存在', T.getWidget() != null)
T.acquireWhaleWidget()
assert('C12 二次 acquire refs=2', T.getWhaleRefs() === 2)
T.releaseWhaleWidget()
assert('C12 释放一次 refs=1 仍存在', T.getWhaleRefs() === 1 && T.getWidget() != null)
T.releaseWhaleWidget()
assert('C12 释放两次 refs=0 已卸载', T.getWhaleRefs() === 0 && T.getWidget() == null)


// ===== v1.3.2 会话消耗混合货币格式化 (海外模型独立币种) =====
const F = T.formatSessionCost
assert('C13 无数据返回 null', F(null) === null && F(undefined) === null)
assert('C13 waiting 返回 null', F({ cost: 0, currency: 'CNY', waiting: true }) === null)
// 单币种: 行为必须与 v1.2.6 一致
assert('C13 单币种 CNY 两位', F({ cost: 3.4, currency: 'CNY', costByCurrency: { CNY: 3.4 } }).text === '¥3.40')
assert('C13 单币种 不标 mixed', F({ cost: 3.4, currency: 'CNY', costByCurrency: { CNY: 3.4 } }).mixed === false)
assert('C13 缺 costByCurrency 退回单段(旧 bundle 兼容)', F({ cost: 12.5, currency: 'USD' }).text === '$12.50')
// 混合: 主货币在前, 加号拼接, 不折算
const mix = F({ cost: 3.4, currency: 'CNY', costByCurrency: { USD: 12.5, CNY: 3.4 } })
assert('C13 混合两段拼接 ¥3.40+$12.50', mix.text === '¥3.40+$12.50')
assert('C13 混合标记 mixed', mix.mixed === true)
assert('C13 混合 title 注明未折算', mix.title.indexOf('未按汇率合并') >= 0)
// 主货币为 USD 时, USD 段排前
const mix2 = F({ cost: 12.5, currency: 'USD', costByCurrency: { CNY: 3.4, USD: 12.5 } })
assert('C13 主货币 USD 时 $ 段在前', mix2.text === '$12.50+¥3.40')
// 零值段被过滤掉, 不显示 +¥0
assert('C13 零值段被过滤', F({ cost: 0, currency: 'CNY', costByCurrency: { CNY: 0, USD: 2 } }).text === '$2.00')
// 小额精度分档保持原规则
assert('C13 小额 6 位', F({ cost: 0.00005, currency: 'CNY', costByCurrency: { CNY: 0.00005 } }).text === '¥0.000050')
// hasValue: 开启海外独立币种后主货币段为 0 时, 详情页不能误显示「—」
assert('C13 纯海外会话 hasValue=true (主货币段为0)', F({ cost: 0, currency: 'CNY', costByCurrency: { USD: 14.03 } }).hasValue === true)
assert('C13 纯海外会话文案就是 $14.03', F({ cost: 0, currency: 'CNY', costByCurrency: { USD: 14.03 } }).text === '$14.03')
assert('C13 全零 hasValue=false', F({ cost: 0, currency: 'CNY', costByCurrency: {} }).hasValue === false)
assert('C13 单币种非零 hasValue=true', F({ cost: 3.4, currency: 'CNY', costByCurrency: { CNY: 3.4 } }).hasValue === true)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
