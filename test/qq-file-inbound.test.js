import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createQqFileTransfer,normalizeQqFileNotice} from '../qq-file-transfer.js';
import {segmentsOf,extractIncoming} from '../bridge-features.js';
import {qqHumanWords} from '../qq-poke.js';
const source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name,deps){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0,'missing '+name);for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){try{return Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+')')(...Object.values(deps));}catch(e){if(e instanceof SyntaxError)continue;throw e;}}throw Error(name);}
function host({allowed=['12345','54321']}={}){const rows=[];const settings={activeAccountId:'a'};const service=createQqFileTransfer({rows:()=>rows,save(){},authorize:()=>true});const receive=extract('receiveQqFilePayload',{stopped:false,accountPaused:false,normalizeQqFileNotice,settings,segmentsOf,effectiveGroups:()=>allowed,effectiveUsers:()=>allowed,recordsAllowed:()=>true,groupStopped:()=>false,activePersona:()=>({id:'p'}),qqFileTransfer:service});const notice={post_type:'notice',notice_type:'offline_file',self_id:'99999',user_id:'12345',file:{id:'f1',name:'报告.pdf',size:1024}};return {rows,receive,notice,service};}
test('file notice metadata is host text, never the sender words or an approval phrase',()=>{const h=host(),p=h.receive(structuredClone(h.notice));
 assert.equal(qqHumanWords(segmentsOf(p.message)),'','host file hint must not become user words');
 const hint=segmentsOf(p.message).find(s=>s._qqFileHint);assert.equal(hint.data._bridgeEvent,true);
 assert.match(extractIncoming(p.message,p.self_id).text,/bridge_qq_file/,'the model still gets the real file hint');
 assert.match(extractIncoming(p.message,p.self_id).text,/\u6587\u4ef6\u6b63\u6587\u672a\u8bfb\u53d6|\u672a\u4e0b\u8f7d\u524d\u4e0d\u80fd\u58f0\u79f0\u5df2\u8bfb\u6b63\u6587/);
 assert.equal(p._bridgeMemoryUserText,'');
});
test('a file-only message stays non-empty for routing while its user words stay empty',()=>{const h=host(),p=h.receive(structuredClone(h.notice));const text=extractIncoming(p.message,p.self_id).text.trim();assert.ok(text.length>0);assert.equal(text.replace(/\[文件\]/,'').trim().startsWith('【QQ实际收到的文件附件】'),true);assert.equal(segmentsOf(p.message).filter(s=>s.type==='file').length,1);});
test('the same notice twice yields one record and one stable message id',()=>{const h=host();const a=h.receive(structuredClone(h.notice)),b=h.receive(structuredClone(h.notice));assert.equal(a.message_id,b.message_id);assert.equal(h.rows.length,1);assert.equal(h.service.list({accountId:'a',personaId:'p',key:'private:12345'}).files.length,1);});
test('an unknown sender never gets a file record or a hint',()=>{const h=host({allowed:['54321']});const p=h.receive(structuredClone(h.notice));assert.equal(h.rows.length,0);assert.equal(segmentsOf(p.message).some(s=>s._qqFileHint),false);});
test('saved QQ file records are pruned by permission and length',()=>{const featureState={outbox:[],inbox:[],conversation:{},companionSoul:{},audits:[],mediaTasks:[],qqActions:[],qqFiles:[]};
 for(let i=0;i<260;i++)featureState.qqFiles.push({id:'k'+i,key:i%2?'private:12345':'private:99999'});
 const save=extract('saveFeatures',{featureState,recordsAllowed:key=>key==='private:12345',writeAtomic(){},featureFile:'x',log(){}});
 assert.equal(save(),true);
 assert.equal(featureState.qqFiles.every(r=>r.key==='private:12345'),true);
 assert.equal(featureState.qqFiles.length,130);
 assert.equal(featureState.qqFiles.at(-1).id,'k259');
});
test('a downloaded binary is not reported as read text while a text file keeps a labelled preview',async()=>{
 const fsx=await import('node:fs');const pathx=(await import('node:path')).default;const osx=(await import('node:os')).default;
 const root=fsx.mkdtempSync(pathx.join(osx.tmpdir(),'qq-file-binary-'));
 const scope={accountId:'a',personaId:'p',key:'private:12345'},rows=[];
 const service=createQqFileTransfer({rows:()=>rows,save(){},rootFor:()=>root,authorize:()=>true,request:async()=>({url:'https://example.com/f'}),fetchImpl:async()=>new Response(Buffer.from([0x25,0x50,0x44,0x46,0,1,2,3]))});
 const [pdf]=service.observe({user_id:'12345',message:[{type:'file',data:{id:'b1',name:'手册.pdf',size:8}}]},scope);
 const binary=await service.download(pdf.id,scope);
 assert.equal(binary.preview,undefined);assert.match(binary.coverage,/尚未解析正文/);
 const textService=createQqFileTransfer({rows:()=>rows,save(){},rootFor:()=>root,authorize:()=>true,request:async()=>({url:'https://example.com/t'}),fetchImpl:async()=>new Response('hello\n')});
 const [txt]=textService.observe({user_id:'12345',message:[{type:'file',data:{id:'t1',name:'说明.txt',size:6}}]},scope);
 const text=await textService.download(txt.id,scope);
 assert.equal(text.preview,'hello\n');assert.match(text.coverage,/文本预览/);
 fsx.rmSync(root,{recursive:true,force:true});
});
test('a failing record store keeps the message but never invents a file record',()=>{
 const logs=[],settings={activeAccountId:'a'};
 const broken={observe(){throw Error('文件记录保存失败');},list:()=>({ok:true,files:[]})};
 const receive=extract('receiveQqFilePayload',{stopped:false,accountPaused:false,normalizeQqFileNotice,settings,segmentsOf,effectiveGroups:()=>['54321'],effectiveUsers:()=>['12345'],recordsAllowed:()=>true,groupStopped:()=>false,activePersona:()=>({id:'p'}),qqFileTransfer:broken,log:m=>logs.push(String(m))});
 const p=receive({post_type:'notice',notice_type:'offline_file',self_id:'99999',user_id:'12345',file:{id:'f1',name:'报告.pdf',size:1024}});
 assert.equal(p.post_type,'message');assert.equal(segmentsOf(p.message).some(s=>s._qqFileHint),false);assert.equal(segmentsOf(p.message).filter(s=>s.type==='file').length,1);assert.ok(logs.length===1);assert.match(logs[0],/文件记录失败/);
});
