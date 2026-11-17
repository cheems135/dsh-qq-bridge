import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {extractIncoming,segmentsOf} from '../bridge-features.js';
import {createQqImageInput} from '../qq-image-input.js';
import {mergeGroupWindow} from '../group-conversation.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name,deps){
 const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));
 for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){
  let f;try{f=Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+');');}catch(e){if(e instanceof SyntaxError)continue;throw e;}
  return f(...Object.values(deps));
 }throw Error(name);
}
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8hZJwAAAABJRU5ErkJggg==';
const image={type:'image',data:{file:'base64://'+png}};
function fixture({messages={},scopeChange=false}={}){
 const catalog=[],calls=[],state={account:'a'},input=createQqImageInput();let read;
 const deps={settings:{activeAccountId:'a'},featureState:{outbox:[]},messages:[],qqReadScope:key=>({key,accountId:state.account,personaId:'p'}),request:async(_a,args)=>{calls.push(args.message_id);if(scopeChange)state.account='b';return messages[String(args.message_id)];},extractIncoming,imagePart:async data=>({type:'image',mediaType:'image/png',data:Buffer.from(await input.read(data)).toString('base64')}),createHash,recordedImages:()=>[],join,messagesDir:'/fixture',rememberQqMedia:(_key,p,index,s)=>{catalog.push({id:p.message_id+':'+index,segment:s});return p.message_id+':'+index;},groupSpeakerLabel:id=>id,readQuotedImageContext:(...args)=>read(...args)};
 read=extract('readQuotedImageContext',deps);
 const shared=extract('sharedContext',{extractIncoming,settings:{media:{link:false}},readQuotedImageContext:read});
 const content=extract('buildContent',{sharedContext:shared,qqHumanWords:s=>s.filter(x=>x.type==='text').map(x=>x.data.text).join('\n'),segmentsOf,rememberQqMedia:()=>'',settings:{owners:[]},messages:[],activePersona:()=>({id:'p'}),recentSentMediaContext:()=>''});
 return {read,content,catalog,calls};
}
const original=message=>({group_id:123456,user_id:234567,sender:{user_id:234567},message});
test('group quote with images=none delivers actual bytes into API prompt and registers the selected image',async()=>{
 const f=fixture({messages:{100:original([image])}});
 const p={message_type:'group',group_id:123456,user_id:234567,self_id:345678,message_id:200,message:[{type:'reply',data:{id:'100'}},{type:'text',data:{text:'看看这张图'}}],_groupPlan:{images:'none'}};
 const merged=mergeGroupWindow([p],{respond:true,focusIds:['200'],images:'none',depth:'normal'});
 const result=await f.content(merged,'看看这张图','group:123456');
 assert.equal(result.filter(x=>x.type==='image').length,1);
 assert.equal(result.find(x=>x.type==='image').data,png);
 assert.equal(result.references[0].mediaStatus,'read');assert.equal(result.uncertain,false);
 assert.equal(merged._groupPlan.images,'detail');
 assert.equal(f.catalog[0].id,'100:0');
});
test('nested reply resolves selected original without relying on the recent history window',async()=>{
 const f=fixture({messages:{100:original([{type:'reply',data:{id:'90'}}]),90:original([image])}});
 const r=await f.read({_groupPlan:{images:'none'}},'group:123456','100');
 assert.deepEqual(f.calls,[100,90]);assert.equal(r.images[0].data,png);assert.equal(r.reference.mediaStatus,'read');
});
test('quoted mface can be seen, cycle is finite, unrelated group and changed account remain rejected',async()=>{
 const m=fixture({messages:{100:original([{...image,type:'mface'}])}});assert.equal((await m.read({},'group:123456','100')).images.length,1);
 const c=fixture({messages:{100:original([{type:'reply',data:{id:'100'}}])}});const r=await c.read({},'group:123456','100');assert.equal(c.calls.length,1);assert.equal(r.reference.status,'partial');
 const other=fixture({messages:{100:{...original([image]),group_id:999999}}});await assert.rejects(other.read({},'group:123456','100'),/不属于/);assert.equal(other.catalog.length,0);
 const changed=fixture({messages:{100:original([image])},scopeChange:true});await assert.rejects(changed.read({},'group:123456','100'),/账号或人设改变/);
});
