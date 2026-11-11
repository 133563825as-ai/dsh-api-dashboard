// v1.7.1: 状态条外观(边框宽度 / 整体缩放)两档设置的回归钉子。
//
// 这一批钉的是两个**真实踩过的坑**，都钉在行为上：
//  ① 维护者拖动滑块后发现「保存了不生效」—— 根因是配置落盘要过一张显式白名单
//     (NUMBER_FIELDS)，只加 schema 不登记就等于静默丢弃。所以必须有断言证明
//     barEdgeWidth/barScale 能穿过 sanitizePersistedShape 活下来。
//  ② 那张表对每个字段逐项 Math.round —— barScale 是 0.8~1.5 的小数，
//     1.25 会被抹成 1，用户看到的是「拖了半天还是原样」。所以必须有断言
//     证明小数位被保留，同时**整数语义的旧字段行为不许变**。
//  ③ (v1.7.1) 「保存了也生效不了」的第二个根因：**变量声明在错的组件里**。
//     barEdge/barScale 曾声明在 SettingsModal 内，而下发 CSS 变量的 barwrap 在
//     DashboardSlot —— 兄弟组件词法作用域互不可见，`typeof 未声明标识符` 又不抛错
//     （恒返回 "undefined"），于是永远落到兜底 1px/100%：滑块能拖、配置能存、
//     界面打死不动，控制台全程安静，36 个测试全绿。所以必须有一条**结构断言**
//     钉住「外观值声明在 DashboardSlot、面板只回传不改自己那份」。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { clampLook, sanitizePersistedShape } from '../src/index.js'

let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

// ===== ① clampLook 保留小数（不复用 clampMs 的原因）=====
a('A1 小数位保留：1.25 不被抹成 1', clampLook(1.25, 0.8, 1.5, 1, 2) === 1.25, '得到 ' + clampLook(1.25, 0.8, 1.5, 1, 2))
a('A2 小数位保留：0.85 保住两位', clampLook(0.85, 0.8, 1.5, 1, 2) === 0.85)
a('A3 超上限被夹到上限', clampLook(9, 0.8, 1.5, 1, 2) === 1.5)
a('A4 超下限被夹到下限', clampLook(0.1, 0.8, 1.5, 1, 2) === 0.8)
a('A5 非法值走 fallback', clampLook('abc', 0.8, 1.5, 1, 2) === 1 && clampLook(Number.NaN, 0.8, 1.5, 1, 2) === 1)
a('A6 缺省 decimals = 整数语义（与 clampMs 一致）', clampLook(3.7, 0, 10, 0) === 4)
a('A7 边框宽度保留一位小数', clampLook(1.5, 0, 3, 1, 1) === 1.5)
a('A8 无边框档 0 必须原样保留（不能因为 falsy 被 fallback 掉）', clampLook(0, 0, 3, 1, 1) === 0)

// ===== ② 两个字段能穿过落盘白名单 =====
const kept = sanitizePersistedShape({ barEdgeWidth: 2.5, barScale: 1.25 })
a('B1 barEdgeWidth 穿过白名单且保住小数', kept.barEdgeWidth === 2.5, '得到 ' + kept.barEdgeWidth)
a('B2 barScale 穿过白名单且保住小数（核心：不被 Math.round 抹成 1）', kept.barScale === 1.25, '得到 ' + kept.barScale)
a('B3 无边框档 0 穿过白名单后仍是 0', sanitizePersistedShape({ barEdgeWidth: 0 }).barEdgeWidth === 0)
a('B4 越界值被白名单夹住（脏值不进状态文件）', sanitizePersistedShape({ barEdgeWidth: 99, barScale: 9 }).barEdgeWidth === 3 && sanitizePersistedShape({ barScale: 9 }).barScale === 1.5)
a('B5 非数字被白名单剔除（不是塞个 0 冒充）', !('barEdgeWidth' in sanitizePersistedShape({ barEdgeWidth: 'x' })))
a('B6 NaN 被剔除', !('barScale' in sanitizePersistedShape({ barScale: Number.NaN })))

