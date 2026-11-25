import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createGuildAccess} from '../qq-guild.js';
import {createQqNativeCapabilities} from '../qq-native-capabilities.js';
import {safeBackup,validateBackup,restoreBackupMessages} from '../bridge-features.js';
import {bindContactDirectory,clearContactDirectory,allowedPrivateUsers,reachableContacts,privateInitiativeAllowed} from '../contact-policy.js';

const guild='18446744073709551614',channel='9007199254740999';
const chat={accountId:'a',receiverId:'55555',personaId:'p',kind:'private',key:'private:12345',meta:{auditId:'t'},owner:true};
function setup(t,options={}){
 const folder=mkdtempSync(join(tmpdir(),'qq-guild-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const calls=[];
 const raw=async(a,p,c)=>{
   calls.push([a,p]);if(options.request){const v=await options.request(a,p,c);if(v!==undefined)return v;}
   return {get_guild_list:[{guild_id:guild,guild_name:'合成测试频道'}],get_guild_channel_list:[{channel_id:channel,owner_guild_id:guild,channel_name:'修理间'}],get_topic_channel_feeds:[{id:'f1',guild_id:guild,channel_id:channel,create_time:110,poster_info:{nickname:'阿洛'},contents:[{type:'text',data:{text:'新轮子'}}]}],send_guild_channel_msg:{message_id:'m-42'},get_guild_msg:{guild_id:guild,channel_id:channel,message_id:'m-42',message_source:'channel',message:'收到',time:113}}[a];
 };
 const make=()=>createQqNativeCapabilities({isOwner:c=>c.owner===true,guildAccess:createGuildAccess({request:raw,receiptDir:folder})});
 const params={guild_id:guild,channel_id:channel};
 return {make,calls,params,run:(api,a,p,c=chat)=>api.call({action:a,params:p},c)};
}
test('guild discovery, scoped topic, single write and independent readback survive reload',async t=>{
 const f=setup(t),api=f.make();
 assert.equal(api.catalog(chat).find(r=>r.action==='get_guild_list').status,'unknown');assert.equal(f.calls.length,0);
 const topic=await f.run(api,'get_topic_channel_feeds',f.params);
 assert.deepEqual(topic.result[0],{id:'f1',...f.params,title:'',text:'新轮子',author:'阿洛',time:110});
 const submits=await Promise.all([1,2].map(()=>f.run(api,'send_guild_channel_msg',{...f.params,message:'收到'})));
 assert(submits.some(r=>r.status==='accepted'&&r.verified===false));
 const saved=await f.run(f.make(),'send_guild_channel_msg',{...f.params,message:'收到'});
 assert.equal(saved.result.message_id,'m-42');assert.equal(f.calls.filter(([a])=>a==='send_guild_channel_msg').length,1);
 const read=await f.run(api,'get_guild_msg',{...f.params,message_id:'m-42'});assert.equal(read.result.text,'收到');assert.equal(read.verified,true);
 const first=f.calls.find(([a])=>a==='send_guild_channel_msg')[1];assert.equal(first.channel_id,channel);assert.deepEqual(first.message,[{type:'text',data:{text:'收到'}}]);
});
test('guild writes with a lost receipt remain unknown after restart, and unrelated channel results stay private',async t=>{
 const f=setup(t,{request:a=>{if(a==='send_guild_channel_msg')throw Object.assign(Error('timeout'),{submitted:true,deliveryUnknown:true});if(a==='get_guild_msg')return {message_id:'m-42',guild_id:guild,channel_id:'2',message:'private contents'};}});
 for(let i=0;i<2;i++)assert.equal((await f.run(f.make(),'send_guild_channel_msg',{...f.params,message:'收到'})).status,'unknown');
 assert.equal(f.calls.filter(([a])=>a==='send_guild_channel_msg').length,1);
 assert.equal((await f.run(f.make(),'get_guild_msg',{...f.params,message_id:'m-42'})).result,null);
});
test('guild distinguishes missing permissions, empty lists, unsupported adapter and invalid IDs',async t=>{
 const f=setup(t,{request:a=>{if(a==='get_guild_list')return null;if(a==='get_guild_service_profile')throw Object.assign(Error(),{retcode:1404});}}),api=f.make();
 assert.equal((await f.run(api,'get_guild_list',{}, {...chat,owner:false})).ok,false);
 assert.equal((await f.run(api,'get_guild_list',{}, {...chat,kind:'group'})).ok,false);
 assert.equal((await f.run(api,'get_guild_channel_list',{guild_id:Number(guild)})).status,'invalid');assert.equal(f.calls.length,0);
 assert.equal((await f.run(api,'get_guild_list',{})).status,'empty');assert.equal((await f.run(api,'get_guild_service_profile',{})).status,'unsupported');
 assert.equal((await f.run(api,'get_guild_channel_list',{guild_id:guild})).status,'denied');
});
test('contact scope follows the verified QQ connection and never grants an owner identity',()=>{
 const s={activeAccountId:'a',owners:['11111'],whitelist:['11111'],disabledUsers:['33333']};
 bindContactDirectory(s,'a','44444',[{user_id:22222},{user_id:33333}],[{group_id:55555}]);
 assert.deepEqual(allowedPrivateUsers(s),['11111']);s.contactWhitelistEnabled=false;
 assert.deepEqual(allowedPrivateUsers(s),['11111','22222']);assert.deepEqual(reachableContacts(s,'groups'),['55555']);assert.equal(privateInitiativeAllowed('private:22222',s),false);
 s.activeAccountId='b';assert.deepEqual(allowedPrivateUsers(s),['11111']);s.activeAccountId='a';clearContactDirectory(s);assert.deepEqual(allowedPrivateUsers(s),['11111']);
});
test('portable backup roundtrip preserves QQ IDs and multiplicity in legacy imports without crossing accounts',()=>{
 const legacy={time:100,chat:'group:33333',dir:'in',text:'好'}, enriched={...legacy,accountId:'a',messageId:'m1',personaId:'p',sourceMessageIds:['m1','m2'],speakerId:'11111',userText:'好',retracted:true};
 const exported=validateBackup(safeBackup({}, {},{includeMessages:true,messages:[enriched]})).messages;
 assert.deepEqual(exported,[enriched]);
 const other={...enriched,accountId:'b',text:'其他账号'};
 const merged=restoreBackupMessages([enriched,other],[legacy,legacy],'a');
 assert.equal(merged.length,3);assert.equal(merged[1].accountId,'b');
 assert.equal(restoreBackupMessages(merged,[legacy,legacy],'a').length,3);
 assert.equal(restoreBackupMessages(merged,[...exported,other],'a').length,3);
 const ids=restoreBackupMessages([],['1','2'].map(messageId=>({...legacy,messageId})),'a');assert.equal(ids.length,2);
});
