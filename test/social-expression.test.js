import test from 'node:test';import assert from 'node:assert/strict';import {publicExpression} from '../social-expression.js';
test('short summary is rewritten using public facts and persona, without private context',async()=>{
 let request;const result=await publicExpression('该视频介绍了钢琴弹奏。',{persona:'安静有主见',tone:'平静',recentPosts:['已经公开的话'],ask:async(s,i)=>{request=JSON.parse(i);return '我偏偏喜欢这种慢下来的节奏';}});
 assert.equal(result,'我偏偏喜欢这种慢下来的节奏');assert.equal(request.persona,'安静有主见');assert.deepEqual(request.recentPublicPosts,['已经公开的话']);assert.equal(request.observedComment,null);assert(!('recentMessages' in request));
});
test('already natural opinion and ordinary comment reply do not consume another model call',async()=>{
 const ask=()=>{throw Error('must not call');};assert.equal(await publicExpression('我有点舍不得关掉这段旋律',{ask}),'我有点舍不得关掉这段旋律');assert.equal(await publicExpression('这个节奏挺舒服',{ask}),'这个节奏挺舒服');assert.equal(await publicExpression('对，就是最后那个转音',{kind:'reply',ask}),'对，就是最后那个转音');
});
test('rewritten link set is restricted to exact original links, once each',async()=>{
 assert.equal(await publicExpression('标题：曲子\nhttps://example.com/a\nhttps://example.com/a',{ask:async()=> '我喜欢这个停顿 https://example.com/a https://example.com/a'}),'我喜欢这个停顿\nhttps://example.com/a');
});
test('failed or still robotic rewrite is skipped instead of reporting a task',async()=>{
 for(const ask of [async()=>{throw Error('offline');},async()=> '该作品主要讲述成长',async()=> '我看完整个视频了，非常喜欢',async()=> ''])assert.equal(await publicExpression('摘要：作品讲述成长',{ask}),'[skip]');
});
test('comment rewrite receives the observed comment and post only and skips duplicate public text',async()=>{
 let input;assert.equal(await publicExpression('以下是回复：谢谢评价',{kind:'reply',comment:{text:'这段慢得好舒服',postText:'我偏爱这个节奏'},ask:async(s,i)=>{input=JSON.parse(i);return '对，我也是舍不得快进这里';}}),'对，我也是舍不得快进这里');assert.equal(input.observedComment.text,'这段慢得好舒服');
 assert.equal(await publicExpression('该作品展示节奏',{recentPosts:['我喜欢这里的节奏'],ask:async()=> '我喜欢这里的节奏'}),'[skip]');
});
test('comment rewrites preserve exact observed text and accept comment.post without metadata',async()=>{
 let input;const result=await publicExpression('以下是回复：谢谢评价',{kind:'reply',comment:{text:' 原文评论 ',post:{text:'原文动态',private:'不应出现'},name:'不应出现',uin:'12345678'},ask:async(s,i)=>{input=JSON.parse(i);return '这个停顿确实值得多听一会儿';}});
 assert.equal(result,'这个停顿确实值得多听一会儿');assert.equal(input.observedComment.text,' 原文评论 ');assert.equal(input.observedComment.postText,'原文动态');
 assert.equal(JSON.stringify(input).includes('不应出现'),false);assert.equal(JSON.stringify(input).includes('12345678'),false);
});
test('rewrites cannot invent private history, relationships, feelings, or facts',async()=>{
 for(const output of ['我朋友也说这个节奏好听','我昨天也去了现场，真的很喜欢','我兴奋不已，太爱这个作品了']){
  assert.equal(await publicExpression('该作品展示了安静节奏',{ask:async()=>output}),'[skip]');
 }
});
test('an invented URL rejects the rewrite and duplicate public posts are not repeated',async()=>{
 assert.equal(await publicExpression('标题：曲子\nhttps://example.com/a',{ask:async()=> '这段停顿很好 https://evil.test/x'}),'[skip]');
 assert.equal(await publicExpression('标题：曲子',{ask:async()=> '这段停顿很好 evil.test/x'}),'[skip]');
 assert.equal(await publicExpression('我喜欢这里的节奏',{recentPosts:['我喜欢这里的节奏'],ask:async()=> '不应调用'}),'[skip]');
});
test('cancellation never returns stale public text',async()=>{
 const abort=new AbortController();await assert.rejects(publicExpression('该作品展示节奏',{signal:abort.signal,ask:async()=>{abort.abort();return '我喜欢这里';}}),e=>e.name==='AbortError');
});
