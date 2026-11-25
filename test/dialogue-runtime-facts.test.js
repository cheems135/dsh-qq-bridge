import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {dialogueRuntimeFacts} from '../dialogue-runtime-facts.js';
import {understandLocalTurn} from '../local-understanding.js';
const now=Date.now(),scope={accountId:'account',personaId:'p',key:'private:12345'},signature='解谜卡住了，等你来救我';
const profile={accountId:'account',state:'ready',signature,nickname:'角色',onlineStatus:'在线',updatedAt:now};
test('current QQ profile and verified write receipts remain distinct, old intentions cannot overwrite observed state',()=>{
 const text=dialogueRuntimeFacts({profile,scope,now,actions:[{id:'write',accountId:'account',personaId:'p',action:'signature',at:now-500,status:'confirmed',verified:true,content:'之前想写的句子',intent:'QQ资料签名',contentHash:createHash('sha256').update(signature).digest('hex')}]});
 assert(text.includes(signature));assert(text.includes('之前想写的句子'));assert(text.includes('matchesCurrentSignature'));assert(text.includes('当前人设'));assert(text.includes('QQ资料签名'));
});
test('projection excludes foreign account/profile, other private chats, stale state and arbitrary response fields',()=>{
 const action={accountId:'foreign',action:'signature',content:'别的账号',at:now,secret:'never-show'};
 assert.equal(dialogueRuntimeFacts({profile:{...profile,accountId:'foreign'},scope,now,actions:[action]}),'');
 assert.equal(dialogueRuntimeFacts({profile:{...profile,updatedAt:now-400000},scope,now}),'');
 assert.equal(dialogueRuntimeFacts({scope,now,actions:[{...action,accountId:'account',action:'send_msg',target:{user_id:'other'},content:'其他私聊'}]}),'');
 assert(!dialogueRuntimeFacts({profile,scope,now,actions:[{...action,accountId:'account'}]}).includes('never-show'));
});
test('unrecorded executor is not attributed to current persona and verification polling cannot bury last self-profile change',()=>{
 const actions=[{id:'s',accountId:'account',action:'signature',status:'confirmed',verified:true,at:now-1000},...Array.from({length:100},(_,i)=>({accountId:'account',target:{user_id:'12345'},action:i%2?'get_friend_msg_history':'set_online_status',status:'completed',at:now-i}))];
 const text=dialogueRuntimeFacts({profile,scope,actions,now});assert(text.includes('执行者未记录'));assert(text.includes('signature'));assert(!text.includes('get_friend_msg_history'));assert(!text.includes('set_online_status'));assert(text.length<1800);
});
test('pre-understanding receives current persona first and current facts before resolving an ambiguous reference',async()=>{
 const identity='【当前人设卡】直率、重视约定，习惯先核对自己做过的事',facts=dialogueRuntimeFacts({profile,scope,now});
 const messages=[{role:'system',_localContextKind:'persona',content:identity},{role:'system',_localContextKind:'runtimeFacts',content:facts},{role:'user',content:'你刚改过资料吗'},{role:'assistant',content:'改过自己的签名'},{role:'user',content:'那句是放哪里的'}];
 let called=0;await understandLocalTurn(messages,{request:'那句是放哪里的',model:async options=>{called++;assert.equal(options.messages[0].content,identity);assert(options.messages.at(-1).content.includes(signature));assert(!options.messages[1].content.includes('不扮演角色'));assert.deepEqual(options.tools,[]);return '{"meaning":"那句签名是放在哪里的","uncertain":false}';}});assert.equal(called,1);
});
