import test from 'node:test';
import assert from 'node:assert/strict';
import {createImageStudio} from '../image-studio.js';
import {fitLocalImageBrief} from '../local-image-template.js';

const scene='她穿着蓝色外套坐在客厅木桌旁，桌面放着一本翻开的书和一杯温水，手指轻轻搭在书页边缘。房间里的书架、窗帘与台灯构成完整背景，近处镜头呈现自然神态和衣服的布料纹理，画面保持连贯的空间关系。';
async function prepare(at,request,timeZone='Asia/Shanghai'){
 const seen=[];
 const studio=createImageStudio({now:()=>Date.parse(at),getConfig:()=>({promptLanguage:'zh',timeZone}),visualPlan:()=>({humanRequest:request,prompt:request,styleTags:['anime'],lifeContext:{date:'2000-01-01',phase:'morning',activity:'看书',outfit:'居家服',location:'客厅'}}),ask:async(system,user)=>{
  seen.push({system,user:JSON.parse(user)});
  return system.startsWith('【图像细节核对】')?JSON.stringify({ok:true,missing:[]}):JSON.stringify({prompt:scene,style:'二维二次元插画。'});
 }});
 await studio.prepare(request);return seen;
}
test('outfit/location requests receive an independent current clock in drafting and review',async()=>{
 const seen=await prepare('2026-11-07T15:30:00Z','换上蓝色外套，在窗边看书');
 const time=seen[0].user.timeContext;
 assert.deepEqual(time,{source:'current-clock',timestamp:'2026-11-07T15:30:00.000Z',timeZone:'Asia/Shanghai',date:'2026-11-07',time:'23:30'});
 assert.equal(seen[0].user.lifeContext.date,'2000-01-01');
 assert.deepEqual(seen[1].user.requirements.timeContext,time);
 assert.match(seen[0].system,/Changing outfit, location or action does not change time of day/);
 assert.match(seen[1].system,/时间单独核对/);
});
test('an explicitly requested earlier scene does not rewrite the actual clock or schedule',async()=>{
 const request='画一张昨天下午在公园散步的照片';
 const [draft]=await prepare('2026-11-07T17:15:00Z',request);
 assert.equal(draft.user.currentHumanRequest,request);
 assert.equal(draft.user.timeContext.date,'2026-11-08');assert.equal(draft.user.timeContext.time,'01:15');
 assert.match(draft.system,/never the real clock, calendar, schedule or current state/);
});
test('time zone conversion and local context compaction preserve the real clock',async()=>{
 const [draft]=await prepare('2026-11-07T15:30:00Z','拍窗边的书桌','UTC');
 assert.equal(draft.user.timeContext.time,'15:30');
 const brief={...draft.user,recentConversation:[{role:'user',text:'旧对话'.repeat(2000)}]};
 const fitted=fitLocalImageBrief(draft.system,JSON.stringify(brief),{window:1500,maxTokens:512});
 assert.deepEqual(JSON.parse(fitted.user).timeContext,draft.user.timeContext);
});
