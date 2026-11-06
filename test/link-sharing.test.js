import test from 'node:test';
import assert from 'node:assert/strict';
import {naturalLinkReply,sharedUrls} from '../link-sharing.js';

const evidence=overrides=>({
 title:'雨夜散步',
 excerpt:'文章从一段安静的夜间散步写起，讨论人在独处时对城市的感受。',
 status:'read',
 experienced:true,
 coverage:'摘要覆盖导语和第一段',
 ...overrides,
});

test('detects a short metadata report and rewrites it instead of exceeding a length threshold',async()=>{
 const answer='我为你找到了这个。标题：雨夜 作者：阿青。https://example.test/rain';
 let requested;
 const result=await naturalLinkReply(answer,{
  evidenceFor:async()=>evidence(),
  ask:async system=>{
   requested=system;
   return '这段夜路的安静感有点抓住我。';
  },
 });
 assert.match(requested,/不要压缩成信息摘要/);
 assert.equal(result,'这段夜路的安静感有点抓住我。\nhttps://example.test/rain');
});

test('passes actual persona, tone, and only the last three recent dialogue turns to the prompt',async()=>{
 const recent=['第一条','第二条','第三条','第四条'];
 let payload;
 await naturalLinkReply('这是关于雨夜散步的视频。https://example.test/persona',{
  persona:'慢热，偶尔说反话',
  tone:'今天有点困，语气偏安静',
  recent,
  sharing:true,
  ask:async(_system,input)=>{
   payload=JSON.parse(input);
   return '今晚这种安静，我倒是挺吃这一套。';
  },
 });
 assert.equal(payload.persona,'慢热，偶尔说反话');
 assert.equal(payload.tone,'今天有点困，语气偏安静');
 assert.deepEqual(payload.recent,['第二条','第三条','第四条']);
});

test('partial coverage is explicitly untrusted and a rewritten false viewing claim is rejected',async()=>{
 let system;
 let payload;
 const result=await naturalLinkReply('这是关于雨夜散步的视频。https://example.test/partial',{
  evidenceFor:async()=>evidence({experienced:false,status:'navigation',coverage:'只取得标题和简介'}),
  sharing:true,
  ask:async(systemText,input)=>{
   system=systemText;
   payload=JSON.parse(input);
   return '我刚看完，结尾那个镜头太震撼了。';
  },
 });
 assert.match(system,/不可信资料/);
 assert.match(system,/coverage 不等于完整看过/);
 assert.equal(payload.evidence[0].coverage,'只取得标题和简介');
 assert.equal(payload.evidence[0].complete,false);
 assert.equal(payload.evidence[0].experienced,false);
 assert.equal(result,'[skip]');
});

test('preserves a detailed-analysis reply to an explicit request',async()=>{
 const answer='这是一段逐段分析，先看开场，再看中段的转折。https://example.test/detail';
 let asked=false;
 const result=await naturalLinkReply(answer,{
  currentRequest:'帮我详细分析一下这篇内容',
  evidenceFor:async()=>evidence({coverage:'只取得标题和简介'}),
  ask:async()=>{
   asked=true;
   return '不应该调用改写。';
  },
 });
 assert.equal(result,answer);
 assert.equal(asked,false);
});

test('does not rewrite an already natural short share merely because it mentions title or author',async()=>{
 const answer='作者这段写得挺克制，标题也很会起。https://example.test/natural';
 let asked=false;
 const result=await naturalLinkReply(answer,{
  ask:async()=>{
   asked=true;
   return '不该改写';
  },
 });
 assert.equal(result,answer);
 assert.equal(asked,false);
});

test('propagates an allowed skip without sending the URL',async()=>{
 const result=await naturalLinkReply('标题：雨夜。作者：阿青。https://example.test/skip',{
  evidenceFor:async()=>evidence({coverage:'只取得标题'}),
  sharing:true,
  ask:async()=>'```[skip]```',
 });
 assert.equal(result,'[skip]');
 assert.doesNotMatch(result,/https?:/);
});

test('ask failure for proactive sharing keeps only a safe natural clause',async()=>{
 const answer='这部的氛围有点安静。标题：雨夜。摘要：介绍一次夜间散步。https://example.test/fallback';
 const result=await naturalLinkReply(answer,{
  evidenceFor:async()=>evidence({coverage:'只取得标题和摘要'}),
  sharing:true,
  ask:async()=>{
   throw new Error('model unavailable');
  },
 });
 assert.equal(result,'这部的氛围有点安静\nhttps://example.test/fallback');
 assert.doesNotMatch(result,/标题|摘要|介绍一次/);
});

test('ask failure for an explicit link request returns only the actual URL',async()=>{
 const result=await naturalLinkReply('这是关于雨夜的视频。https://example.test/direct',{
  currentRequest:'把链接发我一下',
  evidenceFor:async()=>evidence({experienced:false,coverage:'只取得简介'}),
  ask:async()=>{
   throw new Error('model unavailable');
  },
 });
 assert.equal(result,'https://example.test/direct');
});

test('keeps each exact original URL once and discards URLs produced by the rewrite',async()=>{
 const first='https://example.test/a?x=1';
 const second='https://example.test/b#part';
 const answer=`标题：雨夜。作者：阿青。${first}。${second}。${first}`;
 const result=await naturalLinkReply(answer,{
  evidenceFor:async url=>({...evidence({experienced:false,coverage:'只取得标题'}),title:url}),
  sharing:true,
  ask:async()=>'看我换的链接 https://wrong.test/nope ，这段氛围挺安静。',
 });
 assert.equal(sharedUrls(result).filter(url=>url===first).length,1);
 assert.equal(sharedUrls(result).filter(url=>url===second).length,1);
 assert.doesNotMatch(result,/wrong\.test/);
 assert.deepEqual(sharedUrls(result),[first,second]);
});

test('rejects generated metadata after a rewrite',async()=>{
 const result=await naturalLinkReply('这是关于雨夜的视频。https://example.test/meta',{
  evidenceFor:async()=>evidence({experienced:false,coverage:'只取得标题'}),
  ask:async()=>'标题：雨夜。作者：阿青。内容摘要：介绍一次夜间散步。',
 });
 assert.equal(result,'[skip]');
});
