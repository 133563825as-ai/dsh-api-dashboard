// 余额插件 dock 组件的渲染冒烟（v1.7.2）。
//
// 目的不是验证数字，而是验证「组件树能起来」：
// 本轮在 DashboardSlot 里加了胶囊拖动（pointer 处理器 + localStorage 坐标 + 浮动样式），
// 这类改动最容易在真实渲染时踩到未定义引用，而纯源码断言看不出来。
// 这里用最小 DOM 垫片跑工厂、直接调用宿主会调用的组件函数；
// 空数据（config=null、balances 为空）就是首帧的真实状态，必须能渲染出来。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const source = fs.readFileSync(path.join(root, 'client/client.js'), 'utf8')

function makeElement (tag) {
  return {
    tagName: tag,
    children: [],
    style: {},
    dataset: {},
    id: '',
    className: '',
    textContent: '',
    classList: { add () {}, remove () {}, contains () { return false } },
    appendChild (c) { this.children.push(c) },
    append () {},
    remove () {},
    setAttribute () {},
    addEventListener () {},
    removeEventListener () {}
  }
}

function environment () {
  const storage = new Map()
  const doc = {
    head: makeElement('head'),
    body: makeElement('body'),
    documentElement: { clientWidth: 390, clientHeight: 780 },
    createElement: (t) => makeElement(t),
    querySelector: () => null,
    getElementById: () => null,
    addEventListener () {},
    removeEventListener () {}
  }
  const win = {
    innerWidth: 390,
    innerHeight: 780,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    addEventListener () {},
    removeEventListener () {},
    history: { pushState () {}, back () {} },
    matchMedia: () => ({ matches: false, addEventListener () {} }),
    requestAnimationFrame: (fn) => { fn(); return 1 },
    cancelAnimationFrame () {},
    navigator: { userAgent: 'node' }
  }
  return { doc, win }
}

const react = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (value) => ({ current: value }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useSyncExternalStore: (_sub, get) => get(),
  useReducer: (reducer, init) => [reducer(init, { type: 'init' }), () => {}]
}

test('状态条在空数据首帧也能渲染（拖动代码不会把它带崩）', () => {
  const { doc, win } = environment()
  globalThis.window = win
  globalThis.document = doc
  globalThis.localStorage = win.localStorage

  let module = null
  win.__ModuleLoader__ = { load: (m) => { module = m } }
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', source)(win, doc)
  const api = module.factory((name) => (name === 'react' ? react : {}))

  const registered = {}
  const ctx = {
    locale: { register () {}, unregister () {} },
    get: () => undefined,
    slots: {
      inject: (_name, factory) => factory(),
      register: (def, component) => { registered[def.name] = component; return () => {} }
    },
    effect () {},
    modelDirectories: undefined
  }
  api.apply(ctx)

  const DashboardSlot = registered['conversation.composer.dock']
  assert.equal(typeof DashboardSlot, 'function')
  const tree = DashboardSlot({ t: (k) => k })
  assert.ok(tree, '首帧必须返回元素，不能是 undefined')
  assert.ok(Array.isArray(tree.children) && tree.children.length > 0)
  // 空态分支的 CSS 变量也要下发（缩放/边框宽度），否则「无边框」一保存就退回默认
  const style = tree.props.style || {}
  assert.equal(typeof style['--dshadb-bar-edge-w'], 'string')
  assert.equal(typeof style['--dshadb-bar-scale'], 'string')
})