// ===== ③ 旧字段的整数语义不许被这次改动带偏 =====
const old = sanitizePersistedShape({ safeThreshold: 50.6, warnThreshold: 10.4, dailyLimit: 3.7, alertRepeatHours: 6.2, refreshIntervalMs: 5000.9 })
a('C1 阈值仍是四舍五入的整数', old.safeThreshold === 51 && old.warnThreshold === 10)
a('C2 今日花销阈值仍是整数', old.dailyLimit === 4)
a('C3 重复提醒间隔仍是整数', old.alertRepeatHours === 6)
a('C4 刷新间隔仍是整数', old.refreshIntervalMs === 5001)
a('C5 非数字旧字段照旧被剔除', !('safeThreshold' in sanitizePersistedShape({ safeThreshold: 'oops' })))

// ===== ④ 不受影响：数组/对象消毒照旧 =====
const mixed = sanitizePersistedShape({ customRelays: 'not-array', whaleSettings: 42, barEdgeWidth: 1.5 })
a('D1 数组字段形状不对仍被剔除', !('customRelays' in mixed))
a('D2 对象字段形状不对仍被剔除', !('whaleSettings' in mixed))
a('D3 同一次调用里新字段照常保留', mixed.barEdgeWidth === 1.5)
a('D4 空对象不报错也不凭空造字段', Object.keys(sanitizePersistedShape({})).length === 0)

// ===== ⑤ 结构断言：外观值必须声明在「下发 CSS 变量的那个组件」里 =====
// 这一组不看数值、只看位置关系，因为它钉的是一个**作用域**错误：
// 值在 A 组件、用它的地方在 B 组件 → typeof 静默兜底 → 功能整体失效且全绿。
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../client/client.js'), 'utf8')
const slotAt = src.indexOf('function DashboardSlot(props)')
const modalAt = src.indexOf('function SettingsModal(')
const declEdgeAt = src.indexOf('const [barEdge, setBarEdge] = react.useState(')
const declScaleAt = src.indexOf('const [barScale, setBarScale] = react.useState(')
const varAt = src.indexOf('"--dshadb-bar-edge-w"')
const countOf = (needle) => src.split(needle).length - 1

a('E0 两个组件都找到了', slotAt > 0 && modalAt > 0 && varAt > 0)
a('E1 barEdge 只有一处声明（不许面板再自留一份）', countOf('const [barEdge, setBarEdge] = react.useState(') === 1)
a('E2 barEdge 声明在 DashboardSlot 之内、下发变量之前',
  slotAt > 0 && declEdgeAt > slotAt && declEdgeAt < varAt, `slot=${slotAt} decl=${declEdgeAt} var=${varAt}`)
a('E3 barScale 同样声明在 DashboardSlot 之内、下发变量之前',
  slotAt > 0 && declScaleAt > slotAt && declScaleAt < varAt)
a('E4 SettingsModal 不再自持外观 state（只收 props）',
  modalAt > 0 && slotAt > modalAt && !/const \[barEdge, setBarEdge\]/.test(src.slice(modalAt, slotAt)))
a('E5 面板通过 props 收下外观值与回调',
  /function SettingsModal\(\{[^}]*barEdge[^}]*barScale[^}]*onBarEdge[^}]*onBarScale[^}]*\}\)/.test(src))
a('E6 滑块回传父组件，且仍走即改即存通道',
  /onBarEdge\(v\); saveBarLook\(\{ barEdgeWidth: v \}\)/.test(src) &&
  /onBarScale\(v\); saveBarLook\(\{ barScale: v \}\)/.test(src))
a('E7 渲染处把值与回调都接到子组件上',
  /barEdge, barScale, onBarEdge: applyBarEdge, onBarScale: applyBarScale/.test(src))
a('E8 首帧用本地缓存起手（避免先画默认值、配置回来再跳）',
  /useState\(\(\) => readBarLookCache\(\)\.edge\)/.test(src) &&
  /useState\(\(\) => readBarLookCache\(\)\.scale\)/.test(src) &&
  /writeBarLookCache\(\{ barEdgeWidth: d\.barEdgeWidth \}\)/.test(src))
a('E9 兜底值仍是 1px/100%（改成 0 会让所有人默认无边框）',
  /"--dshadb-bar-edge-w": \(typeof barEdge === "number" \? barEdge : 1\)/.test(src) &&
  /"--dshadb-bar-scale": String\(typeof barScale === "number" \? barScale : 1\)/.test(src))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
