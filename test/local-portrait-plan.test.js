import test from 'node:test';
import assert from 'node:assert/strict';
import {localPortraitSubject,applyLocalPortraitPlan,lockLocalPortraitCamera,resolveLocalPhotoSubject} from '../local-portrait-plan.js';

const base={ownPortrait:false,camera:'scene',framing:'scene',prompt:'图书馆，绿色外套',lifeContext:{location:'图书馆'},styleTags:['anime']};
test('omitted photo subjects inherit only a recent human photo request and do not follow an assistant promise',()=>{
 const history=[{role:'user',content:'发一张你在窗边看书的自拍'},{role:'assistant',content:'嗯，等一会儿。'},{role:'user',content:'好'}];
 for(const request of ['拍一张给我看看','再拍一张','那发张吧','照片发我看看']){
  const resolved=resolveLocalPhotoSubject(request,{history});assert.equal(resolved.source,'recent-human-photo',request);assert.equal(resolved.ambiguous,false);assert.equal(applyLocalPortraitPlan(resolved.request,base).ownPortrait,true);
 }
 assert.equal(resolveLocalPhotoSubject('拍一张给我看看',{history:[{role:'assistant',content:'我给你发自拍。'}]}).ambiguous,true);
 assert.equal(resolveLocalPhotoSubject('拍一张给我看看',{history:[{role:'user',content:'你今天看了什么书？'}]}).ambiguous,true);
 const plant=resolveLocalPhotoSubject('再拍一张',{history:[{role:'user',content:'生成一张窗边绿植的图片'}]});assert.equal(plant.ambiguous,false);assert.equal(applyLocalPortraitPlan(plant.request,base).ownPortrait,false);
 const explicit=resolveLocalPhotoSubject('生成一张海边风景图',{history});assert.equal(explicit.source,'current');assert.equal(explicit.ambiguous,false);
});
test('ordinary local portrait synonyms select the current character and preserve requested composition independently of API routing',()=>{
 for(const request of ['我想看看你的相片','发一张你的近照，穿绿色外套','想看你的日常照','拍一张你的自拍','给我看看你的穿搭']){
  assert.equal(localPortraitSubject(request),true,request);const plan=applyLocalPortraitPlan(request,base);assert.equal(plan.ownPortrait,true,request);assert.equal(plan.camera,'front',request);assert.deepEqual(plan.lifeContext,base.lifeContext);assert.deepEqual(plan.styleTags,base.styleTags);assert.match(plan.cameraChinese,/自拍/);
 }
 const mirror=applyLocalPortraitPlan('发一张你的相片，对镜自拍',base);assert.equal(mirror.camera,'mirror');assert.match(mirror.cameraChinese,/镜面/);
 const external=applyLocalPortraitPlan('发一张你的相片，请朋友他拍全身',base);assert.equal(external.camera,'external');assert.equal(external.ownPortrait,true);assert.equal(external.framing,'full');
 const rear=applyLocalPortraitPlan('发一张你的日常照，用后置拍眼前的书桌',base);assert.equal(rear.camera,'rear');assert.equal(rear.ownPortrait,false);
});
test('scenes, other people, quotes, explanations and opt-outs cannot select the character reference',()=>{
 for(const request of ['生成一张海边风景图','我要看照片：只画窗边绿植，不要人物','发一张其他人的自拍','画一张我的朋友的肖像','不要你的照片','“发一张你的相片”是什么意思','你的自拍提示词怎么写','只拍静物，不需要角色']){
  assert.equal(localPortraitSubject(request),false,request);assert.equal(applyLocalPortraitPlan(request,base),base,request);
 }
});
test('local final prompt retains front or mirror selfie constraints without forcing external or scene requests into selfies',()=>{
 const front=applyLocalPortraitPlan('发一张你的自拍',base);const original='她穿绿色外套坐在窗边，背景是书架。';
 const locked=lockLocalPortraitCamera(original,front,'zh');assert.match(locked,/前置自拍/);assert.match(locked,/画外/);assert.match(locked,/书架/);assert.equal(lockLocalPortraitCamera(locked,front,'zh'),locked);
 assert.match(lockLocalPortraitCamera('A person by a bookshelf.',front,'en'),/front-facing selfie/i);
 const mirror=applyLocalPortraitPlan('发一张你的对镜自拍',base);assert.match(lockLocalPortraitCamera(original,mirror,'zh'),/镜面/);
 assert.equal(lockLocalPortraitCamera(original,{ownPortrait:true,camera:'external'},'zh'),original);
 assert.equal(lockLocalPortraitCamera(original,{ownPortrait:false,camera:'scene'},'zh'),original);
});
