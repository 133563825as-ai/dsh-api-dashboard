// v1.7.2：桌宠余额徽标 + 胶囊桌面/平板可拖动。
//
// 这两条需求都踩在两个「看起来能用、其实不生效」的老坑上，所以钉得细一点：
//   ① 徽标数字必须与状态条**同源**（同一个 barAmountText / getLevel），
//      否则鱼身上一个数、胶囊里另一个数，用户没法判断哪个是真的；
//   ② 拖动只在大屏生效，手机必须保持 dock —— 窄屏自由漂移会盖住输入框，
//      而且 localStorage 里的坐标是跨端同步的，手机端必须主动忽略它。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 不依赖 cwd：从别的目录跑（例如批量回归）也要能找到插件根目录
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const client = fs.readFileSync(path.join(root, 'client/client.js'), 'utf8')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')

function has (text, label) {
  assert.ok(client.includes(text), 'missing: ' + (label || text))
}

test('桌面/平板可拖动、手机固定：宽度闸门 + 坐标持久化', () => {
  has('const BAR_DRAG_MIN_WIDTH = 900;')
  has('function isWideViewport()')
  has('dsh-api-dashboard:barPos')
  // 三个指针处理器都必须先过宽度闸门，否则手机会跟着拖动
  assert.match(client, /const onBarPointerDown = \(e\) => \{\s*if \(!isWideViewport\(\)\) return;/)
  assert.match(client, /setBarPos\(isWideViewport\(\) \? readBarPos\(\) : null\)/)
  // 浮动只在有坐标时成立；没有坐标就留在 dock 原位
  has('const barWrapStyle = barPos')
  has('dshadb_barwrap_float')
  // 拖完那一下不能顺手打开看板
  has('suppressBarClick.current = true;')
  has('const resetBarPos = () => { writeBarPos(null); setBarPos(null); };')
})

test('设置面板能把它放回原位（有且只在浮动时出现）', () => {
  has('barFloating: !!barPos, onResetBarPos: resetBarPos')
  has('barFloating ? react.createElement("div"')
  has('"settings.barResetBtn": "放回原位"')
})

test('桌宠余额徽标与状态条同源', () => {
  has('showBalance: false,', 'WHALE_DEFAULTS 要带默认关')
  has('function updateWhaleBalance (info)')
  has('badge.className = "dshadb-whale-badge dshadb-whale-badge-"')
  // 数字来自 displayAmount，档位来自 getLevel —— 不允许再写一套格式化
  assert.match(client, /updateWhaleBalance\(\{ text: displayAmount, level: viaRelay \? "ok" : getLevel\(current, config\) \}\)/)
  // 没有当前平台 → 推空值隐藏徽标，而不是留着上一家平台的余额
  assert.match(client, /if \(!current\) \{ updateWhaleBalance\(\{ text: "", level: "ok" \}\); return; \}/)
})

test('徽标在没有数字或关闭开关时完全不显示', () => {
  assert.match(client, /if \(!st\.showBalance \|\| muted\) \{ badge\.style\.display = "none"; return; \}/)
  assert.match(client, /text === "~—" \|\| text === "—"/)
})

test('徽标跟随探头后的可见区，不会被推到屏幕外', () => {
  has('function applyBadge()')
  has('var visibleStart = Math.max(0, -dx);')
  has('badge.style.maxWidth = Math.round(visibleWidth - 4) + "px";')
  // 探头/展开/换尺寸都会重算
  assert.match(client, /function applyPeek\(\)[\s\S]{0,400}applyBadge\(\)/)
  assert.match(client, /function applyAll\(\) \{ applyScale\(\); applyPos\(\); applyFlip\(\); applyPeek\(\); applyBalance\(whaleBalance\); \}/)
})

test('设置里有开关，且走既有的即改即存通道', () => {
  assert.match(client, /wfSeg\("balance", t\("whale\.balance"\), \[\[true, t\("whale\.on"\)\], \[false, t\("whale\.off"\)\]\], wf\.showBalance,\s*\(v\) => patchWf\(\{ showBalance: v \}\)\)/)
  has('"whale.balance": "显示剩余余额"')
  has('"whale.balanceHint":')
  has('showBalance: false, peakMode: "default"', '设置面板的受控字段表要收这个键，否则服务端值回填不到面板')
})

test('三端断点：手机 <768 / 平板 768 / 桌面 1024', () => {
  // 余额插件本来就有两档抽屉断点，这里只确认它没在改动中被顺手删掉；
  // 另外四个插件本轮补齐了同样的 768/1024 档。
  assert.match(client, /@media\s*\(min-width:768px\)/)
  assert.match(client, /@media\s*\(min-width:1024px\)/)
  assert.match(client, /@media\s*\(min-width:768px\) and \(min-height:600px\)/)
})

test('版本与更新日志同步', () => {
  assert.match(pkg.version, /^1\.7\.\d+$/)   // v1.7.3: 不再钉死具体补丁号，只钉 1.7.x 系列
  assert.match(changelog, /v1\.7\.2/)
})
