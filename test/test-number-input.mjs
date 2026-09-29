// v1.6.9 数字输入框的钉子。
//
// 真机背景（2026-09-29，维护者反馈「那个数字填写，要先写后一个数字才能把前面的数字去掉」）：
//   · 设置面板里三个数字框（刷新间隔 / 今日花销 / 重复提醒间隔）在 onChange 里**当场夹取**：
//     `setAlertRepeat(Math.min(Math.max(Math.round(Number(e.target.value) || 0), 0), 168))`
//   · `Number("") === 0` —— 用户把旧数字删空的那一刻 state 变成 0，受控 input 立刻把 `0` 写回，
//     光标被顶到末尾 → **旧数字根本删不掉**，只能先把新数字打上去再删旧的（维护者的原话）。
//   · 更狠的是静默后果：`alertRepeatHours` 的 0 = **关闭重复提醒**。旧代码保存时
//     `Number(alertRepeat) > 0 ? … : 0` 把一次"清空"变成"关掉提醒"，用户完全不知道。
//
// 修法：输入期只剔非数字字符、允许空串（空 = 正在改），数值夹取推迟到失焦/保存。
// 这里钉住 ① 两个纯函数的边界 ② 删除动作的中间态真的是空串 ③ 三处输入框的接线方式。
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const src = readFileSync(new URL('../client/client.js', import.meta.url).pathname, 'utf8')

// 从源码里把两个纯函数原样抠出来跑 —— 不复写一份实现, 否则测的是夹具不是代码。
const grab = (name) => {
  const m = src.match(new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}'))
  if (!m) throw new Error('client/client.js 里找不到 ' + name)
  return m[0]
}
const { numberDraft, settleNumber } = new Function(
  grab('numberDraft') + '\n' + grab('settleNumber') + '\nreturn { numberDraft, settleNumber }'
)()

// ===== ① numberDraft: 输入期只留数字, 允许空串 =====
a('D1 空串保持空串(这就是"能删掉"的前提)', numberDraft('', 3) === '')
a('D2 单个 0 保留(0 是合法值, 不是空)', numberDraft('0', 3) === '0')
a('D3 前导零剥掉', numberDraft('06', 3) === '6' && numberDraft('007', 3) === '7')
a('D4 非数字剔掉', numberDraft('1a2', 3) === '12' && numberDraft('abc', 3) === '')
a('D5 位数封顶(只是防长数字撑爆面板, 不是数值上限)', numberDraft('12345', 3) === '123' && numberDraft('1234567', 6) === '123456')
a('D6 null/undefined 都当空, 不产出 "null"', numberDraft(null, 3) === '' && numberDraft(undefined, 3) === '')
a('D7 数字入参也吃得下', numberDraft(6, 3) === '6')

// ===== ② settleNumber: 失焦/保存时规范化, 空串走 fallback =====
a('S1 空串走 fallback(绝不当 0 —— 0 在重复提醒里是"关闭")', settleNumber('', 0, 168, 6) === 6)
a('S2 显式的 0 保留', settleNumber('0', 0, 168, 6) === 0 && settleNumber(0, 0, 168, 6) === 0)
a('S3 超上限夹住', settleNumber('999', 0, 168, 6) === 168)
a('S4 低于下限夹住', settleNumber('-5', 0, 168, 6) === 0)
a('S5 非数字走 fallback', settleNumber('abc', 0, 168, 6) === 6)
a('S6 纯空白也当空', settleNumber('   ', 0, 168, 6) === 6)
a('S7 合法值原样', settleNumber('12', 0, 168, 6) === 12)
a('S8 刷新间隔那组的默认值 5 秒, 下限 1', settleNumber('', 1, 60, 5) === 5 && settleNumber('0', 1, 60, 5) === 1)

