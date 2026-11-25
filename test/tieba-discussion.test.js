import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readSharedLink} from '../bridge-features.js';
import {publicForumReplies} from '../tieba-discussion.js';
import {createWebsiteReading} from '../website-reading.js';
import {createExpressionLearning} from '../expression-learning.js';
import {localAnalysisInput} from '../local-chat-context.js';

const url='https://tieba.baidu.com/p/96347',meta={accountId:'one',key:'private:12345',personaId:'p'};
const field=obj=>JSON.stringify(obj).replaceAll('"','&quot;');
function floor(id,no,words,children=''){
  return '<div class="l_post l_post_bright" data-field="'+field({content:{post_id:id,post_no:no}})+'">'+
    '<span>某层的作者名</span><div class="d_post_content j_d_post_content" id="post_content_'+id+'">'+words+'</div>'+children+'</div>';
}
function child(id,pid,words,extra={}){
  return '<li class="lzl_single_post" data-field="'+field({spid:id,pid,...extra})+'">'+
    '<a class="lzl_p_p">路过的昵称</a><span class="lzl_content_main">'+words+'</span></li>';
}
const rootWords='买了个闹钟，结果它每天把隔壁叫醒。',
  other='这椅子坐起来像在开船。',otherReply='那先给我留一张船票。',third='带上我的晕船药再出发。';
const html='<html><title>日常讨论</title><body>'+
  floor('901',1,rootWords)+
  floor('902',2,other,
    child('101','902',otherReply)+
    child('102','902','回复 <a>公开昵称</a>：'+third,{reply_to_spid:'101'})+
    child('103','902','回复 另一位：这一句无法确认父评。')+
    child('104','777','跨楼不能碰')+
    child('105','902','另一个楼层引用',{reply_to_spid:'903'}))+
  floor('903',3,'我还以为是上班打卡机。',child('106','903','这下隔壁可以报加班了。'))+
  '<script>'+floor('904',4,'脚本中的伪样本')+'</script></body></html>';
const read=(target=url,body=html,code=200)=>readSharedLink(target,{read:async()=>({status:code,body})});
test('an anonymous thread read retains only a topic, its containing floor or an explicitly identified reply',async()=>{
  const page=await read(),pairs=page[publicForumReplies];assert.equal(page.status,'read');
  const projected=pairs.map(({text,context,relation})=>[text,context,relation]);
  assert.deepEqual(projected,[
    [other,rootWords,'thread'],[otherReply,other,'floor'],[third,otherReply,'direct'],
    ['我还以为是上班打卡机。',rootWords,'thread'],
    ['这下隔壁可以报加班了。','我还以为是上班打卡机。','floor'],
  ]);
  assert(!JSON.stringify(pairs).includes('昵称'));assert(!JSON.stringify(page).includes('"relation":'));
  assert.equal(({...page})[publicForumReplies],pairs);
  for(const target of ['https://tieba.baidu.com/f?kw=a','https://tieba.baidu.com.evil.test/p/96347',url+'?session=private']){
    assert.equal((await read(target))[publicForumReplies],undefined);
  }
  assert.equal((await read(url,'<title>安全验证</title>'+html))[publicForumReplies],undefined);
  assert.equal((await read(url,html,403))[publicForumReplies],undefined);
  assert.equal((await read(url,html.replace('post_content_901','post_content_999')))[publicForumReplies].some(r=>r.context===rootWords),false);
});
test('the website-read and existing passive lesson use the public pair once and never schedule a call from forum input alone',async()=>{
  let htmlCalls=0,studyCalls=0,lookups=0,webState,expressionState,learning=true;
  const web=createWebsiteReading({
    config:()=>({enabled:true,learning}),allowed:()=>true,signature:()=>String(learning),
    storage:{read:()=>webState,write:d=>{webState=structuredClone(d);}},
    readPage:(target,opts)=>readSharedLink(target,{...opts,read:async()=>{htmlCalls++;return {status:200,body:html};}}),
  });
  const engine=createExpressionLearning({
    allowed:()=>true,now:()=>1_000_000_000,storage:{read:()=>expressionState,write:d=>{expressionState=structuredClone(d);}},
    forumSamples:m=>{lookups++;return web.forumSamples(m);},ask:(_system,input,cap)=>{
      studyCalls++;assert.equal(cap,1200);
      const samples=JSON.parse(input).utterances;
      assert(samples.some(s=>s.source==='qq'));const picked=samples.find(s=>s.source==='tieba'&&s.text===otherReply);
      if(studyCalls===1){assert.equal(picked.context,other);assert.equal(picked.relation,'floor');}
      else assert.equal(picked,undefined);
      assert(!input.includes('96347')&&!input.includes('昵称')&&!input.includes('12345'));
      return JSON.stringify({items:picked?[{situation:'朋友把椅子比作船',style:'接住这个比喻，顺势给自己找个位置',example:'后排那块甲板归我',sourceId:picked.id,quote:'留一张船票'}]:[]});
    }
  });
  await web.read(url,meta);assert.equal(htmlCalls,1);assert.equal(studyCalls,0);
  assert.deepEqual(await engine.learn(meta,{force:true}),{learned:0});assert.equal(lookups,0);
  assert.equal(web.forumSamples({...meta,personaId:'other'}).length,0);
  assert.equal(web.forumSamples({...meta,key:'private:76543'}).length,0);
  assert.equal(web.forumSamples({...meta,accountId:'two'}).length,0);
  assert(!JSON.stringify(web.snapshot(meta)).includes('forumReplies'));
  assert(!JSON.stringify(web.evidenceFor(meta,url)).includes('forumReplies'));
  learning=false;assert.equal(web.forumSamples(meta).length,0);learning=true;
  const due=tag=>Array.from({length:6},(_,i)=>({id:tag+i,text:'今天有个新主意'+i,role:'user'}));
  engine.observeBatch(meta,due('a'));assert.deepEqual(await engine.learn(meta,{force:true}),{learned:1});
  assert.deepEqual(engine.snapshot(meta).sources,{qq:0,bilibili:0,tieba:1});
  engine.observeBatch(meta,due('b'));await engine.learn(meta,{force:true});
  assert.equal(htmlCalls,1);assert.equal(lookups,2);assert.equal(studyCalls,2);
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  assert.match(host,/forumSamples:meta=>websiteReader\?\.forumSamples\(meta\)/);
});

