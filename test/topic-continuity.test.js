import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recentOperationContext} from '../operation-context.js';
import {proactiveShareReply} from '../social-sharing.js';

const base={chat:'private:1',accountId:'a',personaId:'p'};
const row=(time,dir,text,extra={})=>({...base,time,dir,text,...extra});
const technical='这一段已经完成，96 BPM，采样率44100 Hz，接缝误差0.0025，文件已生成。';

test('a text follow-up after an image cannot evict that image from the topic window',()=>{
 const rows=[row(1,'in','[图片]',{image:true,messageId:'img'}),row(2,'in','这个配色你觉得怎么样'),...Array.from({length:9},(_,i)=>row(i+3,'out','回复'+i))];
 const context=recentOperationContext(rows,{key:'private:1',accountId:'a',personaId:'p',now:100});
 assert.equal(context.length,8);
 assert.equal(context[0].id,'img');
 assert.equal(context[0].hasImage,true);
 assert.equal(context[0].imageAnchor,true);
 assert.equal(context[1].text,'这个配色你觉得怎么样');
 assert(context.some(item=>item.text==='回复8'));
});

test('the image anchor still leaves room for the latest real user turn',()=>{
 const rows=[row(1,'in','[图片]',{image:true}),row(2,'in','第一句'),row(3,'in','第二句'),...Array.from({length:8},(_,i)=>row(i+4,'out','回复'+i))];
 const context=recentOperationContext(rows,{key:'private:1',accountId:'a',personaId:'p',now:100});
 assert.equal(context.length,8);
 assert.equal(context[0].hasImage,true);
 assert(context.some(item=>item.role==='user'&&item.text==='第二句'));
});

test('an old picture outside the anchor window does not come back as the topic',()=>{
 const rows=[row(1,'in','[图片]',{image:true}),row(2,'in','换个话题吧'),...Array.from({length:9},(_,i)=>row(i+3,'out','回复'+i))];
 const context=recentOperationContext(rows,{key:'private:1',accountId:'a',personaId:'p',now:46*60*1000});
 assert.equal(context.length,8);
 assert(context.every(item=>item.hasImage!==true));
});

test('only one picture is anchored, and only while it is still a live topic',()=>{
 const rows=[row(1,'in','[图片]',{image:true}),row(2,'in','[图片]',{image:true}),row(3,'in','这两张放一起看'),...Array.from({length:9},(_,i)=>row(i+4,'out','回复'+i))];
 const context=recentOperationContext(rows,{key:'private:1',accountId:'a',personaId:'p',now:100});
 assert.equal(context.filter(item=>item.imageAnchor).length,1);
 assert.equal(context[0].imageAnchor,true);
});

test('cleared, failed, retracted or foreign pictures never become an anchor',()=>{
 const baseRows=[row(1,'in','[图片]',{image:true,retracted:true}),row(2,'in','[图片]',{image:true,delivery:'failed'}),row(3,'in','[图片]',{image:true,accountId:'other'}),row(4,'in','[图片]',{image:true,chat:'private:2'}),...Array.from({length:9},(_,i)=>row(i+5,'out','回复'+i))];
 const context=recentOperationContext(baseRows,{key:'private:1',accountId:'a',personaId:'p',now:100});
 assert(context.every(item=>item.hasImage!==true));
});

test('a cleared topic floor also clears the picture anchor',()=>{
 const rows=[row(10,'in','[图片]',{image:true}),...Array.from({length:9},(_,i)=>row(i+11,'out','回复'+i))];
 const context=recentOperationContext(rows,{key:'private:1',accountId:'a',personaId:'p',floor:20,now:100});
 assert(context.every(item=>item.hasImage!==true));
});

test('proactive technical report is rewritten while its media command survives byte for byte',async()=>{
 let seen,input;
 const value=await proactiveShareReply(technical+'\n[语音:刚做的这段]',{recent:[{role:'user',text:'[图片]那张画我想再看看',hasImage:true,at:Date.now()}],persona:'克制，称对方先生。',scene:{activity:'做音乐'},ask:async(system,body)=>{seen=system;input=JSON.parse(body);return '先生，刚才那张画先放一放，这段我想让你听听。';}});
 assert.equal(value,'先生，刚才那张画先放一放，这段我想让你听听。\n[语音:刚做的这段]');
 assert.match(seen,/作品分享配话/);
 assert.equal(input.recent.at(-1).hasImage,true);
});

test('ordinary proactive chat stays untouched and costs no model call',async()=>{
 let calls=0;
 assert.equal(await proactiveShareReply('外面下雨了，你那边呢？',{ask:async()=>{calls++;return '不应调用';}}),'外面下雨了，你那边呢？');
 assert.equal(calls,0);
});

test('a failed rewrite keeps the original proactive text instead of dropping the turn',async()=>{
 assert.equal(await proactiveShareReply(technical,{ask:async()=>{throw Error('service unavailable');}}),technical);
});

test('an anchored picture keeps its anchor in the sharing prompt after a text follow-up',async()=>{
 let system;
 await proactiveShareReply(technical,{recent:[{role:'user',text:'这张图的配色',hasImage:true,imageAnchor:true,at:Date.now()},{role:'user',text:'你觉得呢',at:Date.now()},{role:'assistant',text:'还行'}],ask:async(s)=>{system=s;return '刚才那张图先放着，这段你听听。';}});
 assert.match(system,/当前对话锚点/);
});

test('owner relay and marker commands are never rewritten',async()=>{
 let calls=0;const raw=technical+'\n[定时:5|12345|作业记录]';
 assert.equal(await proactiveShareReply(raw,{ask:async()=>{calls++;return '不应调用';}}),raw);
 assert.equal(calls,0);
});

test('index.js applies the expression gate before sending a proactive turn',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const branch=source.slice(source.indexOf("if (turn?.meta?.kind === 'proactive')"),source.indexOf("if (reason.kind === 'error')"));
 assert(branch.includes('proactiveShareReply('));
 assert(branch.indexOf('proactiveShareReply(')<branch.indexOf('}, spoken);'));
});
