import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebsiteReading,interestHint} from '../website-reading.js';
import {createLocalInitiative} from '../local-initiative.js';
import {decideInitiative,initiativeChoiceId} from '../api-initiative.js';

const meta={accountId:'a',key:'private:1',personaId:'whale'},origin='https://example.org';
const base=origin+'/blog/studio',bass=origin+'/articles/bass',camera=origin+'/articles/camera';
const text='有人把副歌的第一拍留给贝斯，鼓到第二拍才进来，听起来像有人先迈出了那一步。';
async function example(){
 let stamp=Date.now(),state={records:[],lastPoll:{}},enabled=true;
 const calls=[];
 const engine=createWebsiteReading({config:()=>({enabled,autoShare:true,sources:[{url:origin}]}),now:()=>stamp,
  storage:{read:()=>state,write:s=>state=s},allowed:()=>true,signature:()=>String(enabled),
  readPage:async url=>{calls.push(url);stamp++;return {finalUrl:url,status:'read',title:'贝斯的第一拍',body:text.repeat(4)};}});
 await engine.read(base,meta,{page:{status:'read',finalUrl:base,title:'排练笔记',body:'关于现场排练的文字。'.repeat(15),links:[
  {title:'构图和取景',url:camera},{title:'贝斯为什么晚半拍',url:bass},
  {title:'其他站点的文章',url:'https://other.example/articles/a'},{title:'账户和签入',url:origin+'/account/login'},
 ]}});
 return {engine,calls,clock:()=>stamp,disable:()=>enabled=false,state:()=>state};
}
test('a scoped interest follows one actual article and retains curiosity and one observed detail for a later conversation',async()=>{
 const {engine,calls}=await example(),options={topic:'我还是喜欢现场的贝斯',curiosity:'想弄清这拍贝斯为什么特别'};
 const initial=engine.interest(meta,options);
 assert.equal(initial.lead.url,bass);
 assert.doesNotMatch(interestHint(initial),/鼓到第二拍/);
 assert.equal(await engine.followInterest(meta,{...initial.lead,url:camera},options),null);
 const result=await engine.followInterest(meta,initial.lead,options);
 assert.equal(result.read,true);assert.deepEqual(calls,[bass]);
 const next=engine.interest(meta,options);
 assert.match(interestHint(next),/鼓到第二拍/);assert.equal(next.detail.wantedToKnow,options.curiosity);
 assert.equal(next.lead,null);assert.equal(await engine.followInterest(meta,initial.lead,options),null);
 engine.markShared(meta,bass);assert.doesNotMatch(interestHint(engine.interest(meta,options)),/鼓到第二拍/);
});
test('an unread lead stays private to its account, persona, conversation and history floor; reading remains optional',async()=>{
 const {engine,calls,clock,disable}=await example(),lead=engine.interest(meta).lead;
 for(const scope of [{accountId:'other'},{personaId:'different'},{key:'private:2'},{key:'group:1'}]){
   assert.equal(engine.interest({...meta,...scope}),null);assert.equal(await engine.followInterest({...meta,...scope},lead),null);
 }
 assert.equal(engine.interest(meta,{floor:clock()}),null);
 disable();assert.equal(await engine.followInterest(meta,lead),null);assert.deepEqual(calls,[]);
});
test('local initiative chooses a private goal, reads it without sending, and can share the observation on a later ordinary turn',async()=>{
 const {engine,calls,clock}=await example(),initial=clock(),options={topic:'我喜欢贝斯'};
 let now=initial,sent=[],runs=0,state={};
 const c={allowed:true,activitiesEnabled:true,unrestricted:true,id:'test',signature:'one',accountId:meta.accountId,personaId:meta.personaId,key:meta.key,day:'today',lastIncoming:initial-3600000};
 const local=createLocalInitiative({context:()=>{const reading=engine.interest(meta,options);return {...c,reading,memory:interestHint(reading)};},now:()=>now,load:()=>state,save:(_,v)=>state=v,
  probe:()=>({contextWindow:8192,features:{text:{supported:true},json:{supported:true}}}),
  infer:async({messages})=>{runs++;const prompt=JSON.stringify(messages);if(runs===1){assert.match(prompt,/贝斯为什么晚半拍/);return JSON.stringify({speak:false,readNext:true,activity:'想听明白那拍贝斯'});}assert.match(prompt,/鼓到第二拍/);return JSON.stringify({speak:true,text:'你说喜欢贝斯，我倒想把第一拍留给它试试。'});},
  act:async({context,readNext,request,signal})=>readNext&&(await engine.followInterest(meta,context.reading.lead,{...options,curiosity:request,signal})).read,
  deliver:({text})=>{sent.push(text);return 'delivered';}});
 assert.equal((await local.tick()).status,'activity');assert.equal(sent.length,0);assert.deepEqual(calls,[bass]);
 now+=16*60000;assert.equal((await local.tick()).status,'queued');assert.equal(sent.length,1);assert.equal(runs,2);
});
test('the API can choose real reading independently of ordinary free exploration and silence',async()=>{
 const {engine,calls}=await example(),lead=engine.interest(meta).lead,open={action:'explore',target:'1'},reading={...open,kind:'reading'};
 const actions=[open,reading].map(initiativeChoiceId);
 const result=await decideInitiative({actions,system:'选择一个想做的小目标。',input:lead.title,ask:async()=>JSON.stringify({action:actions[1],text:'想看看两种录法怎么选'})});
 assert.notEqual(actions[0],actions[1]);assert.equal(result.decision.action,actions[1]);
 assert.deepEqual(calls,[]);assert.equal((await engine.followInterest(meta,lead,{curiosity:result.decision.text})).read,true);
});

test('Bilibili articles and Tieba threads become readable leads after opening a source; old snapshots and video links do not claim a discovery',async()=>{
 for(const [site,article] of [['https://www.bilibili.com','/read/cv21864'],['https://tieba.baidu.com','/p/883761']]){
  const now=Date.now(),scope=JSON.stringify([meta.accountId,meta.key,meta.personaId]);
  const legacy={id:'old',scope,url:site+'/',at:now,status:'read',navigationOnly:true};
  const storage={records:[legacy],lastPoll:{}};
  const reader=createWebsiteReading({storage:{read:()=>storage,write:()=>{}},allowed:()=>true,signature:()=>'',config:()=>({enabled:true,sources:[site]})});
  assert.equal(reader.interest(meta),null);
  await reader.read(site,meta,{page:{status:'read',navigationOnly:true,title:'入口',links:[
    {url:site+'/video/BV12345',title:'视频标题不能证明已经看了'},
    {url:site+article+'?spm_id_from=333.9',title:'介绍节奏组的文章'},
    {url:site+'/p/456?xsec_token=secret',title:'带凭据的地址'},
  ]}});
  const popular=reader.interest(meta);
  assert.equal(popular.lead.url,site+article);
  assert.equal(popular.detail,null);
 }
});
