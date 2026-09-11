import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeCostProjection} from '../src/index.js';
const home=mkdtempSync(join(tmpdir(),'own-cold-'));const prev=process.env.DSH_HOME;process.env.DSH_HOME=home;
const dir=join(home,'storages/session_projcache/sessions');mkdirSync(dir,{recursive:true});
try{
const p=makeCostProjection({currency:'CNY',overseasCurrency:'USD'},{sessions:{get:()=>null}});
const root=p.init({id:'root'},0);
root.ownChildIds=['old','new','zero','legacy-fresh','legacy-fork'];
const values=root.ownChildIds.concat(['inherited-sibling']).map(childId=>({childId}));
writeFileSync(join(dir,'root.json'),JSON.stringify({record:{rows:{subagentCatalog:{val:{head:{values}}}}}}));
const kid=p.init({id:'new'},2);
let fresh=p.apply(kid,{seq:0,type:'request/context',data:{model:'gpt-4o'}});
fresh=p.apply(fresh,{seq:1,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:1000,outputTokens:10}}});
fresh=p.apply(fresh,{seq:2,type:'request/context',data:{model:'deepseek-chat'}});
fresh=p.apply(fresh,{seq:3,type:'assistant/message',data:{turn:2,step:1,usage:{inputTokens:20,outputTokens:2}}});
const put=(id,ver,val)=>writeFileSync(join(dir,id+'.json'),JSON.stringify({record:{rows:{queryBalanceCost:{ver,seq:9,val}}}}));
// v1.4.4: 旧缓存（ver 2）没有 own，但 identity 里记着 fork 边界 —— 用它决定能否精确还原
const putId=(id,ver,val,identity)=>writeFileSync(join(dir,id+'.json'),JSON.stringify({record:{identity,rows:{queryBalanceCost:{ver,seq:9,val}}}}));
const legacyVal=(model,input,output)=>({currentModel:model,currentProvider:null,last:null,modelOrder:[model],
  byModel:{[model]:{uncachedInputTokens:input,cacheReadTokens:0,cacheWriteTokens:0,outputTokens:output}}});
put('old',2,fresh);put('new',3,p.stateSchema.parse(fresh));
let zero=p.init({id:'zero'},0);zero=p.apply(zero,{seq:0,type:'request/context',data:{model:'deepseek-chat'}});zero=p.apply(zero,{seq:1,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:0,outputTokens:0}}});put('zero',3,zero);
// 旧缓存 + 非分叉（inheritedEventCount=0）→ 自身 == 全量，必须精确显示，不能退化成「等待」
putId('legacy-fresh',2,legacyVal('mimo-v2.5',1000000,0),{formatVersion:3,isSeeded:false,inheritedEventCount:0});
// 旧缓存 + 分叉 → 分不出继承段，必须显示「等待」而不是错的数字
putId('legacy-fork',2,legacyVal('mimo-v2.5',1000000,0),{formatVersion:3,isSeeded:true,inheritedEventCount:2829});
const v=p.wire.view(root);
assert.equal(v.subagents.length,5);
assert.equal(v.subagents[0].waiting,true,'旧缓存无 identity → 等待');
assert.equal(v.subagents[0].cost,-1);
assert.equal(v.subagents[1].costByCurrency.USD,undefined);
assert.equal(v.subagents[1].tokens.output,2);
assert.equal(v.subagents[2].cost,0);assert.equal(v.subagents[2].waiting,false,'真实零消耗不是等待');
assert.equal(v.subagents[3].waiting,false,'旧缓存+非分叉 → 精确显示');
assert.equal(v.subagents[3].cost,1,'mimo-v2.5 1M 输入 = ¥1');
assert.equal(v.subagents[4].waiting,true,'旧缓存+分叉 → 等待');
assert.equal(v.subagents[4].cost,-1);
p.wire.viewSchema.parse(v);
console.log('cold own cost: 旧缓存等待 / 非分叉精确还原 / 分叉等待 / 币种 / 真实零 / 继承目录过滤 全部通过');
}finally{if(prev===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prev;rmSync(home,{recursive:true,force:true})}
