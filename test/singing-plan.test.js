import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync,mkdirSync,existsSync,cpSync} from 'node:fs';
import {join,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCoverLibrary,isRenderedCoverFilename} from '../cover-library.js';
import {parseSingingRequest,selectSingingPlan,singingSegment} from '../singing-plan.js';
import {isRunningHubCover,normalizeRunningHubAudio} from '../runninghub-audio.js';
import {selectReferenceSinging,sameMusicReference} from '../singing-policy.js';
import {mergeSyncJson} from '../sync-union.js';

const config={id:'2058763737900867585',songAudio:'api/qingtian.wav',songTitle:'晴天',songArtist:'原唱',songIdentityAudio:'api/qingtian.wav',nodeInfoList:[{nodeId:'5',fieldName:'audio',fieldValue:'{{song_audio}}'}]};
const sourceSong={title:'晴天',artist:'原唱',audio:config.songAudio,verified:true};
const accepted={id:'saved',title:'晴天',artist:'原唱',quality:'accepted',identityVerified:true,sourceSong,at:1};

test('song identity decides reuse, new rendition, missing source, and ambiguous names without substituting the default song',()=>{
 assert.equal(selectSingingPlan({request:'唱《晴天》',config,versions:[accepted]}).action,'reuse');
 const fresh=selectSingingPlan({request:'重新唱《晴天》',config,versions:[accepted]});assert.equal(fresh.action,'generate');assert.equal(fresh.audio,config.songAudio);
 for(const request of ['再唱一遍《晴天》','再给我唱一次《晴天》'])assert.equal(selectSingingPlan({request,config,versions:[accepted]}).action,'reuse',request);
 assert.equal(selectSingingPlan({request:'我要你唱《晴天》，不是播放上次的',config,versions:[accepted]}).action,'generate');
 assert.equal(selectSingingPlan({request:'唱《稻香》',config,versions:[accepted]}).action,'need-source');
 assert.equal(selectSingingPlan({request:'唱首新歌',config,versions:[accepted]}).action,'need-source');
 assert.equal(selectSingingPlan({request:'唱晴天吧',config}).title,'晴天');
 assert.equal(selectSingingPlan({request:'想听你唱稻香',config}).action,'need-source');
 assert.equal(selectSingingPlan({request:'唱《晴天》',title:'稻香',config}).action,'clarify');
 assert.equal(selectSingingPlan({request:'唱《晴天》',config,versions:[accepted,{...accepted,id:'other',artist:'另一原唱'}]}).action,'clarify');
 assert.equal(selectSingingPlan({request:'唱《晴天》',config,versions:[{...accepted,quality:'unreviewed'}]}).action,'review');
 assert.equal(selectSingingPlan({request:'唱《晴天》',config,versions:[{...accepted,quality:'rejected'}]}).action,'generate');
 const changed={...config,songAudio:'api/another.wav'};assert.equal(selectSingingPlan({request:'唱《晴天》',config:changed}).action,'need-source');
});

test('the reported pronoun request resolves an actual recent song proposal or card, and an unresolved reference never runs the default',()=>{
 assert.equal(selectSingingPlan({request:'想听你唱这个',config}).action,'need-source');
 const context=[{role:'assistant',text:'要不要听我唱《晴天》？'}];
 assert.equal(parseSingingRequest('想听你唱这个',context).title,'晴天');
 assert.equal(selectSingingPlan({request:'想听你唱这个',context,config}).action,'generate');
 const card=[{role:'user',text:'分享了一首歌',rawText:'[分享卡片] 稻香 · 作者/歌手：原唱'}];
 assert.equal(selectSingingPlan({request:'想听你唱这个',context:card,config}).action,'need-source');
 assert.equal(selectSingingPlan({request:'想听你唱这个',context:[{role:'assistant',text:'《晴天》还是《稻香》？'}],config}).action,'clarify');
});

