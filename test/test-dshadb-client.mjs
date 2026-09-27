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
// 元素树可追踪: appendChild 记 children/parentNode, createElement 记下每个建出来的元素 ——
// 用来断言挂件的 DOM 接线(抓取层必须挂在鱼身内部, 否则事件冒泡不到拖拽处理器)。
const created = []
const mkEl = () => ({ tag:'', className:'', dataset:{}, textContent:'', style:{ setProperty(){}, removeProperty(){} }, classList:{ add(){}, remove(){}, contains:()=>false }, appendChild(c){ if(!this.children) this.children=[]; this.children.push(c); if(c) c.parentNode=this }, removeChild(){}, addEventListener(){}, removeEventListener(){}, setPointerCapture(){}, releasePointerCapture(){}, contains:()=>false, offsetWidth:120, offsetHeight:60, getBoundingClientRect:()=>({left:10,top:20,width:100,height:100}), parentNode:null })
const doc = { head:{ appendChild(){} }, body:{ appendChild(){}, removeChild(){}, addEventListener(){}, removeEventListener(){}, contains:()=>true }, documentElement:{ classList:{ add(){} } }, createElement: (tag)=>{ const el = mkEl(); el.tag = tag; created.push(el); return el }, addEventListener(){}, removeEventListener(){}, getElementById:()=>null, querySelector:()=>null, querySelectorAll:()=>[], hidden:false }
globalThis.document = doc
globalThis.window = { addEventListener(){}, removeEventListener(){}, innerWidth:412, innerHeight:892, location:{origin:'http://x'}, confirm:()=>false, matchMedia:()=>({matches:false,addEventListener(){}}) }
const nav = { hardwareConcurrency:8, language:'zh-CN' }
globalThis.localStorage = { getItem:()=>'', setItem(){} }
globalThis.fetch = async () => ({ ok:true, status:200, json: async () => ({ ok:true }) })
globalThis.Audio = class { constructor(){ this.volume=0 } play(){ return Promise.resolve() } }
globalThis.requestAnimationFrame = (fn) => { fn(0); return 1 }
globalThis.cancelAnimationFrame = () => {}

// v1.5.0-desktop-preview.5: 软键盘避让要用 visualViewport + :root 上的 CSS 变量。
// 夹具给 window.visualViewport, document.documentElement.style 记下 setProperty/removeProperty,
// rAF 上面已经做成同步执行 —— 于是 schedule() 一调就能立刻观察结果。
const vvListeners = {}
const fakeVV = {
  height: 892, offsetTop: 0, scale: 1,
  addEventListener(t, f){ (vvListeners[t] = vvListeners[t] || []).push(f) },
  removeEventListener(t, f){ vvListeners[t] = (vvListeners[t] || []).filter((x) => x !== f) },
}
const rootStyleProps = {}
doc.documentElement.style = {
  setProperty(k, v){ rootStyleProps[k] = v },
  removeProperty(k){ delete rootStyleProps[k] },
}
globalThis.window.visualViewport = fakeVV

let captured = null
globalThis.window.__ModuleLoader__ = { load({factory}){ captured = factory((name)=>{ if(name==='react') return react; if(name==='@deepseek-ai/dsh-client-ui-primitives') return {}; throw new Error('未知依赖 '+name) }) } }

