import test from 'node:test';import assert from 'node:assert/strict';
import {qqTaskEvidence,qqGroupName} from '../qq-task-evidence.js';import {localGroupSendRequest,executeLocalGroupSend} from '../local-qq-task.js';
test('real failed wording variants enter task execution and recaps remain questions',()=>{
 for(const text of ['你去这个群冒一下泡200000002','你去这个群冒200000002，发一句“你好”','去这个群200000002发一句“你好”','到200000002群发一句你好','你去那个群冒泡'])assert.equal(localGroupSendRequest(text),true,text);
 for(const text of ['刚刚在这个群200000001，你记得自己说了啥嘛','我叫你发你好的群是哪一个，名字叫什么','不要去这个群200000002发一句你好','你刚才去这个群200000002发一句你好了吗','你去过群里打招呼了吗'])assert.equal(localGroupSendRequest(text),false,text);
});
test('explicit quoted text bypasses composition and sends once to the matching allowed group',async()=>{
 let model=0;const calls=[];
 const result=await executeLocalGroupSend({request:'你去这个群冒200000002，发一句“你好”',messages:[],model:async()=>{model++;return 'wrong';},tools:{bridge_tools:{execute:async call=>{const a=call.arguments;calls.push(a);return a.action==='targets'?{ok:true,targets:[{key:'group:200000002',name:'实际群名'},{key:'group:200000001'}]}:a.action==='send'?{ok:true,deliveryId:'d',deliveryIds:['d']}:{ok:true,status:'pending'};}}}});
 assert.equal(model,0);assert.equal(calls.find(c=>c.action==='send').text,'你好');assert.equal(calls.find(c=>c.action==='send').target,'group:200000002');assert.equal(result.execution.name,'实际群名');assert.equal(result.execution.text,'你好');assert.equal(result.execution.status,'pending');
});
test('cross-chat recap is grouped by actual target and isolated by account/persona/whitelist',()=>{
 const now=Date.now(),options={now,accountId:'a',personaId:'p',allowedGroups:['200000002','200000001'],tasks:[{at:now,accountId:'a',personaId:'p',target:'group:200000002',name:'甲群',text:'你好',deliveryId:'j',status:'pending'}],outbox:[{id:'j',at:now,accountId:'a',personaId:'p',chat:'group:200000002',status:'sent',messageId:'m',segments:[{type:'text',data:{text:'你好'}}]},{id:'other',at:now,accountId:'b',personaId:'p',chat:'group:200000001',status:'sent',segments:[{type:'text',data:{text:'其他账号隐私'}}]}]};
 const missing=qqTaskEvidence('刚刚在这个群200000001，你记得说了什么吗',options);assert.equal(missing.groups[0].messages.length,0);assert.match(missing.groups[0].coverage,/没有查到/);assert.doesNotMatch(JSON.stringify(missing),/你好|其他账号隐私/);
 const last=qqTaskEvidence('我叫你发你好的群是哪一个，名字叫什么',options);assert.equal(last.groups[0].name,'甲群');assert.equal(last.groups[0].messages[0].messageId,'m');assert.equal(last.groups[0].messages[0].text,'你好');assert.equal(qqTaskEvidence('刚才在200000001群说了什么',{...options,allowedGroups:[]}),null);
});

test('QQ group display name removes internal font markers and control bytes, retaining actual visible text',()=>{assert.equal(qqGroupName('<$ǿĀD\u000e>动漫群<$ÿĀ\u0011\u0010>④'),'动漫群④');assert.equal(qqGroupName('正常群名'),'正常群名');});
