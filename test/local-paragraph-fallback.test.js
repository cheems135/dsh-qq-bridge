import test from 'node:test';import assert from 'node:assert/strict';
import {formatLocalChatParagraphs} from '../local-reply.js';import {naturalBubbleParts} from '../chat-bubbles.js';
import {createLocalModelServer} from '../local-model-server.mjs';import {listenLocalServer} from './local-server-listen.js';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {join} from 'node:path';
const raw='今天先去楼下走一小圈就好，别一开始把目标定得太满。走到路口看看树，回来喝点水，慢慢找到舒服的节奏。偶尔漏一天也没关系，第二天照常出门就好。你更喜欢早上出去，还是傍晚凉快的时候？';
test('continuous plain chat becomes multiple QQ bubbles without losing or repeating any content',()=>{
 const text=formatLocalChatParagraphs(raw),parts=naturalBubbleParts(text,{maxBubbles:0,automaticBreaks:false});assert.ok(parts.length>=2);assert.ok(parts.length<=4);assert.equal(parts.join('').replace(/\s/g,''),raw.replace(/\s/g,''));assert.ok(parts.every(p=>p.length>=12));
});
test('conversational tilde boundaries do not detach greetings or every short sentence',()=>{
 const text='嘿嘿，今天终于把那幅小画画到一半啦！窗边的光刚好落在桌子上，颜色看起来特别温暖～ 等画好以后就挂在书架旁边，每天路过都能看见嘛～ 你想先看看现在的进度吗？';
 const parts=formatLocalChatParagraphs(text).split('\n');assert.ok(parts.length>1);assert.ok(parts.every(p=>p.length>=12));assert.equal(parts.join('').replace(/\s/g,''),text.replace(/\s/g,''));assert.equal(formatLocalChatParagraphs('好呀～那明天一起去。'),'好呀～那明天一起去。');const greeting='朋友～今天那幅窗边的小画已经画到一半，准备画好以后挂在书架旁边，每天路过都能看到嘛～ 你要不要先看看现在的进度呀？';assert.ok(formatLocalChatParagraphs(greeting).includes('\n'));
});
test('explicit breaks, single-paragraph requests, URLs, code, JSON and requested stories keep their formatting',()=>{
 for(const [text,request]of [[raw+'\n第二段。',''],[raw,'请用一段话，不要分段'],['https://example.com '+raw,''],['```js\n'+raw+'\n```',''],[JSON.stringify({text:raw}),''],[raw,'写一篇故事']])assert.equal(formatLocalChatParagraphs(text,{request}),text);
});
test('actual gateway formats a noncompliant model answer once and the QQ splitter sees the new boundaries',async()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('../.paragraph-fallback-',import.meta.url))),configFile=join(dir,'config.json');writeFileSync(configFile,JSON.stringify({voiceEnabled:false,fastDialogue:false}));let models=0;
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'test.log')},logger:()=>{},model:async()=>{models++;return raw;},runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true})}});
 try{const base=await listenLocalServer(service),res=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'我想开始散步，漏了一天怎么办？'}]})}),out=await res.json();assert.equal(res.status,200,JSON.stringify(out));assert.equal(models,1);const parts=naturalBubbleParts(out.text,{maxBubbles:0,automaticBreaks:false});assert.ok(parts.length>1);assert.equal(parts.join('').replace(/\s/g,''),raw.replace(/\s/g,''));assert.equal(out.qqDelivered,false);
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('long conversational clauses can break at a transition even without full stops',()=>{
 const text='嗯～今天先把桌面上常用的书本分出来，按照最近要看的顺序放好，剩下的再放到下面的抽屉里面，然后把杯子挪到另一边，留出写字的位置，这样找东西就不用每次都翻半天啦！';
 const result=formatLocalChatParagraphs(text);assert.ok(result.includes('\n'));assert.equal(result.replace(/\s/g,''),text.replace(/\s/g,''));
});

test('persona wave punctuation separates full ideas without requiring a following space',()=>{
 const text='纸质书可以直接拿起来翻看，而且不用充电，放在书桌旁边随时都能读～电子书可以存放很多本书，出门只带一个阅读器，放进包里也不占地方～不过如果想认真做批注，也可以看看自己更习惯哪种方式～';
 const result=formatLocalChatParagraphs(text);assert.ok(result.includes('\n'));assert.equal(result.replace(/\s/g,''),text.replace(/\s/g,''));assert.ok(result.split('\n').every(p=>p.length>=12));
});
