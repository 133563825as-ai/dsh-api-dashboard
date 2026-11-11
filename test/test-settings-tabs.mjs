// v1.7.1: 设置面板页签结构的回归钉子。
//
// 背景：维护者要求「删掉中转站，和自定义模型重复了」。删除动作有三类风险，逐条钉住：
//  ① 页签删了但入口还在（抽屉里的「添加中转站」按钮）→ 点了跳到一个不存在的分区，白屏或没反应；
//  ② 新增入口删了，但**旧数据还留着**：服务端仍会查询 customRelays，
//     若连删除入口一起删掉，用户就得到一条永远删不掉、又一直显示余额的僵尸行；
//  ③ 顺手把服务端的 customRelays 支持也删了 → 老用户的配置直接失效（数据丢失，不可接受）。
//
// 这些都是"结构"层面的约定，行为测试拦不住，所以用源码断言钉。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let pass = 0, fail = 0
const a = (name, cond, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }

const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(here, '../client/client.js'), 'utf8')
const server = readFileSync(join(here, '../src/index.js'), 'utf8')
const countOf = (src, needle) => src.split(needle).length - 1

// ===== ① 页签：只剩四个，且没有"relays" =====
a('A1 页签不含 relays', !client.includes('tab("relays"'))
a('A2 页签恰好 4 个（基础 / 自定义模型 / 充值入口 / 大鲸鱼）', countOf(client, 'tab("') === 4, '实际 ' + countOf(client, 'tab("'))
a('A3 旧分区常量 relaySection 已移除', !client.includes('relaySection'))
a('A4 旧文案键已清掉（不留死字符串）', !client.includes('"add.relay"') && !client.includes('"settings.section.relays"'))

// ===== ② 入口：抽屉里不再有「添加中转站」 =====
a('B1 抽屉不再渲染添加中转站按钮', !client.includes('t("add.relay")'))
a('B2 抽屉组件不再接收 onAddRelay', !client.includes('onAddRelay'))
a('B3 添加按钮区只剩一个按钮（不再两列）', (client.match(/gridTemplateColumns: "1fr", gap: "10px", marginTop: "6px"/g) || []).length === 1)

// ===== ③ 旧数据：删除入口必须保留，否则成僵尸行 =====
a('C1 旧条目删除块还在（只在 relays 非空时出现）', client.includes('relayLegacy') && client.includes('relays.length > 0'))
a('C2 relayLegacy 挂进了「自定义模型」页', /relayLegacy,\s*\n\s*\]\);\s*\n\s*\n\s*const whaleSection/.test(client))
a('C3 删除回调仍在调用 removeRelay', client.includes('onClick: () => removeRelay(r.id)'))
a('C4 保存仍提交 customRelays（否则删旧条目不落盘）', client.includes('customRelays: relays'))

// ===== ④ 服务端不许跟着删：老配置要继续可用 =====
a('D1 服务端仍接受 POST 的 customRelays（patch 语义）', server.includes('Array.isArray(body.customRelays)'))
a('D2 customRelays 仍登记在落盘白名单里', /ARRAY_FIELDS\s*=\s*\[[^\]]*'customRelays'/.test(server))
a('D3 仍会查询手填中转站的余额', server.includes('manualRelays'))

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail > 0) process.exitCode = 1
