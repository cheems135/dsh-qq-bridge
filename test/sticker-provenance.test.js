import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qqHumanWords} from '../qq-poke.js';
import {stickerAuthorshipReply} from '../chat-bubbles.js';
import {extractIncoming,isStickerReactionPart} from '../bridge-features.js';
import {dialogueHistoryText} from '../qq-history-context.js';

const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const begin=index.indexOf('  function receivedStickerParts(');
const end=index.indexOf('  const STICKER_CONFIRMATION=',begin);
assert(begin>=0&&end>begin);

const sticker={type:'image',data:{sub_type:1,summary:'[动画表情]',file:'83c95914b8a6a4ce276015008fd85aaa.jpg'}};
const picture={type:'image',data:{sub_type:0,summary:'[图片]'}};
const caption=text=>({type:'text',data:{text}});

function prepare({caption='',between='',stickerAge=86_000,account='current',group=false,originalSender='12345'}={}){
  const now=Date.now(),chat={key:group?'group:98765':'private:12345',kind:group?'group':'private',userId:'12345',isOwner:!group};
  const scope={key:chat.key,accountId:account,personaId:'p',personaVersion:'v'};
  const mediaKey=(s,id)=>JSON.stringify([s.accountId,s.personaId,s.personaVersion,s.key,id]);
  const record={...sticker,id:'received:0',at:now-stickerAge,source:{messageId:'received',speakerId:originalSender}};
  const row={chat:chat.key,accountId:account,personaId:'p',dir:'in',image:true,speakerId:originalSender,
    messageId:'received',time:record.at,userText:caption};
  const messages=between?[row,{...row,image:false,messageId:'other',time:now-700,userText:between}]:[row];
  const deps={qqReadScope:()=>scope,qqMediaKey:mediaKey,qqMediaReferences:new Map([[mediaKey(scope,record.id),record]]),
    learningMeta:()=>scope,featureState:{floors:{}},memories:{},messages,recordsAllowed:()=>true,qqHumanWords,isStickerReactionPart,segmentsOf:value=>value||[]};
  const read=Function(...Object.keys(deps),index.slice(begin,end)+'\nreturn stickerSourceForTurn;')(...Object.values(deps));
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
  assert.equal(h.read([sticker,{type:'node',data:{content:[picture]}}]),'mixed');
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
  assert.equal(h.read([sticker,caption('她给我留言，说这是借我的。她说，我亲手画的。')]),'unknown');
  assert.equal(h.read([sticker,caption('同桌的原话是“听好了。我亲手画的。”')]),'unknown');
  assert.equal(h.read([caption('这张怎么样？')]),'sender-drew');
  assert.equal(h.read([caption('这个其实不是我画的')]),'unknown');
  assert.equal(prepare({caption:'我亲手画的',between:'其实这张是别人画的'}).read([caption('对呀')]),'unknown');
  assert.equal(h.read([{type:'reply',data:{id:'received'}},caption('这个梗怎么样？')]),'sender-drew');
});

test('a quoted group sticker retains its original sender when someone else replies',()=>{
  const h=prepare({group:true,originalSender:'88888',caption:'我亲手画的'});
  assert.equal(h.read([{type:'reply',data:{id:'received'}},caption('这张表情怎么了？')]),'quoted');
  assert.equal(h.read([{type:'reply',data:{id:'received'}},caption('这张是我亲手画的。')]),'quoted-sender-drew');
});

test('QQ transfer records and reaction images survive handoff with the original speakers attached',()=>{
  const own='他说要加班，我也刚收工。';
  const body=[caption(own),{type:'node',data:{nickname:'小陈',content:[caption('我还在等。'),sticker]}},
    {type:'node',data:{content:[picture]}}];
  const words=qqHumanWords(body),display=extractIncoming(body).text;
  assert.equal(words,own);
  assert.match(display,/\[转发\] 小陈：我还在等。\n\[表情\]/);
  assert.match(display,/\[转发\] 未标注发言人：\[图片\]/);
  const history=dialogueHistoryText({dir:'in',text:display,userText:words});
  assert.ok(history.startsWith(own+'\n【QQ附带资料】\n[转发] 小陈：'));
  const direct=extractIncoming([caption(own),sticker]).text;
  assert.equal(dialogueHistoryText({dir:'in',text:direct,userText:own}),own+'\n【QQ附带资料】\n[表情]');
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
