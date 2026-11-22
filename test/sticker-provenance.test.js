import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qqHumanWords} from '../qq-poke.js';
import {stickerAuthorshipReply} from '../chat-bubbles.js';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const begin=index.indexOf('  function receivedStickerParts(');
const end=index.indexOf('  const STICKER_CONFIRMATION=',begin);
const classifierStart=index.indexOf('  function isStickerReactionPart(');
const classifierEnd=index.indexOf('  const STICKER_CONVERSATION_HINT=',classifierStart);
assert(begin>=0&&end>begin&&classifierStart>=0&&classifierEnd>classifierStart);

const sticker={type:'image',data:{sub_type:1,summary:'[动画表情]',file:'83c95914b8a6a4ce276015008fd85aaa.jpg'}};
const picture={type:'image',data:{sub_type:0,summary:'[图片]'}};
const caption=text=>({type:'text',data:{text}});

function prepare({caption='',between='',stickerAge=86_000,account='current'}={}){
  const now=Date.now(),chat={key:'private:12345',kind:'private',userId:'12345',isOwner:true};
  const scope={key:chat.key,accountId:account,personaId:'p',personaVersion:'v'};
  const mediaKey=(s,id)=>JSON.stringify([s.accountId,s.personaId,s.personaVersion,s.key,id]);
  const record={...sticker,id:'received:0',at:now-stickerAge,source:{messageId:'received',speakerId:chat.userId}};
  const row={chat:chat.key,accountId:account,personaId:'p',dir:'in',image:true,speakerId:chat.userId,
    messageId:'received',time:record.at,userText:caption};
  const messages=between?[row,{...row,image:false,messageId:'other',time:now-700,userText:between}]:[row];
  const deps={qqReadScope:()=>scope,qqMediaKey:mediaKey,qqMediaReferences:new Map([[mediaKey(scope,record.id),record]]),
    learningMeta:()=>scope,featureState:{floors:{}},memories:{},messages,recordsAllowed:()=>true,qqHumanWords,segmentsOf:value=>value||[]};
  const code=index.slice(begin,end)+index.slice(classifierStart,classifierEnd);
  const read=Function(...Object.keys(deps),code+'\nreturn stickerSourceForTurn;')(...Object.values(deps));
  return {messages,chat,read:(message,context={})=>read({...chat,...context},{
    message,user_id:chat.userId,message_id:'current',_bridgeReceivedAt:now,
  })};
}

test('QQ sticker evidence is carried to a direct followup with only text',()=>{
  const h=prepare();
  assert.equal(h.read([sticker]),'unknown');
  assert.equal(h.read([caption('这个是给你接梗的哈哈')]),'unknown');
  assert.equal(h.read([caption('这个月要交多少电费？')]),'');
  assert.equal(h.read([picture,caption('这是我画的画')]),'');
  assert.equal(h.read([sticker,picture]),'mixed');
  assert.equal(h.read([{type:'mface',data:{}}]),'unknown');
  assert.equal(prepare({between:'这张也太夸张了'}).read([caption('对呀')]),'unknown');
  assert.equal(prepare({between:'对了我刚打开电脑'}).read([caption('这个是谁画的？')]),'');
  assert.equal(prepare({stickerAge:310_000}).read([caption('这个也是一个梗')]),'');
  const foreign=prepare();
  foreign.messages[0].accountId='other-account';
  assert.equal(foreign.read([caption('这张真有意思')]),'');
});

test('an explicit artist statement travels with the picture and can be corrected',()=>{
  const h=prepare({caption:'这张是我自己画的'});
  assert.equal(h.read([sticker,caption('其实这张我亲手画的，怎么样？')]),'sender-drew');
  assert.equal(h.read([sticker,caption('这是我画的？')]),'unknown');
  assert.equal(h.read([sticker,caption('我做了这张表情包')]),'unknown');
  assert.equal(h.read([caption('这张怎么样？')]),'sender-drew');
  assert.equal(h.read([caption('这个其实不是我画的')]),'unknown');
  assert.equal(prepare({caption:'我亲手画的',between:'其实这张是别人画的'}).read([caption('对呀')]),'unknown');
  assert.equal(h.read([{type:'reply',data:{id:'received'}},caption('这个梗怎么样？')]),'sender-drew');
});

test('filter the invented artist claim without losing the rest of a sticker reply',()=>{
  const reply='原来是这个梗。\n爸爸你画姿势都这么不正经的\n我刚才只顾着看那张脸了。';
  assert.equal(stickerAuthorshipReply(reply,'这个是接梗的哈哈'),'原来是这个梗。\n我刚才只顾着看那张脸了。');
  assert.equal(stickerAuthorshipReply('又是这一张，爸爸你手绘库存就这么点？\n这张就是你的杀手锏'),'这张就是你的杀手锏');
  for(const text of ['手绘风的表情包还挺生动。','这张是你画的吗？','我刚才误以为是你画的。','图上写着「你画的真好」。']){
    assert.equal(stickerAuthorshipReply(text),text);
  }
  assert.equal(stickerAuthorshipReply('这是你自己画的。','谁画的？'),'这张是你发来的表情包，作者我认不出来。');
  assert.equal(stickerAuthorshipReply('“这是你自己画的。”','逐字读一下图上的字'),'“这是你自己画的。”');
});