let src = readFileSync(new URL('../client/client.js', import.meta.url).pathname, 'utf8')
const marker = '    exports.apply = apply;'
if (!src.includes(marker)) throw new Error('找不到导出锚点')
src = src.replace(marker, `    exports.__test = { formatMoney, formatSessionCost, getLevel, acquireWhaleWidget, releaseWhaleWidget, getWhaleRefs: () => whaleRefs, getWidget: () => whaleWidget, keyboardInset, installKeyboardInsetVar };
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

// C14 大肥鱼抓取层(让路层)的 DOM 接线 —— 这是"改一行就悄悄失效"的地方, 用真建出来的元素钉住:
// 抓取层必须挂在 .dshadb-whale-body **内部**, 这样 pointerdown 才会冒泡到 body 上已有的拖拽处理器;
// 挂在 root 直下的话手机壳确实会让路, 但鱼也拖不动了。
const byClass = (c) => created.find((el) => el.className === c)
const kids = (el) => (el && el.children) || []
const grabEl = byClass('dshadb-whale-grab'), bodyEl = byClass('dshadb-whale-body'), imgEl = byClass('dshadb-whale-img'), rootEl = byClass('dshadb-whale')
assert('C14 抓取层已创建', grabEl != null)
assert('C14 抓取层挂在鱼身(body)内部', grabEl != null && grabEl.parentNode === bodyEl)
assert('C14 抓取层不在 root 直下 (否则事件冒泡不到拖拽处理器)', rootEl != null && !kids(rootEl).includes(grabEl))
assert('C14 抓取层在图片之后 (盖在鱼身上才接得到起手)', kids(bodyEl).indexOf(grabEl) > kids(bodyEl).indexOf(imgEl))
assert('C14 抓取层带 1 个 0 高度守卫子元素', kids(grabEl).length === 1 && kids(grabEl)[0].className === 'dshadb-whale-grab-guard')
assert('C14 拖拽处理器仍绑在 body 上', typeof bodyEl.addEventListener === 'function')
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

// ==========================================================================
// C15 软键盘避让 (v1.5.0-desktop-preview.5, 报告 §2.2)
// 真机实测: 键盘 242px, 布局视口 787.2, 键盘后可视 545 —— 面板底部 26% 被盖住。
// keyboardInset() 是纯函数, 这里把三个守卫(缩放 / 阈值 / 正常)都钉住;
// installKeyboardInsetVar() 再用夹具的 visualViewport 验证"真的写进了 --dshadb-kb"。
// ==========================================================================
const KI = T.keyboardInset
assert('C15 没有键盘(可视区==布局视口) → 0', KI({ innerHeight: 892, vvHeight: 892 }) === 0)
assert('C15 真机数据 787.2 → 545 得 242', KI({ innerHeight: 787.2, vvHeight: 545, vvOffsetTop: 0, vvScale: 1 }) === 242)
assert('C15 差值 <80px 当噪声(地址栏收缩), 不动布局', KI({ innerHeight: 892, vvHeight: 892 - 79 }) === 0)
assert('C15 差值正好 80px 算键盘', KI({ innerHeight: 892, vvHeight: 892 - 80 }) === 80)
assert('C15 双指缩放(scale≠1) → 0 (visualViewport 也会变小, 但那不是键盘)',
  KI({ innerHeight: 892, vvHeight: 500, vvScale: 1.6 }) === 0)
assert('C15 缩放来回抖动(scale 1.005) 仍按 1 处理', KI({ innerHeight: 892, vvHeight: 892 - 242, vvScale: 1.005 }) === 242)
assert('C15 offsetTop 参与计算(可视区被顶上去了要减掉)',
  KI({ innerHeight: 892, vvHeight: 892 - 242 - 30, vvOffsetTop: 30 }) === 242)
assert('C15 输入非法/缺失 → 0, 不抛异常',
  KI(undefined) === 0 && KI({}) === 0 && KI({ innerHeight: NaN, vvHeight: 100 }) === 0)
assert('C15 键盘高度被夹在 [0, 布局视口] 之间(异常值不把面板顶到屏幕外)',
  KI({ innerHeight: 500, vvHeight: -400 }) === 500)

const dispose = T.installKeyboardInsetVar()
assert('C15 初始无键盘时不留 --dshadb-kb', rootStyleProps['--dshadb-kb'] === undefined)
fakeVV.height = 892 - 242
;(vvListeners.resize || []).forEach((f) => f())
assert('C15 键盘弹出后写入 --dshadb-kb=242px', rootStyleProps['--dshadb-kb'] === '242px')
fakeVV.height = 892
;(vvListeners.resize || []).forEach((f) => f())
assert('C15 键盘收起后移除变量(回到 v1.4.2 行为)', rootStyleProps['--dshadb-kb'] === undefined)
dispose()
assert('C15 dispose 摘掉监听', (vvListeners.resize || []).length === 0 && (vvListeners.scroll || []).length === 0)

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
// v1.3.2: 断言失败时以非 0 退出, 否则 CI(GitHub Actions)拦不住回归 —— 原来一律 exit 0
if (fail > 0) process.exitCode = 1
