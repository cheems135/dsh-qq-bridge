import test from 'node:test';
import assert from 'node:assert/strict';
import {dialogueReceiptHint} from '../api-conversation-context.js';
import {choiceMode} from '../personal-choice.js';
import {mediaPreviewNeeded} from '../background-cost-policy.js';

const at=Date.parse('2026-11-22T17:00:00+08:00');
const scope={key:'private:31',accountId:'a',personaId:'p',at};
const sent=(text,time,extra={})=>({chat:scope.key,accountId:'a',personaId:'p',dir:'out',delivery:'sent',text,time,...extra});
const received=(userText,time,extra={})=>({...sent(userText,time),dir:'in',userText,...extra});
const hint=(rows,words,extra={})=>dialogueReceiptHint(rows,{...scope,words,...extra});

test('she can make the offered decision without treating a vague assent as a media request',()=>{
 const offer=sent('今晚想看木刻还是油画？',at-1000,{messageId:'offer'});
 assert.match(hint([offer],'都行'),/木刻还是油画/);
 assert.match(hint([offer],'你来定吧'),/木刻还是油画/);
 assert.equal(hint([offer],'都行',{at:at+21*60000}),'');
 assert.equal(hint([offer,received('我先回个电话',at-500)],'都行'),'');
 assert.equal(hint([offer],'都行',{replyId:'missing'}),'');
 assert.equal(mediaPreviewNeeded('都行',[{role:'assistant',text:'要听歌还是看画？'}]),false);
 assert.equal(hint([offer],'“你来定吧”用英语怎么说？'),'');
 assert.equal(hint([offer],'不用替我做决定，我自己挑。'),'');
 assert.equal(hint([offer],'都行',{companion:false}),'');
});

test('a personal opinion can survive a change of topic and a day offline, without adopting the other person’s tastes',()=>{
 const yesterday=at-86400000;
 const rows=[received('爵士还是摇滚？',yesterday),sent('我更喜欢爵士，鼓点有意思。',yesterday+1000),
   received('我最喜欢摇滚，尤其是现场。',yesterday+2000),sent('你上回讲过那个乐队。',yesterday+3000)];
 assert.match(hint(rows,'我爱摇滚，你也一样吧？'),/你当时说过.*我更喜欢爵士/);
 assert.doesNotMatch(hint(rows,'我爱摇滚，你也一样吧？'),/最喜欢摇滚/);
 assert.equal(hint(rows,'今天在车站遇见一只猫。'),'');
 assert.doesNotMatch(hint(rows,'你更喜欢木刻还是油画？'),/你当时说过/);
 rows.push(received('最近爵士还是摇滚？',at-60000),sent('我最近改听摇滚了。',at-50000));
 assert.match(hint(rows,'你还喜欢爵士吗？'),/你当时说过.*改听摇滚/);
 assert.doesNotMatch(hint(rows,'你还喜欢爵士吗？'),/鼓点有意思/);
});

test('private choices respect retention floors, memory switches, retractions, identity and speaker boundaries',()=>{
 const text='我更喜欢木刻。',query='你还喜欢木刻吗？';
 const older=sent(text,at-60000);
 for(const extra of [{accountId:'b'},{personaId:'q'},{key:'private:32'},{key:'group:31'},{floor:older.time},{remember:false}])
   assert.doesNotMatch(hint([older],query,extra),/你当时说过/);
 for(const row of [received(text,at-1000),{...older,retracted:true},{...older,delivery:'queued'},
   sent('她说“我更喜欢木刻”。',at-1000),sent('我更喜欢木刻吗？',at-1000)])
   assert.doesNotMatch(hint([row],query),/你当时说过/);
 assert.equal(choiceMode('我室友说你喜欢木刻'),'');
});