test('a recently verified music identity wins over the configured default even without a pronoun',()=>{
 const current={title:'稻香',artist:'另一原唱'};
 for(const request of ['其实我想听你唱','咋还没好','唱这个']){
  const plan=selectSingingPlan({request,config,contextSong:current});assert.equal(plan.title,'稻香',request);assert.equal(plan.action,'need-source');
 }
 assert.equal(selectSingingPlan({request:'唱《晴天》',config,contextSong:current}).title,'晴天');
 assert.equal(selectSingingPlan({request:'唱这个',context:[{role:'assistant',text:'《晴天》要不要？'}],config,contextSong:current}).title,'稻香');
 assert.equal(selectSingingPlan({request:'我想听你唱',config,contextSong:{pendingIdentity:true}}).action,'need-source');
 assert.equal(selectSingingPlan({request:'换一首新歌',config,contextSong:current}).action,'need-source');
});

test('confirmed renditions survive workflow changes and ordinary repeat requests without charging',()=>{
 const version={...accepted,workflowKey:'previous-workflow'};
 for(const request of ['唱《晴天》','再唱一遍《晴天》','换一首《晴天》'])assert.equal(selectSingingPlan({request,config,versions:[version],workflowKey:'new-workflow'}).action,'reuse');
 assert.equal(selectSingingPlan({request:'重新唱《晴天》',config,versions:[version],workflowKey:'new-workflow'}).action,'generate');
 assert.equal(selectSingingPlan({request:'唱《晴天》前30秒',config,versions:[version]}).action,'need-source','a full rendition cannot be mislabeled as the requested clip');
});

