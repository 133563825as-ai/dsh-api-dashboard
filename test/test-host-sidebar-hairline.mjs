// preview.8：宿主侧栏竖线抑制规则的范围回归。
// 这不是像素修复证明（真机验收在平板侧），钉的是**作用域与写法不许被改回去**：
//   ① 不再带任何媒体条件 —— preview.7 的 (min-width:1024px) and (pointer:coarse)
//      在报 pointer:fine 的平板上整段不匹配（接鼠标/触控板、桌面模式），
//      而这条规则的作用域本来就只由 :has(.dshadb_scrim) 决定；
//   ② 只在我们自己的遮罩打开时生效，平时不动宿主界面；
//   ③ 用 border-right-color:transparent（几何不变），不许改回 border-right:none
//      —— 那个简写会连 0.5px 边框宽度一起去掉，开关面板时侧栏会有 0.5px 位移；
//   ④ 不许顺手改我们自己的面板几何 / 去碰别的宿主元素。
// 另外钉住 preview.6 那个无效的 contain 试验确实已撤除。
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
const lines = source.split('\n');
// 去掉 CSS 注释再找规则行：注释里会出现 sidebarCol / !important 等字样，不能算数。
const cssClean = source.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = cssClean
  .split('\n')
  .find((l) => l.includes('[class*="sidebarCol"]'));

assert.ok(rule, '缺少宿主侧栏竖线抑制规则');

// ① 不许再带媒体条件（preview.7 的补集写法在 pointer:fine 平板上会整段失效）
assert.ok(!rule.includes('@media'), '竖线抑制不该再包在媒体查询里（作用域由 :has(.dshadb_scrim) 决定）');
assert.ok(!rule.includes('pointer:'), '不该再带 pointer 判据（平板可能报 fine，会整段漏掉）');
assert.ok(!rule.includes('min-width'), '不该再带宽度门槛（那正是 preview.7 漏掉平板的原因）');
assert.ok(!rule.includes('min-height'), '不该再叠 min-height 门槛（那会把宽而矮的触屏屏漏掉）');

// ② 只在我们的遮罩打开时生效
assert.ok(rule.startsWith('body:has(.dshadb_scrim) '),
  '必须整条挂在 body:has(.dshadb_scrim) 上，限定「只有我们面板开着时才抑制」');
assert.ok(rule.includes('[class*="sidebarCol"]'),
  '选择器要用语义后缀（宿主类名是 CSS Module 哈希，不能写死 pI_x6G_）');

// ③ 只改颜色，不改几何
assert.ok(rule.includes('border-right-color:transparent'),
  '抑制本体应当是 border-right-color:transparent（保持 0.5px 几何，只让线不可见）');
assert.ok(!/border-right\s*:\s*none/.test(rule),
  '不许改回 border-right:none —— 简写会去掉 0.5px 边框宽度，开关面板时侧栏会有位移');

// ④ 不许碰我们自己的面板几何/其它宿主元素
for (const forbidden of ['.dshadb_drawer', '.dshadb_body', 'max-height', 'transform', 'box-shadow', 'display:none']) {
  assert.ok(!rule.includes(forbidden), `竖线抑制规则里不该出现 ${forbidden}`);
}
// 全文件里只有这一处碰 sidebarCol（注释已剔除）
const sidebarMentions = cssClean.split('\n').filter((l) => l.includes('sidebarCol')).length;
assert.equal(sidebarMentions, 1, `sidebarCol 只应出现在这一条规则里，实际 ${sidebarMentions} 条`);

// ⑤ preview.6 的 contain 试验必须已撤（它没修好线，还带来浮层裁剪风险）
assert.ok(!source.includes('data-dshadb-paint-isolation'), 'preview.6 的隔离 data 属性应已移除');
assert.ok(!source.includes('contain:paint'), 'preview.6 的 contain:paint 试验应已移除');

// ⑥ 三个抽屉都仍然渲染遮罩（:has(.dshadb_scrim) 的前提）
const scrims = (source.match(/className: "dshadb_scrim"/g) || []).length;
assert.equal(scrims, 3, `三个抽屉都应渲染 .dshadb_scrim，实际 ${scrims} 处`);

console.log('侧栏竖线抑制：13 项范围检查通过（真机视觉效果待平板验收）');
