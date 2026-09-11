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
src=src.replace(marker,`    exports.__test = { modelToPlatform, isRelayProvider, barAmountText, buildSubagentRow, formatSessionCost };
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
a('未知名 provider 默认按中转站', T.isRelayProvider('relay-one')===true)
a('未知名 provider(带数字) 默认按中转站', T.isRelayProvider('relay2')===true)
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

// ===== v1.4.0 子代理消耗行 (换行显示, 左→右按创建顺序) =====
a('无子代理 → null', T.buildSubagentRow({currency:'CNY',subagents:[]})===null)
a('字段缺失 → null', T.buildSubagentRow({currency:'CNY'})===null && T.buildSubagentRow(undefined)===null)
const row=T.buildSubagentRow({currency:'CNY',subagents:[
  {id:'c1',label:'researcher',mode:'continuable',cost:8,costByCurrency:{CNY:8},models:['glm-5.3']},
  {id:'c2',label:'worker',mode:'one-shot',cost:1,costByCurrency:{CNY:1},models:['mimo-v2.5']},
]})
a('有子代理 → 渲染一行', row!==null && row.props.className==='dshadb_subs')
const chips=row.children
a('条目数 = 子代理数', chips.length===2)
a('顺序与服务端一致 (不重排)', chips[0].props.title.includes('researcher') && chips[1].props.title.includes('worker'))
const nameOf=(chip)=>[].concat(chip.children.find(c=>c.props.className==='dshadb_sub_name').children).join('')
const amtOf=(chip)=>[].concat(chip.children.find(c=>c.props.className==='dshadb_sub_amt').children).join('')
a('显示子代理名', nameOf(chips[0])==='researcher' && nameOf(chips[1])==='worker')
a('显示金额 (¥8 / ¥1)', amtOf(chips[0])==='~¥8.00' && amtOf(chips[1])==='~¥1.00')
a('title 标注模式', chips[0].props.title.includes('可续聊子代理') && chips[1].props.title.includes('一次性子代理'))
a('title 带模型名', chips[0].props.title.includes('glm-5.3'))
// 海外子代理走原生 USD, 不折算成 ¥
const usdRow=T.buildSubagentRow({currency:'CNY',subagents:[{id:'c3',label:'claude-bot',mode:'continuable',cost:5,costByCurrency:{USD:5},models:['claude-opus-5']}]})
a('海外子代理按 $ 显示', amtOf(usdRow.children[0])==='~$5.00')
// 名字缺失 / 零消耗回落
const anon=T.buildSubagentRow({currency:'CNY',subagents:[{id:'c9',mode:'one-shot',cost:0,costByCurrency:{}}]})
a('缺 label → 显示「子代理」', nameOf(anon.children[0])==='子代理')
a('零消耗 → ~—', amtOf(anon.children[0])==='~—')
// ===== v1.4.0 子代理胶囊 · 长按详情 =====
// 手机上 title 根本不显示(长按弹的是系统「选择/复制」菜单), 所以完整详情必须
// 同时写进 data-tip, 并由插件自己的 pointerdown 计时器弹 .dshadb_subtip 浮层。
a('胶囊带 data-tip (长按浮层读它)', chips[0].props['data-tip'].includes('researcher') && chips[0].props['data-tip'].includes('glm-5.3'))
a('data-tip 带消耗明细', chips[0].props['data-tip'].includes('消耗'))
a('data-tip 带短 id', chips[0].props['data-tip'].includes('ID c1'))
a('data-tip 与 title 同源', chips[0].props['data-tip']===chips[0].props.title)
a('胶囊挂了 ref (用于绑长按)', typeof chips[0].props.ref==='function')
const noId=T.buildSubagentRow({currency:'CNY',subagents:[{label:'x',mode:'one-shot',cost:1,costByCurrency:{CNY:1}}]})
a('无 id → data-tip 不带 ID 行', !noId.children[0].props['data-tip'].includes('ID '))
a('无 id 的 key 回落不炸', noId.children[0].props.key==='s0')
// 样式侧: 系统复制菜单必须被压掉, 否则浮层会和复制菜单一起弹
a('胶囊禁用系统长按菜单', /\.dshadb_sub\{[^}]*touch-callout:none/.test(src))
a('胶囊禁用文本选择', /\.dshadb_sub\{[^}]*user-select:none/.test(src))
a('浮层是 fixed 定位', /\.dshadb_subtip\{[^}]*position:fixed/.test(src))
a('浮层 z-index 高过抽屉(99999)', /\.dshadb_subtip\{[^}]*z-index:100000/.test(src))
a('浮层用 textContent 写内容', src.includes('el.textContent = text'))
a('浮层只读文本, 不解析 HTML', /\.dshadb_subtip\{[^}]*pointer-events:none/.test(src))
a('长按时长常量存在', /const SUBTIP_LONG_PRESS_MS = \d+/.test(src))
a('长按绑 pointerdown 且位移可取消', src.includes('bindSubagentTip') && /pointermove/.test(src))
a('再压一道系统右键/长按菜单', src.includes('addEventListener("contextmenu"'))
a('浮层超时/点别处可收起', src.includes('hideSubagentTip') && src.includes('setTimeout(hideSubagentTip'))

// ===== v1.4.0 大肥鱼挂件 · 面板开着时锁触摸 =====
// 挂件是 body 的直接子元素(z-index 9600), 设置面板嵌在 DSH 的 composer dock 里 ——
// 面板一旦被某个祖先关进更低的层叠上下文, 挂件就会盖在面板上, 拖「身体大小/露出比例」
// 滑块时实际拖的是挂件(用户反馈「滑动的时候容易把侧边栏拉过来」)。
a('挂件锁态样式存在 (只关交互不隐藏)', /\.dshadb-whale-locked \.dshadb-whale-body\{[^}]*pointer-events:none/.test(src))
a('挂件 API 暴露 setLocked', /setLocked: function \(locked\)/.test(src))
a('setLocked 用 class 切换', src.includes('"dshadb-whale-locked"'))
a('有模块级 setWhaleLocked + 记住状态', src.includes('function setWhaleLocked(') && src.includes('var whaleLocked = false'))
a('挂件挂载时立刻套用锁定态', src.includes('if (whaleLocked) root.classList.add("dshadb-whale-locked")'))
a('onDown 再兜一道 (防 pointer-events 被覆盖)', src.includes('classList.contains("dshadb-whale-locked")'))
// v1.4.1 定稿: 维护者先反馈「设置里打开大肥鱼后拖不动」, 随后明确要求**全部放开** ——
// 现在任何界面下都不自动上锁; 锁的机制保留着, 需要时可改回 setWhaleLocked(view !== "bar")。
a('任何界面都不自动锁挂件(能随时拖鱼)', src.includes('setWhaleLocked(false)'))
a('不再按界面自动加锁', !src.includes('setWhaleLocked(overlayOpen)') && !src.includes('setWhaleLocked(whaleLockOverlay)'))
a('锁定机制仍保留(可随时恢复)', src.includes('function setWhaleLocked(') && src.includes('.dshadb-whale-locked'))
// 滑块触摸区要够高(用户原话「高度要高于他」), 免得贴着卡片边缘起手
a('大肥鱼滑块高度 ≥ 32px', /\.dshadb_wf_range\{[^}]*height:3[2-9]px/.test(src))
a('滑块圆点同步放大', /\.dshadb_wf_range::-webkit-slider-thumb\{[^}]*width:24px/.test(src))

// ===== v1.4.0 设置面板: 「来自 DSH 的中转站」列表收进折叠层 =====
// 维护者要求「跟首页一样的折叠方法」→ 直接复用首页分组组件 GroupSection, 默认收起。
// (上一轮误把「自动判定结果」折叠了, 已改回平铺 —— 那条不是要折的东西。)
a('自动判定结果改回平铺 (不再折叠)', !src.includes('dshadb_kinds_head') && !src.includes('showKinds'))
a('DSH 中转站列表复用首页分组折叠', src.includes('react.createElement(GroupSection, {') && src.includes('label: t("settings.dshProviders")'))
a('DSH 折叠状态默认收起', src.includes('const [showDsh, setShowDsh] = react.useState(false)'))
a('DSH 分组表头显示条数', src.includes('count: dshProviders.length'))
a('开关与说明留在折叠体里', src.includes('settings.dshProvidersHint'))

// ===== v1.4.0 侧滑守卫: 我们面板开着时, 手机壳不许把手势吃成「开侧边栏」 =====
// dsh-web-mobile 的 sidebar-swipe 在 document **捕获**阶段识别手势: 起手点落在屏幕左侧
// 45% 内 + 横向位移占优 → 直接开侧边栏(所以先于我们的监听器, 拦不住)。
// 它的 beginStroke 留了一条让路规则: 起手元素若属于「真·横向滚动容器」
// (overflow-x 为 auto/scroll 且 scrollWidth > clientWidth + 1) 就放弃识别。
// 我们给遮罩补 2px **不可见**横向溢出, 让整块面板都落进让路条件。
a('遮罩成为横向可滚动容器', /\.dshadb_scrim\{[^}]*overflow-x:auto/.test(src))
a('遮罩带 2px 不可见横向溢出', /\.dshadb_swipeguard\{[^}]*width:calc\(100% \+ 2px\)/.test(src))
a('守卫元素零高度不占位', /\.dshadb_swipeguard\{[^}]*height:0/.test(src))
a('三个遮罩(看板/详情/设置)都插了守卫', (src.match(/className: "dshadb_swipeguard"/g) || []).length === 3)

// ===== v1.4.0 刷新间隔下限 1 秒 =====
a('输入框 min=1', /type: "number", min: 1, max: 60, step: 1/.test(src))
a('客户端把 5 秒的下限也一起改了', !src.includes('Math.max(Number(e.target.value) || 5, 5)'))
a('轮询间隔接受 1 秒', src.includes('clientPollIntervalMs >= 1000'))

// ===== 大肥鱼本体给手机壳侧滑手势让路 =====
// 与面板同一条让路规则(findHorizontalScroller): dsh-web-mobile 的 sidebar-swipe 在 document
// **捕获**阶段判定「起手点在屏幕左侧 45% 内 + 向右 ≥16% 屏宽」= 开侧边栏。
// 挂件停在屏幕左侧 45% 以内时(典型: 左边缘吸附位)正是这条带子, 于是拖鱼会被判成开抽屉 ——
// 挂件自己的拖拽同时照常执行, 用户看到的就是「拖着鱼把侧边栏拉出来了」(维护者反馈)。
// 修法: 在 .dshadb-whale-body 里垫一层透明抓取层, 让它自己是「真·横向滚动容器」(2px 不可见溢出)。
// 放在 body **内部**是为了让 pointerdown 照常冒泡到 body 上已有的拖拽处理器, 不动拖拽代码。
a('挂件抓取层是横向可滚动容器', /\.dshadb-whale-grab\{[^}]*overflow-x:auto/.test(src))
a('挂件抓取层带 2px 不可见横向溢出', /\.dshadb-whale-grab-guard\{[^}]*width:calc\(100% \+ 2px\)/.test(src))
a('挂件抓取层守卫零高度不占位', /\.dshadb-whale-grab-guard\{[^}]*height:0/.test(src))
// 滚动容器是浏览器判定可触摸行为的终点: touch-action 不写在它身上, 横向 pan 会被它自己抢走(鱼拖不动)
a('挂件抓取层显式 touch-action:none', /\.dshadb-whale-grab\{[^}]*touch-action:none/.test(src))
a('挂件抓取层不显示滚动条', src.includes('.dshadb-whale-grab::-webkit-scrollbar{display:none'))
a('挂件抓取层不挡视觉', /\.dshadb-whale-grab\{[^}]*background:transparent/.test(src))
a('抓取层挂在 body 内部 (事件仍冒泡到 body 的拖拽处理器)', src.includes('body.appendChild(grab)'))
a('抓取层在图片之后 (盖在鱼身上才接得到起手)', src.indexOf('body.appendChild(img)') < src.indexOf('body.appendChild(grab)'))
a('拖拽处理器仍绑在 body 上', src.includes('body.addEventListener("pointerdown", onDown)'))
// pointer-events 不继承: body 被锁成 none 时, 抓取层的 auto 仍会吃到事件, 必须单独上锁
a('面板开着时抓取层一起上锁', /\.dshadb-whale-locked \.dshadb-whale-grab\{[^}]*pointer-events:none/.test(src))
a('别给 body 加 overflow (会裁掉 img 的 drop-shadow)', !/\.dshadb-whale-body\{[^}]*overflow/.test(src))

// ===== 台词气泡挪到人物上方 =====
// 素材 DSniang1.png 是 610x610, 不透明像素从 y=10 就开始(呆毛顶到画布上沿), 而 object-fit:contain
// 在方盒里等于铺满 → 盒子顶 ≈ 呆毛顶。原 bottom:calc(100% - 6px) 让气泡下沿压进头顶 6px,
// 尾巴(::after 再 8px)扎到 14px —— 鱼只有 64.8px(scale 0.6) 时那是整条鱼的 21%。
a('气泡整体位于盒子上方', /\.dshadb-whale-bubble\{[^}]*bottom:calc\(100% \+ 6px\)/.test(src))
a('气泡不再压进头顶', !src.includes('calc(100% - 6px)'))
a('下方兜底分支对称', /\.dshadb-whale-bubble-below\{[^}]*top:calc\(100% \+ 6px\)/.test(src))

// ===== 挂件冷启动不再「先默认值后保存值」地跳 =====
// 旧行为: 先用默认值(scale=1 → 108px、贴右边、top=62% 屏高)画出来, 等 /whale/settings 回来再改
// 成保存值。真机实测那一下是「往上跳 307px + 从 108px 缩到 65px」, LayoutShift 记 0.0119
// (我们这边最大的一笔); 而且冷启动时它发生在首屏十几秒后(配置要等一次全量轮询), 维护者正好
// 在看设置面板 → 误以为「打开设置界面才抖」。改为: 首帧隐藏, 设置到位(或失败/2s 兜底)才露出。
a('挂件首帧先隐藏', src.includes('root.style.visibility = "hidden"'))
a('有 reveal() 且接到 fetch 链尾', /function reveal\(\)/.test(src) && /\.then\(reveal\)/.test(src))
a('reveal 有 2s 兜底(请求挂住也得露面)', src.includes('setTimeout(reveal, 2000)'))
a('兜底定时器在卸载时清掉', src.includes('if (revealTimer) clearTimeout(revealTimer)'))
a('reveal 幂等(只露一次)', /if \(revealed\) return;/.test(src))
a('reveal 里才恢复 transition', /function reveal\(\)[\s\S]{0,300}root\.style\.transition = ""/.test(src))

// ===== 状态条定住高度下限 =====
// 空态内容 18px、有数据态 20px → 钱数/平台名一进来状态条从 26px 变 28px, 把上面的会话区顶 2px
// (真机实测 CLS 0.00094+0.00053)。用 min-height 定下限而非 height, 系统字体放大仍不裁字。
a('状态条定住高度下限 28px', /\.dshadb_bar\{[^}]*min-height:28px/.test(src))
a('min-height 配 border-box(含 padding, 与实测总高一致)', /\.dshadb_bar\{[^}]*box-sizing:border-box/.test(src))
a('没写死 height(字体放大不裁字)', !/\.dshadb_bar\{[^}]*;height:/.test(src))

// ===== 结构完整性(删临时埋点时被"擦伤"过, 钉住) =====
// 清临时代码时曾把 className 一起删掉, 变成 createElement("span", {  }) —— 语法照样通过、
// 其它断言也全绿, 但 .dshadb_barwrap 的列布局会失效(状态条与子代理行会排成一行)。
a('dock 容器保留 dshadb_barwrap 类名', src.includes('className: "dshadb_barwrap"'))
a('设置面板保留 dshadb_drawer 类名', src.includes('className: "dshadb_drawer"'))
a('没有空属性对象残留(createElement(x, {  }))', !/react\.createElement\("[a-z]+", \{\s{2,}\}/.test(src))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
// v1.3.2: 断言失败时以非 0 退出, 否则 CI(GitHub Actions)拦不住回归 —— 原来一律 exit 0
if (fail > 0) process.exitCode = 1
