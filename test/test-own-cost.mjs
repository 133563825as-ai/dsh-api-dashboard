import assert from 'node:assert/strict';
import {makeCostProjection} from '../src/index.js';
const p=makeCostProjection({currency:'CNY',overseasCurrency:'USD'},{});
const events=[
{seq:0,type:'request/context',data:{model:'gpt-4o'}},
{seq:1,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:100,outputTokens:10}}},
{seq:2,type:'subagent/catalog',data:{childId:'old-sibling'}},
{seq:3,type:'session/end-seed',data:{inherited:true}},
{seq:4,type:'request/context',data:{model:'deepseek-chat'}},
{seq:5,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:20,outputTokens:2}}},
{seq:6,type:'subagent/catalog',data:{childId:'own-child'}}];
let s=p.init({id:'child'},3);
for(const e of events)s=p.apply(s,e);
assert.deepEqual(s.own?.modelOrder,['deepseek-chat'],'自身统计不能继承USD模型');
assert.deepEqual(s.ownChildIds,['own-child']);
assert.equal(s.own.byModel['deepseek-chat'].outputTokens,2);
assert.ok(s.modelOrder.includes('gpt-4o'),'主视图全量口径不变');
s=p.stateSchema.parse(s);
s=p.apply(s,{seq:7,type:'llm/retry-started',data:{turn:1,step:1}});
s=p.apply(s,{seq:8,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:30,outputTokens:3}}});
assert.equal(s.own.byModel['deepseek-chat'].outputTokens,5,'重试必须累加');
s=p.apply(s,{seq:9,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:30,outputTokens:3}}});
assert.equal(s.own.byModel['deepseek-chat'].outputTokens,5,'重复样本不重复');
assert.ok(p.stateVersion>2);
console.log('own-cost boundary/retry/schema tests passed');