test('forum learning skips commercial referrals and page controls while keeping playful disagreement',async()=>{
  const messages=['首页搜这个优惠礼包就能领取','私信我免费领新人礼包','还有8条，点击查看','我倒觉得这部片不值回票价，打完折都不值。','这下好，纸箱正式升任我们家的猫窝了。'];
  let calls=0;
  const learner=createExpressionLearning({allowed:()=>true,now:()=>1_000_000_000,
    storage:{read:()=>null,write(){}},forumSamples:()=>messages.map((text,i)=>({id:'t:'+i,text,context:'你怎么看这事？',relation:'floor'})),
    ask:(rules,input)=>{calls++;assert.match(rules,/跳过招揽、纯辱骂和界面控件/);
      assert.deepEqual(JSON.parse(input).utterances.filter(x=>x.source==='tieba').map(x=>x.text),messages.slice(-2));return '{"items":[]}';}});
  learner.observeBatch(meta,Array.from({length:6},(_,i)=>({id:String(i),text:'今天倒挺热闹的',role:'user'})));
  await learner.learn(meta,{force:true});assert.equal(calls,1);
});

test('local background learning receives both public replies after a full primary batch',async()=>{
  const forum=[{id:'one',text:'一开门它就认领了窗台。'},{id:'two',text:'给那块窗台留个名额。'}]
    .map(row=>({...row,context:'猫刚选了个位置。',relation:'thread'}));
  const engine=createExpressionLearning({storage:{read:()=>null,write(){}},allowed:()=>true,forumSamples:()=>forum,
    ask:(_rules,input)=>{
      const {utterances}=JSON.parse(localAnalysisInput(input));
      assert.equal(utterances.length,10);
      assert.equal(utterances.filter(row=>row.source==='qq').length,8);
      const [first,second]=utterances.slice(-2);
      assert.deepEqual([first.text,second.text],forum.map(row=>row.text));
      return JSON.stringify({items:[{situation:'朋友讲宠物选座的小事',style:'顺着它的偏好开个玩笑',example:'沙发角落给新房客了',sourceId:second.id,quote:'留个名额'}]});
    }});
  engine.observeBatch(meta,Array.from({length:8},(_,i)=>({id:'q'+i,text:'今天家里来了访客。',role:'user'})));
  assert.deepEqual(await engine.learn(meta,{force:true}),{learned:1});
  assert.equal(engine.snapshot(meta).sources.tieba,1);
});
