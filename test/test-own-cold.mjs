import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeCostProjection} from '../src/index.js';
const home=mkdtempSync(join(tmpdir(),'own-cold-'));const prev=process.env.DSH_HOME;process.env.DSH_HOME=home;
const dir=join(home,'storages/session_projcache/sessions');mkdirSync(dir,{recursive:true});
try{
const p=makeCostProjection({currency:'CNY',overseasCurrency:'USD'},{sessions:{get:()=>null}});
const root=p.init({id:'root'},0);root.ownChildIds=['old','new','zero'];
const values=['old','new','zero','inherited-sibling'].map(childId=>({childId}));
writeFileSync(join(dir,'root.json'),JSON.stringify({record:{rows:{subagentCatalog:{val:{head:{values}}}}}}));
const kid=p.init({id:'new'},2);
let fresh=p.apply(kid,{seq:0,type:'request/context',data:{model:'gpt-4o'}});
fresh=p.apply(fresh,{seq:1,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:1000,outputTokens:10}}});
fresh=p.apply(fresh,{seq:2,type:'request/context',data:{model:'deepseek-chat'}});
fresh=p.apply(fresh,{seq:3,type:'assistant/message',data:{turn:2,step:1,usage:{inputTokens:20,outputTokens:2}}});
const put=(id,ver,val)=>writeFileSync(join(dir,id+'.json'),JSON.stringify({record:{rows:{queryBalanceCost:{ver,seq:9,val}}}}));
put('old',2,fresh);put('new',3,p.stateSchema.parse(fresh));
let zero=p.init({id:'zero'},0);zero=p.apply(zero,{seq:0,type:'request/context',data:{model:'deepseek-chat'}});zero=p.apply(zero,{seq:1,type:'assistant/message',data:{turn:1,step:1,usage:{inputTokens:0,outputTokens:0}}});put('zero',3,zero);
const v=p.wire.view(root);assert.equal(v.subagents.length,3);assert.equal(v.subagents[0].waiting,true);assert.equal(v.subagents[0].cost,-1);assert.equal(v.subagents[1].costByCurrency.USD,undefined);assert.equal(v.subagents[1].tokens.output,2);assert.equal(v.subagents[2].cost,0);assert.equal(v.subagents[2].waiting,false);
p.wire.viewSchema.parse(v);
console.log('cold own cost: old cache waiting / currency / real zero / inherited catalog filtering passed');
}finally{if(prev===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prev;rmSync(home,{recursive:true,force:true})}
