// preview.7：宽屏触屏档「宿主侧栏竖线」抑制规则的范围回归。
// 这不是像素修复证明（真机验收在平板侧），钉的是**作用域不许被放宽**：
//   ① 只在 (min-width:1024px) and (pointer:coarse) —— 正好补 dsh-web-mobile 那条
//      (max-width:1023px) and (pointer:coarse) 抑制规则的缺口；
//   ② 只在我们自己的遮罩打开时生效（:has(.dshadb_scrim)），平时不动宿主界面；
//   ③ 不许波及 pointer:fine（桌面鼠标档保持宿主官方分隔线）；
//   ④ 不许顺手改我们自己的面板几何。
// 另外钉住 preview.6 那个无效的 contain 试验确实已撤除。
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
const lines = source.split('\n');
const rule = lines.find((l) => l.startsWith('@media ') && l.includes('[class*="sidebarCol"]'));

assert.ok(rule, '缺少宽屏触屏档的侧栏竖线抑制规则');

// ① 媒体条件：只覆盖 1023px 抑制规则够不到的宽屏触屏档
assert.match(rule, /^@media \(min-width:1024px\) and \(pointer:coarse\)\{/,
  '竖线抑制必须限定在 (min-width:1024px) and (pointer:coarse)');
assert.ok(!rule.includes('pointer:fine'), '不得在桌面鼠标档(pointer:fine)抑制宿主分隔线');
assert.ok(!rule.includes('min-height'), '不该再叠 min-height 门槛（那会把宽而矮的触屏屏漏掉）');

// ② 只在我们的遮罩打开时生效
assert.ok(rule.includes('body:has(.dshadb_scrim)'),
  '必须用 :has(.dshadb_scrim) 限定「只有我们面板开着时才抑制」');
assert.ok(rule.includes('[class*="sidebarCol"]'),
  '选择器要用语义后缀（宿主类名是 CSS Module 哈希，不能写死 pI_x6G_）');
assert.ok(rule.includes('border-right:none !important'), '抑制本体应当是 border-right:none !important');

// ③ 不许碰我们自己的面板几何/其它宿主元素
for (const forbidden of ['.dshadb_drawer', '.dshadb_body', 'max-height', 'transform', 'box-shadow']) {
  assert.ok(!rule.includes(forbidden), `竖线抑制规则里不该出现 ${forbidden}`);
}
// 全文件里只有这一处碰 sidebarCol
const sidebarMentions = lines.filter((l) => l.includes('sidebarCol') && l.startsWith('@media ')).length;
assert.equal(sidebarMentions, 1, `sidebarCol 只应出现在这一条媒体规则里，实际 ${sidebarMentions} 条`);

// ④ preview.6 的 contain 试验必须已撤（它没修好线，还带来浮层裁剪风险）
assert.ok(!source.includes('data-dshadb-paint-isolation'), 'preview.6 的隔离 data 属性应已移除');
assert.ok(!source.includes('contain:paint'), 'preview.6 的 contain:paint 试验应已移除');

// ⑤ 三个抽屉都仍然渲染遮罩（:has(.dshadb_scrim) 的前提）
const scrims = (source.match(/className: "dshadb_scrim"/g) || []).length;
assert.equal(scrims, 3, `三个抽屉都应渲染 .dshadb_scrim，实际 ${scrims} 处`);

console.log('侧栏竖线抑制：11 项范围检查通过（真机视觉效果待平板验收）');
