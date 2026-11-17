import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {selectIncomingBatch} from '../incoming-batch.js';import {contextTopicsFor} from '../context-demand.js';
const text=t=>({type:'text',data:{text:t}}),image={type:'image',data:{url:'https://example.org/sticker.png'}};
const row=(id,message,extra={})=>({key:'private:1',at:1000+id,payload:{user_id:'1',message_id:id,message,...extra}});
const args={segmentsOf:v=>v,textOf:p=>p.message.filter(s=>s.type==='text').map(s=>s.data.text).join('')};
test('rapid text, sticker image, follow-up retain order and all original IDs in one batch',()=>{
 const input=[row(1,[text('陪我看点恐怖的吧')]),row(2,[image]),row(3,[text('不要血腥的')])];const batch=selectIncomingBatch(input,1010,args);
 assert.deepEqual(batch.map(j=>j.payload.message_id),[1,2,3]);assert.deepEqual(batch.flatMap(j=>j.payload.message),[text('陪我看点恐怖的吧'),image,text('不要血腥的')]);
});
test('commands, another sender, sleep review, future arrivals and size limit keep independent boundaries',()=>{
 for(const next of [row(2,[text('/cancel')]),row(2,[text('别人')],{user_id:'2'}),row(2,[text('醒后')],{_sleepReview:true}),{...row(2,[text('以后')]),at:2000}])assert.equal(selectIncomingBatch([row(1,[text('先说')]),next],1010,args).length,1);
 assert.equal(selectIncomingBatch([row(1,[text('先说')]),row(2,[image])],1010,{...args,maxBytes:120}).length,1);
});
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
test('actual chat admission follow-up preserves running and queued turns, without cancelling the earlier request',()=>{
 const start=source.indexOf('    const activeChat=chats.get(state.chats[key]?.sessionId);'),end=source.indexOf('    const carriesImage',start),block=source.slice(start,end);
 const queued={kind:'user',text:'先前的请求'},running={meta:{kind:'user',auditId:'first'}};const chat={inboundVersion:1,pendingTurns:[queued],turns:new Map([['turn',running]])};let cancels=0;
 vm.runInNewContext(block,{key:'private:1',chats:new Map([['session',chat]]),state:{chats:{'private:1':{sessionId:'session'}}},clearSilenceTimer(){},clearAfterTimer(){},ctx:{sessionController:{cancel(){cancels++}}},featureState:{audits:[{id:'first',status:'running'}]},log(){}});
 assert.equal(cancels,0);assert.equal(chat.inboundVersion,2);assert.equal(chat.pendingTurns[0],queued);assert.equal(chat.turns.get('turn'),running);
});
test('real sticker segment parser supports Chinese colon and long saved names without exposing control text',()=>{
 const start=source.indexOf('  function burstSegments('),end=source.indexOf('\n  /**',start),fn=source.slice(start,end);
 const name='收藏_这是一个超过十六个字的长表情文件名称';const run=vm.runInNewContext(fn+'\nburstSegments',{FACE_IDS:{},settings:{stickerDisabled:[]},randomSticker:()=>'/sticker/random.png',resolveSticker:n=>n===name?'/sticker/long.png':null,stickersInGroup:g=>g==='开心'?[name]:[],log(){}});
 const out=JSON.parse(JSON.stringify(run('收到啦[表情包：'+name+']',{})));assert.deepEqual(out,[{type:'text',data:{text:'收到啦'}},{type:'image',data:{file:'/sticker/long.png'}}]);
 assert.equal(run('[表情包:开心]',{})[0].type,'image');assert(contextTopicsFor('给我发个表情包').includes('qq'));assert(contextTopicsFor('来斗图').includes('qq'));
});
