import test from 'node:test';
import assert from 'node:assert/strict';
import {createQqNativeCapabilities} from '../qq-native-capabilities.js';
import {spaceAccessAllowed} from '../qzone-policy.js';
import {claimSpaceComment} from '../social-pacing.js';
import {createQzoneService} from '../qzone-service.js';
import {createSelfProfileReader} from '../qq-self-profile.js';
import {VOICE_MOODS,normalizeVoiceMood,resolveVoiceDelivery,breezeSpeech} from '../voice-studio.js';

const context={accountId:'account',personaId:'persona',key:'private:12345',kind:'private',userId:'12345'};
test('reading the authenticated bots own profile is not blocked by the contact whitelist; other targets and self-directed writes remain checked',async()=>{
 const calls=[],c={...context,receiverId:'99999'};
 const native=createQqNativeCapabilities({allowedUsers:()=>['12345'],isOwner:()=>true,request:async(action,params)=>{calls.push({action,params});return {status:'ok',data:{user_id:params.user_id,nickname:'角色',long_nick:'已核实的签名'}};}});
 assert.equal((await native.call({action:'get_stranger_info',params:{user_id:'99999'}},c)).ok,true);
 assert.equal((await native.call({action:'get_stranger_info',params:{user_id:'77777'}},c)).ok,false);
 assert.equal((await native.call({action:'send_like',params:{user_id:'99999',times:1}},c)).ok,false);
 assert.equal(calls.length,1);assert.equal(calls[0].action,'get_stranger_info');
});
test('self profile actions reach the transport once, expose real parameters, and keep account credentials out of the writable schema',async()=>{
 const sent=[];
 const native=createQqNativeCapabilities({isOwner:()=>true,request:async(action,params)=>{sent.push({action,params});return {status:'ok',retcode:0,data:null};}});
 const requests=[['set_self_longnick',{longNick:'今天想去看海'}],['set_qq_profile',{nickname:'海岸来信'}],['set_qq_avatar',{file:'D:/prepared/portrait.png'}],['set_online_status',{status:10,ext_status:1016,battery_status:0}],['set_diy_online_status',{face_id:1,face_type:1,wording:'正在画画'}]];
 for(const [action,params]of requests){const row=native.catalog(context).find(row=>row.action===action);assert(row);assert(Object.keys(params).every(key=>row.parameters.includes(key)));const result=await native.call({action,params},context);assert(result.ok);assert.equal(result.verified,false);}
 assert.equal(sent.length,requests.length);
 for(const params of [{},{nickname:'new',cookie:'private'},{nickname:{text:'new'}}])assert.equal((await native.call({action:'set_qq_profile',params},context)).ok,false);
 assert.equal((await native.call({action:'set_qq_avatar',params:{file:'https://example.invalid/private'}} ,context)).ok,false);
 assert.equal((await native.call({action:'set_qq_profile_background',params:{file:'D:/prepared/bg.png'}},context)).ok,false);
 const outsider=createQqNativeCapabilities({isOwner:()=>false,request:async()=>{throw Error('must not execute');}});
 assert.equal((await outsider.call({action:'set_qq_profile',params:{nickname:'someone else'}},context)).ok,false);
 assert.equal(sent.length,requests.length);
});

test('open space access permits context-driven visits and distinct comments while retaining duplicate suppression',async()=>{
 const c={...context,meta:{kind:'proactive'}},settings={qzoneAccess:{enabled:true},permissionsMode:'open-nonpayment'};
 assert(spaceAccessAllowed(settings,[],c));
 assert.equal(spaceAccessAllowed({...settings,permissionsMode:'configured'},[],c),false);
 assert.equal(spaceAccessAllowed({...settings,qzoneAccess:{enabled:false}},[],c),false);
 let posts=0;
 const service=createQzoneService({storage:{read:()=>({entries:[],comments:[],posts:[{scope:JSON.stringify([c.accountId,c.personaId]),uin:'12345',tid:'post1'}]}),write:()=>{}},getAuth:async()=>({uin:'12345',gtk:123,cookie:'uin=12345; skey=fixture'}),beforeWrite:(row,c)=>claimSpaceComment([],c,row,Date.now(),{unrestricted:true}),fetchImpl:async()=>{posts++;return Response.json({code:0,data:{commentid:String(posts)}});}});
 const first={text:'这个配色很好看',target:{uin:'12345',tid:'post1'},comment:true};
 assert((await service.publish(first,c)).ok);
 assert((await service.publish(first,c)).duplicate);
 assert((await service.publish({...first,text:'后面那一笔也有意思'},c)).ok);
 assert.equal(posts,2);
});

test('profile modifications invalidate the cached nickname and signature without waiting five minutes',async()=>{
 const connection={ready:true},scope={state:'ready',accountId:'account',selfId:'12345',revision:1,connection};let nickname='before',reads=0;
 const read=createSelfProfileReader({getScope:()=>scope,request:async()=>{reads++;return {user_id:'12345',nickname,long_nick:'signature',status:10};}});
 assert.equal((await read()).nickname,'before');nickname='after';assert.equal((await read()).nickname,'before');assert.equal(reads,1);
 read.invalidate();assert.equal((await read()).nickname,'after');assert.equal(reads,2);
});

test('daily descriptive emotions and mixed or negated feelings survive normalization',()=>{
 const cases=[['温柔地安慰','gentle'],['有点羞涩','shy'],['得意地说','smug'],['如释重负松了口气','relieved'],['有些困惑','confused'],['语气很认真','serious'],['疲惫又困倦','tired'],['带着期待','anticipation'],['感到内疚','guilt'],['有些嫌弃','disgust'],['无可奈何地说','helpless'],['有点酸溜溜','jealousy'],['好奇地追问','curiosity'],['语气满是讽刺','sarcastic'],['孤独又寂寞','lonely'],['有些忐忑','anxiety'],['心疼地说','pity'],['冷淡而疏离','cold'],['开心又害羞','happy+shy'],['不哭了，松了口气','relieved'],['不是愤怒而是开心','happy'],['带笑但有些无奈','laugh+helpless']];
 for(const [label,expected]of cases)assert.equal(normalizeVoiceMood(label),expected,label);
});

test('every speech mood reaches the synthesis payload with a direction even when a saved timbre instruction exists',async()=>{
 const mp3=Buffer.alloc(1200);mp3.write('ID3');const text='你终于回来了。';
 for(const {id}of VOICE_MOODS.filter(row=>row.id!=='auto')){
  const config={emotion:id,breeze:{apiKey:'fixture',voiceId:'voc_fixture',guidance:2,instructions:'保持当前音色'}};
  const plan=resolveVoiceDelivery(config,{text});let payload;
  await breezeSpeech(text,config,plan,async(_url,options)=>{payload=JSON.parse(options.body);return new Response(mp3);});
  assert.equal(payload.text,text,id);assert.match(payload.instructions,/保持当前音色/,id);assert.match(payload.instructions,/用.+的语气说/,id);assert.equal(payload.voice_settings.guidance_scale,2,id);assert.equal(payload.instructions,plan.instructions,id);
 }
 const direction='先忍着笑，越说越得意，到最后又有点不好意思';
 const plan=resolveVoiceDelivery({emotion:'auto'},{text},{delivery:{emotion:'开心又害羞',instructions:direction}});
 assert.equal(plan.emotion,'happy+shy');assert(plan.instructions.startsWith(direction));
 const free=resolveVoiceDelivery({emotion:'五味杂陈，想说又欲言又止'},{text});assert.match(free.instructions,/五味杂陈/);
});