// ===== ③ 删除动作本身: 模拟受控 input 的按键序列 =====
// 旧实现里第 2 步的结果是 0(Number("")===0 立刻回填), 于是下一步再输 1 得到 "01" 而不是 "1",
// 用户看到的现象就是"前面的数字删不掉"。
{
  let v = 6
  v = numberDraft('', 3)
  a('T1 删掉旧数字后停在空串(旧实现: 立刻回填 0)', v === '')
  v = numberDraft(v + '1', 3)
  v = numberDraft(v + '2', 3)
  a('T2 从空串逐位输入得到 12(旧实现会变成 012 → 夹取后行为不可预期)', v === '12')
  a('T3 最后交给 settleNumber 落成 12', settleNumber(v, 0, 168, 6) === 12)
}

// ===== ④ 源码接线: 三处输入框都必须走"草稿 + 失焦夹取" =====
a('W1 刷新间隔: 输入期只存草稿', /onChange: \(e\) => setRefreshSec\(numberDraft\(e\.target\.value, 3\)\)/.test(src))
a('W2 今日花销: 输入期只存草稿', /onChange: \(e\) => setDailyLimit\(numberDraft\(e\.target\.value, 6\)\)/.test(src))
a('W3 重复提醒间隔: 输入期只存草稿', /onChange: \(e\) => setAlertRepeat\(numberDraft\(e\.target\.value, 3\)\)/.test(src))
a('W4 三处都有失焦夹取', [
  /onBlur: \(e\) => setRefreshSec\(settleNumber\(e\.target\.value, 1, 60, 5\)\)/,
  /onBlur: \(e\) => setDailyLimit\(settleNumber\(e\.target\.value, 0, 999999, 0\)\)/,
  /onBlur: \(e\) => setAlertRepeat\(settleNumber\(e\.target\.value, 0, 168, 6\)\)/,
].every(r => r.test(src)))
a('W5 数字框里不再有"当场夹取"的 onChange', !/onChange: \(e\) => set(?:RefreshSec|DailyLimit|AlertRepeat)\(Math\./.test(src))
a('W6 阈值框也接了失焦规范化', /onBlur: \(e\) => setSafe\(settleNumber\(e\.target\.value, 0, 1e9, 50\)\)/.test(src)
  && /onBlur: \(e\) => setWarn\(settleNumber\(e\.target\.value, 0, 1e9, 10\)\)/.test(src))
a('W7 保存前统一规范化(不再 Number(x) > 0 ? x : 0 静默归零)',
  /const nextDailyLimit = settleNumber\(dailyLimit, 0, 999999, 0\)/.test(src)
  && /const nextAlertRepeat = settleNumber\(alertRepeat, 0, 168, 6\)/.test(src)
  && /dailyLimit: nextDailyLimit/.test(src)
  && /alertRepeatHours: nextAlertRepeat/.test(src))
a('W8 输入框的 min/max 属性没动(数值语义未变)', /className: "dshadb_field", type: "number", min: 0, max: 168, step: 1/.test(src))

// ===== ④b 旧实现的行为留档（这两条把"为什么必须改"写在测试里）=====
{
  const legacy = (s) => Math.min(Math.max(Math.round(Number(s) || 0), 0), 168)
  a('O1 旧表达式把"删空"变成 0 —— 受控 input 随即回填, 旧数字于是删不掉', legacy('') === 0)
  a('O2 新实现把"删空"保留成空串, 失焦才落成默认值', numberDraft('', 3) === '' && settleNumber('', 0, 168, 6) === 6)
}

// ===== ⑤ 渲染级验证: 真把设置面板挂起来, 按一次「删除」=====
// 前面几段都是源码/纯函数级断言, 这一段是**真的调用组件**: 拿到那个初值为 6 的数字框
// （= 重复提醒间隔）, 手动触发 onChange({value:""}) —— 模拟用户把旧数字删掉 ——
// 然后看 setState 收到的到底是什么。旧实现在这里会收到 0（Number("")===0 当场回填）,
// 于是受控 input 立刻显示 0, 旧数字删不掉。这就是维护者那条反馈的可执行复现。
{
  const setterCalls = []
  const react = {
    createElement: (t, p, ...c) => ({ type: t, props: p || {}, children: (c.length === 1 && Array.isArray(c[0]) ? c[0] : c).flat(Infinity).filter(x => x != null && x !== false) }),
    useState: (init) => [init, (v) => { setterCalls.push(v) }],
    useRef: (init) => ({ current: init }),
    useEffect: () => {},
    useMemo: (f) => f(),
    useCallback: (f) => f,
    useSyncExternalStore: (s, g) => g(),
  }
  const mkEl = () => ({ tag: '', className: '', dataset: {}, textContent: '', style: { setProperty() {}, removeProperty() {} }, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {}, contains: () => false, offsetWidth: 120, offsetHeight: 60, getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 100 }), parentNode: null })
  const doc = { head: { appendChild() {} }, body: { appendChild() {}, removeChild() {}, addEventListener() {}, removeEventListener() {}, contains: () => true }, documentElement: { classList: { add() {} } }, createElement: mkEl, addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], hidden: false }
  globalThis.document = doc
  globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 412, innerHeight: 892, location: { origin: 'http://x' }, confirm: () => false, matchMedia: () => ({ matches: false, addEventListener() {} }) }
  globalThis.localStorage = { getItem: () => '', setItem() {} }
  globalThis.Audio = class { constructor() { this.volume = 0 } play() { return Promise.resolve() } }
  globalThis.requestAnimationFrame = (f) => { f(0); return 1 }
  globalThis.cancelAnimationFrame = () => {}
  let captured = null
  globalThis.window.__ModuleLoader__ = { load({ factory }) { captured = factory((n) => { if (n === 'react') return react; if (n === '@deepseek-ai/dsh-client-ui-primitives') return {}; throw new Error('未知依赖 ' + n) }) } }
  const marker = '    exports.apply = apply;'
  const execSrc = src.replace(marker, '    exports.__test = { SettingsModal };\n' + marker)
  new Function('window', 'document', 'navigator', 'localStorage', execSrc)(globalThis.window, doc, { hardwareConcurrency: 8, language: 'zh-CN' }, globalThis.localStorage)
  const SettingsModal = captured && captured.__test && captured.__test.SettingsModal

  try {
    // 函数组件就是普通函数: 直接调用即得到它这一帧的元素树（垫片不替我们渲染子组件）
    const tree = SettingsModal({ isOpen: true, onClose() {}, onBack() {}, t: (k) => k, config: {}, initialSection: 'basic', underScrim: false })
    const inputs = []
    const collect = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(collect); return }
      if (node.type === 'input') inputs.push(node)
      if (node.children) collect(node.children)
    }
    collect(tree)
    const nums = inputs.filter(i => i.props && i.props.type === 'number')
    a('R1 面板里能挂出数字输入框', nums.length >= 3)
    const repeat = nums.find(i => i.props.value === 6)   // 初值 6 的只有「重复提醒间隔」
    a('R2 找得到重复提醒间隔那个框(初值 6)', !!repeat)
    if (repeat) {
      setterCalls.length = 0
      repeat.props.onChange({ target: { value: '' } })
      a('R3 删除动作交给 setState 的是空串(旧实现: 0 → 立刻回填, 于是旧数字删不掉)', setterCalls.includes(''))
      a('R4 删除时没有任何"回填数字"的 setState', !setterCalls.some(v => typeof v === 'number'))
      setterCalls.length = 0
      repeat.props.onBlur({ target: { value: '' } })
      a('R5 失焦时空串落成默认 6 小时(不是 0 —— 0 是"关掉重复提醒")', setterCalls.includes(6))
      setterCalls.length = 0
      repeat.props.onChange({ target: { value: '12' } })
      repeat.props.onBlur({ target: { value: '12' } })
      a('R6 正常输入 12 一路通畅', setterCalls.includes('12') && setterCalls.includes(12))
    }
  } catch (e) {
    fail++
    console.log('FAIL R0 设置面板渲染抛异常  ' + (e && e.message))
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
