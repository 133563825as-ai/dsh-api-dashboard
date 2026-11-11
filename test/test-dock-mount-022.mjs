// v1.7.3: DSH 0.2.2 宿主的「状态条落点」回归钉子。
//
// 这一批钉的是真机上连踩三层的坑，三层都不是我们自己的 CSS 写错，而是宿主换了容器语义：
//  ① 0.2.2 里 [data-slot="conversation.composer.dock"] **不再是 display:contents**，而是真实
//     flex 盒子，并且被 dsh-web-mobile 标成 [data-mobile-nav="stats"]
//     （height/max-height 28px + overflow:hidden + flex-flow:nowrap，全是 !important）。
//     胶囊作为它的子节点被压成 92~106px，右半截被物理裁掉（真机 360x754 实测）。
//     ⇒ 所以 v1.6.6 那两条 :has() 规则在 0.2.2 上一条都不成立，必须换落点。
//  ② 也不能塞进 composer dock：dsh-web-mobile 的 locateRing() 会把 dock 里唯一的非统计子节点
//     当成上下文环，给它挂 [data-mobile-nav="stats-ring"] 并 absolute 搬走（实测 92x28）。
//  ③ 最终落点是输入卡 uV2eYG_root（dock 的父节点）—— 卡片内部、统计行正下方。
// 这批断言故意做成**结构断言**：跑不起浏览器也要能拦住「有人把 portal 改回 dock」「有人给
// margin-top 加回 !important 把关内联贴边又打死」这两类回退。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../client/client.js'), 'utf8')

// ===== ① CSS：落点规则存在，且不许用 !important =====
const hostRule = (src.match(/\[data-dshadb-host\]\s*>\s*\.dshadb_barwrap\{[^}]*\}/) || [])[0] || ''
a('A1 存在 [data-dshadb-host] > .dshadb_barwrap 规则', hostRule.length > 0)
a('A2 该规则里 width 撑满', /width:100%/.test(hostRule), hostRule)
a('A3 该规则不用 !important（我们自己的样式表铁律）', !/!important/.test(hostRule), hostRule)
a('A4 margin-top 不许出现在 !important 里（行内贴边要能生效）', !/margin-top[^;]*!important/.test(hostRule))
a('A5 dock 兜底规则存在（拿不到输入卡时独占一行）', /\[data-dshadb-host="dock"\]\s*>\s*\.dshadb_barwrap\{[^}]*flex:0 0 100%/.test(src))
a('A6 整段说明里点名了三个候选容器（改之前先看注释）', /data-mobile-nav="stats"|stats-ring/.test(src) && /uV2eYG_root|输入卡/.test(src))
a('A7 遗留的 dock flex-wrap 规则已删除（会把宿主 ContextMeter 挤到第二行，凭空多 22px 空带）', !/\[class\*="_dock"\]:has\(> \[data-slot="conversation\.composer\.dock"\]\)\{flex-wrap:wrap\}/.test(src))
a('A8 遗留的 [data-composer-stats] 全宽规则也已删除（0.2.2 里这个容器不存在了）', !/\[data-slot="conversation\.composer\.dock"\] > \[data-composer-stats\]/.test(src))

// ===== ② 落点顺序：输入卡 → stack → dock =====
a('B1 从哨兵找 composer dock', /sentinelRef\.current/.test(src) && /closest\("\[data-composer-dock\]"\)/.test(src))
a('B2 输入卡 = dock.parentElement', /dock\.parentElement/.test(src))
a('B3 回退到 composerStack', /_composerStack/.test(src))
a('B4 优先级表达式是 card → stack → dock', /card !== null \? card : \(stack !== null \? stack : dock\)/.test(src))

// ===== ③ portal 接线 =====
a('C1 用 createPortal 挂到宿主容器', /reactDom\.createPortal\(barNode,\s*portalHost\)/.test(src))
a('C2 首帧（还没定位到宿主时）仍然渲染状态条，不能空白', /portalHost === null \? barNode :/.test(src))
a('C3 浮动/宽屏时不搬家（拖动坐标是 fixed，搬进卡片会被祖先 transform 影响）', /const canPortal = !barPos && !isWideViewport\(\)/.test(src))
a('C4 状态条根节点挂了 ref（贴边计算要用）', /className: "dshadb_barwrap"[^}]*ref: barwrapRef/s.test(src))

// ===== ④ 实测贴边 =====
a('D1 递归取上方最大底边（display:contents 空壳自身 0x0，必须往下钻）', /const bottomOf = \(node\) =>/.test(src) && /bottomOf\(child\)/.test(src))
a('D2 留白旋钮 --dshadb-lift，默认 -3px', /--dshadb-lift/.test(src) && /Number\.isFinite\(rawLift\) \? rawLift : -3/.test(src))
a('D3 几何签名没变就跳过（避免流式输出时每帧强制排版）', /liftKey\.current === key/.test(src))
a('D4 只在偏差 > 0.5px 时才写样式（防抖）', /Math\.abs\(gap - want\) < 0\.5/.test(src))

console.log(`结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exit(1)
