import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {extractIncoming} from '../bridge-features.js';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function bridgeSection(start,end){
 const at=source.indexOf(start),stop=source.indexOf(end,at);
 assert.ok(at>=0&&stop>at);
 return source.slice(at,stop);
}

test('a separate QQ dialogue question uses the scoped prior video and protects its evidence',async()=>{
 const owner={key:'private:owner',kind:'private'};
 const qqReadScope=key=>({accountId:'qq-account',personaId:'persona',personaVersion:'version',key});
 const qqMediaKey=(scope,id)=>JSON.stringify([scope.accountId,scope.personaId,scope.personaVersion,scope.key,id]);
 const qqMediaReferences=new Map(),reads=[];
 const addVideoContent=async(data,content,notes,key,options)=>{
  reads.push({data,key,options});
  notes.push('【该音轨窗口的机器转写，仅供理解】实测台词');
  content.videoEvidence=[{status:'streaming',audioStatus:'transcribed'}];
  return true;
 };
 const env={extractIncoming,settings:{media:{}},videoReader:{status:()=>({available:true})},recordsAllowed:()=>true,
  conversationScope:key=>key,qqReadScope,qqMediaKey,qqMediaReferences,addVideoContent,featureState:{generation:0},stopped:false,accountPaused:false};
 const prepare=Function(...Object.keys(env),
  bridgeSection('  const videoCardContexts','  async function addVideoContent')+
  bridgeSection('  function qqMediaDirectory(','  async function readQqAttachment(')+'\nreturn prepareVideoCards;')(...Object.values(env));
 const olderId='56789123',recentId='56789125';
 const remember=(id,file,age)=>qqMediaReferences.set(qqMediaKey(qqReadScope(owner.key),id+':0'),{
  id:id+':0',type:'video',at:Date.now()-age,source:{messageId:id},data:{file},
 });
 remember(olderId,'old-video',40*60000);
 remember(recentId,'recent-video',1000);
 const prompt=(text,reply)=>({_bridgeMemoryUserText:text,message:[
  ...(reply?[{type:'reply',data:{id:reply}}]:[]),{type:'text',data:{text}},
 ]});
 await prepare(owner,prompt('画面上有什么？'),[]);
 await prepare(owner,prompt('她昨天到底说了什么？'),[]);
 await prepare({...owner,key:'private:other'},prompt('刚才的视频台词是什么？'),[]);
 await prepare(owner,prompt('这条消息说了什么？','56789126'),[]);
 const newVideo=prompt('这段视频的台词是什么？');
 newVideo.message.push({type:'video',data:{file:'new-video'}});
 await prepare(owner,newVideo,[]);
 assert.equal(reads.length,0);
 const content=[],protectedParts=new Set();
 await prepare(owner,prompt('也听听视频里的台词。'),content,protectedParts);
 assert.deepEqual(reads[0],{data:{file:'recent-video',start:0,audio:true},key:owner.key,options:{transcribe:true}});
 assert.equal(content.hasRich,true);
 assert.match(content[0].text,/实测台词/);
 assert.ok(protectedParts.has(content[0]));
 await prepare(owner,prompt('这段视频说了什么？',olderId),[]);
 assert.equal(reads[1].data.file,'old-video');
});

test('explicit mobile video dialogue uses ASR and reports only the observed audio window',async()=>{
 const scope=['a','persona','private:owner',1],scopeId=JSON.stringify(scope);
 const clip=Buffer.from('decoded-audio'),calls=[];
 let desktop=false,scopeChanged=false,fail=false;
 const settings={media:{voice:true},localChat:{enabled:false}};
 const measured={status:'measured',start:0,end:5.8,coveredSeconds:5.8};
 const asr=async(bytes,media,options)=>{
  calls.push({bytes,configured:!!media.asrApiKey,options});
  if(fail)throw new Error('ASR temporarily unavailable');
  return {text:'你好，这是手机语音识别测试。',source:'api-asr'};
 };
 const phase=bridgeSection('  async function listenVideoWindow(','  videoReader=createVideoReader(');
 const create=()=>Function('settings','videoScope','recordsAllowed','stopped','accountPaused','isDesktop',
  'speechRecognitionSettings','requestAudioTranscription','audioAnalysis',phase+'\nreturn listenVideoWindow;')(
  settings,key=>JSON.stringify(['a',scopeChanged?'other':'persona',key,1]),()=>true,false,false,desktop,()=>({asrApiKey:'test'}),asr,
  {videoWindow:async()=>measured});
 const sample={clip,start:0,end:5.8,transcribe:true};
 assert.deepEqual(await create()({...sample,transcribe:false},scopeId),measured);
 const group=JSON.stringify(['a','persona','group:other',1]);
 assert.deepEqual(await create()(sample,group),measured);
 desktop=true;
 assert.deepEqual(await create()(sample,scopeId),measured);
 desktop=false;
 settings.media.voice=false;
 assert.equal((await create()(sample,scopeId)).speechStatus,'unavailable');
 settings.media.voice=true;
 assert.equal(calls.length,0);
 const result=await create()(sample,scopeId);
 assert.equal(calls.length,1);
 assert.equal(calls[0].bytes,clip);
 assert.equal(calls[0].options.filename,'video-window.wav');
 assert.equal(result.speechSource,'api-asr');
 assert.equal(result.coveredSeconds,5.8);
 assert.deepEqual(result.segments,[{start:0,end:5.8,text:'你好，这是手机语音识别测试。'}]);
 fail=true;
 assert.deepEqual(await create()(sample,scopeId),{...measured,speechStatus:'failed'});
 scopeChanged=true;
 assert.equal(await create()(sample,scopeId),null);
 assert.equal(calls.length,2);
});