function fixture(t){const root=mkdtempSync(join(process.cwd(),'song-identity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const file=join(root,'source.wav');const bytes=Buffer.alloc(256);bytes.write('RIFF');bytes.write('WAVE',8);writeFileSync(file,bytes);return {root,file,bytes,library:createCoverLibrary({root:()=>join(root,'library'),scope:()=>['account','persona']})};}

test('new renditions record title, artist, source, version and tags; feedback blocks both saved and original files across synchronization',t=>{
 const {root,file,library}=fixture(t);
 const song=library.save('晴天',file,{sourceSong,artist:'原唱',autoSaved:true,originInvocationId:'job'});
 assert.equal(song.quality,'unreviewed');assert(song.tags.includes('晴天'));assert(song.tags.includes('原唱'));assert.equal(song.sourceSong.audio,config.songAudio);assert(song.version);assert.equal(library.find('晴天'),null);
 library.review(song.id,{quality:'accepted',feedbackQuote:'这版不错'});assert.equal(library.find('晴天').id,song.id);
 const original=join(root,'rh-audio-original.wav');cpSync(file,original);
 library.review(song.id,{quality:'rejected',feedbackQuote:'跑调了，不要再发这版'});assert.equal(library.find('晴天'),null);assert(library.isRejectedFile(original));
 const metadata=JSON.parse(readFileSync(song.file.replace(/\.wav$/,'.json'),'utf8'));assert.equal(mergeSyncJson(song,metadata).quality,'rejected');
 assert.throws(()=>library.save('稻香',file,{sourceSong,autoSaved:true}),/原曲不一致/);
 library.remove(song.id);assert(library.isRejectedFile(original),'deleting the library copy must not allow an old reference to resend the bad bytes');
 const normalized=normalizeRunningHubAudio({sing:config}).sing;assert.equal(normalized.songTitle,'晴天');assert.equal(normalized.songIdentityAudio,config.songAudio);
});

test('legacy unlabeled versions stay visible but cannot become an automatic match just because their title was once typed',t=>{
 const {library,file}=fixture(t);const row=library.save('晴天',file);
 const metadata=JSON.parse(readFileSync(row.file.replace(/\.wav$/,'.json'),'utf8'));delete metadata.quality;delete metadata.identityVerified;writeFileSync(row.file.replace(/\.wav$/,'.json'),JSON.stringify(metadata));
 assert.equal(library.list().length,1);assert.equal(library.get(row.id).quality,'unreviewed');assert.equal(library.find('晴天'),null);
});

const host=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name,deps){const start=host.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0);for(let end=host.indexOf('}',start);end>=0;end=host.indexOf('}',end+1)){let fn;try{fn=Function(...Object.keys(deps),'return ('+host.slice(start,end+1)+')');}catch(error){if(error instanceof SyntaxError)continue;throw error;}return fn(...Object.values(deps));}throw Error(name);}

test('the real host never treats a previously prepared song as a newly supplied music reference',()=>{
 const key='private:12345',source={title:'稻香',artist:'原唱',audio:'api/correct.mp3',songId:'456',duration:207,verified:true};
 const reference={id:'actual',input:{id:'456',title:'稻香',author:'原唱'}};
 const plan=extract('singingPlanFor',{settings:{activeAccountId:'a',voice:{runninghub:{sing:config}}},activePersona:()=>({id:'p'}),localAudioWorkflows:null,localSingingSources:null,singingSources:{list:()=>[source]},singingReferenceFor:k=>k===key?reference:null,musicContextByChat:new Map(),conversationScope:()=> 'scope',sameMusicReference,coverLibraryFor:()=>({list:()=>[]}),singingUsageFor:()=>[],singingInventoryFor:()=>[],featureState:{mediaTasks:[]},singingSegment,selectReferenceSinging});
 assert.equal(plan('咋还没好',key).audio,source.audio);assert.equal(plan('唱歌','private:67890').action,'empty');
});

test('an already confirmed referenced recording never downloads or uploads the original again',async()=>{
 let remembered=0;
 const resolve=extract('resolveSingingPlanFor',{localAudioWorkflows:null,localSingingSources:null,singingSegment,parseSingingRequest,singingContextFor:()=>[],singingPlanFor:()=>({action:'reuse',title:'晴天',version:accepted}),singingSources:{prepare:()=>{throw Error('unnecessary upload');}},stopped:false,accountPaused:false,rememberSingingSource:(_key,source)=>{assert.equal(source,accepted.sourceSong);remembered++;}});
 assert.equal((await resolve('再唱这首','private:12345')).action,'reuse');
 assert.equal(remembered,1);
});

test('cached prepared sources take the durable binding path before returning, without another upload',async()=>{
 const state={},memory=new Map(),source={...sourceSong,duration:207};let saved=0;
 const remember=extract('rememberSingingSource',{featureState:state,musicContextByChat:memory,conversationScope:key=>'p/'+key,textHash:v=>v,saveFeatures:()=>{saved++;return true;}});
 const resolve=extract('resolveSingingPlanFor',{localAudioWorkflows:null,localSingingSources:null,singingSegment,parseSingingRequest,singingContextFor:()=>[],singingPlanFor:()=>({action:'generate',title:'晴天',sourceSong:source}),singingSources:{prepare:()=>{throw Error('unnecessary upload');}},stopped:false,accountPaused:false,rememberSingingSource:remember});
 const result=await resolve('想听你唱','private:12345');assert.equal(result.sourceSong,source);
 assert.equal(saved,1);assert.equal(state.singingContext['p/private:12345'].source,source);assert.equal(memory.get('private:12345').source,source);
 const failed=extract('rememberSingingSource',{featureState:state,musicContextByChat:memory,conversationScope:key=>'p/'+key,textHash:v=>v,saveFeatures:()=>false});
 assert.throws(()=>failed('private:12345',{...source,title:'另一首'}),/未保存/);
 assert.equal(state.singingContext['p/private:12345'].source,source);assert.equal(memory.get('private:12345').source,source);
});

test('the sing tool binds a corrected song to the existing reply executor instead of stopping after preparation',async()=>{
 const audit={id:'a',accountId:'account',chat:'private:12345',status:'running',mediaIntent:{kinds:[]}},meta={auditId:'a',kind:'user',userWords:'笨蛋是这个呀'};
 const source={id:'source-correct',title:'稻香',artist:'原唱',audio:'api/correct.mp3',duration:207,verified:true};let saved=0;
 const sing=extract('songLibraryAction',{toolActorIsOwner:()=>true,settings:{owners:[],activeAccountId:'account'},coverLibraryFor:()=>({}),recentCoverInvocations:()=>[],auditById:()=>audit,agencyAuthorized:()=>true,
  resolveSingingPlanFor:async(_request,_key,options)=>{assert.equal(options.title,'稻香');return {action:'generate',title:'稻香',artist:'原唱',sourceSong:source};},saveFeatures:()=>{saved++;return true;}});
 const result=await sing({action:'sing',title:'稻香'},{key:audit.chat,meta});
 assert.equal(result.scheduledAfterReply,true);assert.equal(result.generated,false);assert.equal(saved,1);
 assert.equal(audit.mediaIntent.cover,true);assert.deepEqual(audit.mediaIntent.kinds,['voice']);assert.equal(audit.singingSelection.title,'稻香');
 assert.equal(audit.singingSelection.sourceSong.audio,'api/correct.mp3');
});

test('feedback may reference the exact prepared source ID and still updates its rendered version',async t=>{
 const {root,bytes,library}=fixture(t),file=join(root,'rh-audio-'+randomUUID()+'.wav');writeFileSync(file,bytes);
 const record={id:'rendered',arguments:{sourceSong:{...sourceSong,id:'prepared-source'},songTitle:'晴天'},result:{file}};
 const action=extract('songLibraryAction',{toolActorIsOwner:()=>true,settings:{owners:[]},coverLibraryFor:()=>library,recentCoverInvocations:()=>[record],operationContext:()=>[{role:'user',text:'这版唱错了'}],join,basename,voiceDir:root,publicCover:r=>({id:r.id,title:r.title,quality:r.quality}),saveFeatures:()=>true});
 const result=await action({action:'feedback',id:'prepared-source',quality:'rejected',feedbackQuote:'这版唱错了'},{key:'private:12345'});
 assert.equal(result.cover.quality,'rejected');assert.equal(record.result.song.quality,'rejected');
});

test('the real host rejects the wrong source before charging and automatically archives a correctly bound new rendition',async t=>{
 const {root,library,bytes}=fixture(t);const events=[];let submissions=0;
 const settings={voice:{runninghub:{sing:config}},imagegen:{runninghub:{apiKey:'fixture',baseUrl:'https://example.invalid'}}};
 const dependencies={localAudioWorkflows:null,singingAudioTiming:source=>source?.duration?{song_start:'0:00',song_end:String(source.duration)}:{},singingWorkflowKey:()=> 'workflow-current',songTime:value=>String(value),serviceSource:()=> 'legacy',settings,normalizeVoiceEngine:()=> 'breeze',isRunningHubCover,
  resolveSingingPlanFor:async(request,_key,options)=>selectSingingPlan({request,config,versions:library.list(),...options}),
  textHash:JSON.stringify,invocationScope:()=>({}),randomUUID,recordInvocation:r=>events.push(r),imageStudio:{request:()=>{}},
  renderRunningHubAudio:async options=>{submissions++;assert.equal(options.inputs.song_audio,config.songAudio);return {bytes,extension:'wav',taskId:'12345'};},
  mkdirSync,voiceDir:join(root,'voice'),join,writeFileSync,coverLibraryFor:()=>library,publicCover:r=>({id:r.id,title:r.title,quality:r.quality,tags:r.tags}),diagnosticFailure:e=>e.message,log:()=>{},cleanVoiceError:e=>e.message};
 const render=extract('renderVoiceFile',dependencies);
 await assert.rejects(render('','private:12345',{performance:'sing',songRequest:'唱《稻香》'}),/对应的原曲/);assert.equal(submissions,0);
 const file=await render('','private:12345',{performance:'sing',songRequest:'重新唱《晴天》'});assert(existsSync(file));assert.equal(submissions,1);assert.equal(library.list()[0].title,'晴天');assert.equal(library.list()[0].quality,'unreviewed');assert(events.some(e=>e.arguments?.sourceSong?.title==='晴天'));assert(events.some(e=>e.result?.song?.title==='晴天'));
 library.review(library.list()[0].id,{quality:'accepted'});
 const cached=await render('','private:12345',{performance:'sing',songRequest:'唱《晴天》'});assert.equal(cached,library.list()[0].file);assert.equal(submissions,1);
});

test('the actual library API rejects relabeling a known recording as another song and can stop its original generated file',t=>{
 const {root,bytes,library}=fixture(t),name='rh-audio-'+randomUUID()+'.wav',file=join(root,name);writeFileSync(file,bytes);
 const record={id:'generated',arguments:{sourceSong,songTitle:'晴天'},result:{file,song:{title:'晴天'}}};
 const action=extract('savedCoverAction',{coverLibrary:library,publicCover:r=>({id:r.id,title:r.title,quality:r.quality}),recentCoverInvocations:()=>[record],basename,voiceDir:root,join,isRenderedCoverFilename,featureState:{outbox:[]},saveFeatures:()=>true,existsSync});
 assert.throws(()=>action({action:'save',title:'稻香',invocationId:'generated'}),/不能直接贴成另一首/);
 assert.equal(library.list().length,0);
 const rejected=action({action:'review-generated',invocationId:'generated',quality:'rejected',reason:'跑调'});
 assert.equal(rejected.cover.quality,'rejected');assert(library.isRejectedFile(file));assert.equal(record.result.song.quality,'rejected');
});

test('the real outgoing queue refuses a rejected generated recording even when an old chat still references the original file',t=>{
 const {root,bytes,library}=fixture(t),file=join(root,'rh-audio-'+randomUUID()+'.wav');writeFileSync(file,bytes);
 const row=library.save('晴天',file,{sourceSong});library.review(row.id,{quality:'rejected'});const audit={};
 const queue=extract('queueOutgoing',{scheduledChatHeld:()=>false,lifeExecution:null,deliveryScopeCurrent:()=>true,settings:{activeAccountId:'account'},personaContextIdentity:()=> 'persona',coverLibraryFor:()=>library,auditById:()=>audit,saveFeatures:()=>{},log:()=>{}});
 assert.equal(queue({key:'private:12345',kind:'private',auditId:'turn'},[{type:'record',data:{file}}]),null);
 assert.match(audit.error,/已因跑调或错歌停用/);
});

test('model feedback needs actual user words, and rejecting a recent unnamed rendition preserves its rejected state in the record',async t=>{
 const {root,bytes,library}=fixture(t),file=join(root,'rh-audio-'+randomUUID()+'.wav');writeFileSync(file,bytes);const record={id:'recent',arguments:{},result:{file}};
 const feedback=extract('songLibraryAction',{toolActorIsOwner:()=>true,settings:{owners:[]},coverLibraryFor:()=>library,recentCoverInvocations:()=>[record],operationContext:()=>[{role:'user',text:'这版跑调了，别再发了'}],join,basename,voiceDir:root,publicCover:r=>({id:r.id,title:r.title,quality:r.quality}),saveFeatures:()=>true});
 await assert.rejects(feedback({action:'feedback',id:'recent',quality:'accepted',feedbackQuote:'我唱得很好'},{key:'private:12345'}),/真实|实际/);
 const result=await feedback({action:'feedback',id:'recent',quality:'rejected',feedbackQuote:'这版跑调了，别再发了'},{key:'private:12345'});
 assert.equal(result.cover.quality,'rejected');assert.equal(record.result.song.quality,'rejected');assert(library.isRejectedFile(file));
});
