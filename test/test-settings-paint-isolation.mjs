// 试验范围回归，不是竖线像素修复证明。删掉媒体门槛或把规则扩大到宿主应失败。
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8');
const rule = source.split('\n').find(line => line.startsWith('@media ') && line.includes('[data-dshadb-paint-isolation]'));
assert.ok(rule, '缺少大屏设置内容绘制隔离试验规则');
assert.ok(source.includes('"data-dshadb-paint-isolation": "settings"'), '设置面板未接入隔离规则');
const cond = rule.slice(7, rule.indexOf('{'));
const matches = (w,h,fine) => cond.split(',').some(c => {
 const minW = Number(c.match(/min-width:\s*(\d+)px/)?.[1] || 0);
 const minH = Number(c.match(/min-height:\s*(\d+)px/)?.[1] || 0);
 return w>=minW && h>=minH && (!c.includes('pointer:fine') || fine);
});
for (const [w,h,fine,want] of [[1238,787,false,true],[1024,768,false,true],[1600,599,true,true],[844,390,false,false],[390,844,false,false],[820,1180,false,false]]) {
 assert.equal(matches(w,h,fine),want,`${w}x${h} fine=${fine}`);
}
assert.match(rule, /\[data-dshadb-paint-isolation\] > \.dshadb_body\{isolation:isolate;contain:paint\}/);
assert.ok(!rule.includes('sidebarCol') && !rule.includes('scrollbar') && !rule.includes('!important'));
console.log('设置绘制隔离：10 项范围/接线检查通过（视觉效果待平板验证）');
