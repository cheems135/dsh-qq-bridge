import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createQzoneService} from '../qzone-service.js';import {feedsTimeline} from '../qzone-feeds.js';
const auth={uin:'12345678',cookie:'uin=o12345678;p_skey=test',gtk:1},context={accountId:'a',personaId:'p'},friend='87654321';
const card=(uin=friend,tid='actual-post',caption='窗边的小猫')=>`<i name="feed_data" data-uin="${uin}" data-tid="${tid}"></i><div class="f-info">${caption}</div><div class="mod-comments"><li data-type="commentroot" data-tid="11" data-uin="55555555" data-nick="读者"><div class="comments-content"><a>读者</a>: 好可爱</div></li></div>`;
function fixture(){let state,valid=true,writes=0,observed=false;const calls=[];const service=createQzoneService({storage:{read:()=>state,write:v=>state=structuredClone(v)},getAuth:async()=>auth,authorize:()=>valid,allowTarget:uin=>[friend,auth.uin].includes(uin),loadImage:()=>{throw Error('unused');},fetchImpl:async(url,options)=>{const parsed=new URL(url);calls.push({url:parsed,options});
 if(parsed.pathname.includes('feeds3_html_more'))return Response.json({code:0,data:{data:[{html:card()+(observed?`<li data-type="commentroot" data-tid="99" data-uin="${auth.uin}"><div class="comments-content"><a>自己</a>: 这张光线真好</div></li>`:'')},{html:card('99999999','not-friend','别人的动态')}]}});
 if(parsed.pathname.includes('re_feeds')){writes++;return Response.json({code:0,commentid:'99'});}
 throw Error('unexpected request');}});return{service,calls,get state(){return state;},get writes(){return writes;},invalidate:()=>valid=false,observe:()=>observed=true};}
test('friend feed returns only actually observed target posts and comments, without one request per post',async()=>{
 const h=fixture();const got=await h.service.feed({uin:friend},context);assert.equal(h.calls.length,1);assert.equal(h.calls[0].url.searchParams.get('scope'),'0');assert.equal(h.calls[0].url.searchParams.get('uinlist'),friend);assert.equal(got.posts.length,1);assert.equal(got.posts[0].tid,'actual-post');assert.equal(got.comments[0].text,'好可爱');assert.doesNotMatch(JSON.stringify(got),/别人的动态|p_skey/);
 for(let i=0;i<10;i++){h.service.status(context);await h.service.nextReply(context);}assert.equal(h.calls.length,1);
});
test('root comment sends paramstr=1 to an observed friend post, deduplicates writes and verifies exact readback',async()=>{
 const h=fixture(),args={text:'这张光线真好',target:{uin:friend,tid:'actual-post'},comment:true};await assert.rejects(h.service.publish(args,context),/实际浏览/);assert.equal(h.calls.length,0);
 await h.service.feed({uin:friend},context);const result=await h.service.publish(args,context);assert.equal(result.status,'accepted');assert.equal(h.writes,1);
 const body=new URLSearchParams(h.calls.at(-1).options.body);assert.equal(body.get('paramstr'),'1');assert.equal(body.get('hostUin'),friend);assert.equal(body.get('topicId'),friend+'_actual-post__1');assert.equal(body.get('commentId'),null);assert.equal(body.get('t2_tid'),null);
 const duplicate=await h.service.publish(args,context);assert.equal(duplicate.duplicate,true);assert.equal(h.writes,1);
 assert.equal((await h.service.verifyEntry(result.id,context)).state,'unconfirmed');h.observe();assert.equal((await h.service.verifyEntry(result.id,context)).state,'observed');assert.equal(h.writes,1);
});
test('unallowed targets, different personas and cancelled scopes cannot reuse observed friend posts',async()=>{
 const h=fixture();await assert.rejects(h.service.feed({uin:'99999999'},context),/允许范围/);assert.equal(h.calls.length,0);await h.service.feed({uin:friend},context);
 await assert.rejects(h.service.publish({text:'评论',target:{uin:friend,tid:'actual-post'},comment:true},{...context,personaId:'other'}),/实际浏览/);h.invalidate();await assert.rejects(h.service.feed({uin:friend},context),/变化/);assert.equal(h.writes,0);
});
test('ambiguous cards, missing or guessed IDs never become comment targets',()=>{
 const value={data:{data:[{html:card()+card(friend,'second')},{html:card(friend,'bad/id')},{html:card(friend,'exact','&lt;script&gt;只是正文&lt;/script&gt;')}]}};const got=feedsTimeline(value,{uin:friend});assert.equal(got.length,1);assert.equal(got[0].tid,'exact');assert.equal(got[0].untrusted,true);
});
test('autonomy checks no longer call comment discovery; native and local tools retain on-demand visit actions',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),tool=readFileSync(new URL('../agent-capabilities.js',import.meta.url),'utf8');assert.doesNotMatch(source,/await qzone\(\)\.nextReply/);
 for(const action of ['friends','feed','comment']){assert(source.includes("args.action==='"+action+"'"));assert(tool.includes("'"+action+"'"));}
 assert.match(source,/qzoneFriends\(context\)/);assert.match(source,/effectiveUsers\(\)\.includes\(String\(f.user_id\|\|f.uin\)\)/);
});
test('schedule locator shows the actual activity and has an accessible navigation button without extra fetching',()=>{
 const html=readFileSync(new URL('../console.html',import.meta.url),'utf8'),start=html.indexOf('  function scheduleLocator('),end=html.indexOf('\n  function rebuiltDaily(',start),fn=html.slice(start,end).trim();
 const current={v:{today:{slots:[{state:'current',activity:'原计划画画'}]}},life:{scene:{activity:'正在玩解谜游戏',planned:false}},sleep:false};const render=Function('currentCompanion','esc','return ('+fn+')')(()=>current,String);
 assert.match(render(),/正在玩解谜游戏/);assert.match(render(),/scheduleLocateNow/);assert.doesNotMatch(fn,/fetch|api\(|setInterval|geolocation/);current.sleep=true;assert.match(render(),/正在睡眠/);assert.match(html,/\.life-now/);assert.match(html,/prefers-reduced-motion/);
});
