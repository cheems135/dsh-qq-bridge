import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {shareBubbleParts} from '../chat-bubbles.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
test('ordinary API and local link replies also opt into sharing bubbles without changing media command boundaries',()=>{
 const start=source.indexOf('function splitBursts('),end=source.indexOf('\n}',start)+2;
 const split=Function('shareBubbleParts','naturalBubbleParts','splitMessage','return ('+source.slice(start,end)+');')(shareBubbleParts,(_text)=>['media-intact'],text=>[text]);
 const url='https://example.test/one?a=1&b=2';assert.deepEqual(split('刚好想到你。\n这个挺有意思。\n'+url,2000,{shareLinks:true}),['刚好想到你。','这个挺有意思。',url]);
 assert.deepEqual(split('\uE200PIC0\uE201\n'+url,2000,{shareLinks:true}),['media-intact']);
 assert.match(source,/splitBursts\(protectedBody, replyCharLimit\(\),\{shareLinks:true/);assert.match(source,/splitBursts\(streamedTail.tail,replyCharLimit\(\),\{shareLinks:true/);
});
function shareFunction(deps){const start=source.indexOf('async(args,context)=>{',source.indexOf('      lifeShare:'));for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){let build;try{build=Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+');');}catch(error){if(error instanceof SyntaxError)continue;throw error;}return build(...Object.values(deps));}throw Error('share function not found');}
function fixture(){const queued=[],context={accountId:'a',personaId:'p',key:'private:11111',meta:{kind:'user',auditId:'audit'},exec:{}},job={id:'share',shares:[]};let failAt=-1;
 const deps={shareBubbleParts,targets:()=>[context.key],resolveShareRecipient:(_target,c)=>c.key,shareTask:()=>job,shareEvidence:()=>[{ok:true,substantive:true,tool:'bridge_read',url:'https://example.test/read?a=1&b=2'}],drawingStudio:{verifyArtifact:file=>({file,substantive:true})},digitalArtifact:()=>{},artifacts:()=> '/own',readFileSync:()=>Buffer.from('89504e470d0a1a0a','hex'),Buffer,naturalizeLinkForChat:async text=>text,agencyAuthorized:()=>true,executionRuntime:{begin:()=>{}},outgoingActivityChat:(_c,target)=>({key:target}),textHash:value=>String(value),rememberActivityShare:(_c,j,item)=>j.shares.push(item),sendSegments:(chat,segments)=>{if(queued.length===failAt)return null;const id='delivery-'+queued.length;queued.push({id,chat,segments});return id;}};
 return {context,job,queued,send:shareFunction(deps),failAfter:n=>failAt=n};}
test('sharing preserves deliberate paragraphs and keeps every exact link in its own bubble',()=>{
 const url='https://example.test/read?a=1&b=2#part';const got=shareBubbleParts('刚看到这段，想起你上次说的那个问题。\n这里的解释还挺有意思。\n'+url);assert.equal(got.length,3);assert.equal(got.at(-1),url);assert.equal(got.filter(s=>s.includes(url)).length,1);
 const sentence='这只猫画完了。窗边的光我留住了。尾巴还是有点倔。你看这副表情。';assert.equal(shareBubbleParts(sentence).length,2);assert.equal(shareBubbleParts(sentence).join(''),sentence);
 const code='```js\nconst url="https://example.test/a";\n```';assert.deepEqual(shareBubbleParts(code),[code]);const list='1. 第一项\n2. 第二项';assert.deepEqual(shareBubbleParts(list),[list]);
});
test('actual artwork sharing queues image then individual captions with independent deduplicated delivery IDs',async()=>{
 const h=fixture(),result=await h.send({action:'send',file:'/own/cat.png',caption:'刚画完这只猫。\n我把窗边的光留下了。\n给你看看。'},h.context);assert.equal(result.ok,true);assert.equal(result.deliveryIds.length,4);assert.equal(h.queued[0].segments[0].type,'image');assert.deepEqual(h.queued.slice(1).map(r=>r.segments[0].data.text),['刚画完这只猫。','我把窗边的光留下了。','给你看看。']);assert.equal(new Set(h.queued.map(r=>r.chat.deliveryKey)).size,4);assert.equal(h.context.meta.directTextSent,true);assert.deepEqual(h.job.shares[0].deliveryIds,result.deliveryIds);
 const duplicate=await h.send({action:'send',file:'/own/cat.png',caption:'刚画完这只猫。\n我把窗边的光留下了。\n给你看看。'},h.context);assert.equal(duplicate.duplicate,true);assert.equal(h.queued.length,4);
});
test('actual verified link sharing sends each natural paragraph followed by one intact original URL',async()=>{
 const h=fixture(),url='https://example.test/read?a=1&b=2',result=await h.send({action:'send',url,caption:'这段看得我有点想笑。\n你应该懂我为什么想到你。'},h.context);assert.equal(result.deliveryIds.length,3);assert.deepEqual(h.queued.map(r=>r.segments[0].data.text),['这段看得我有点想笑。','你应该懂我为什么想到你。',url]);
});
test('partial queue failure retains all committed parts and never retries the entire artwork on a repeated tool call',async()=>{
 const h=fixture();h.failAfter(2);const args={action:'send',file:'/own/cat.png',caption:'第一句。\n第二句。\n第三句。'},result=await h.send(args,h.context);assert.equal(result.ok,false);assert.equal(result.partial,true);assert.equal(result.deliveryIds.length,2);assert.equal(h.job.shares[0].expectedParts,4);const duplicate=await h.send(args,h.context);assert.equal(duplicate.ok,false);assert.equal(duplicate.partial,true);assert.equal(duplicate.duplicate,true);assert.equal(h.queued.length,2);
});
