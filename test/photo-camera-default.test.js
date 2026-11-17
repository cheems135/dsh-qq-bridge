import test from 'node:test';
import assert from 'node:assert/strict';
import {photoComposition,personaCamera} from '../image-persona.js';

test('character activities and previous selfies never switch the default to a rear view',()=>{
  for(const request of ['', '发张你的日常照，看看此刻在干嘛', '拍你正在吃饭的照片', '拍你手中拿着书的样子', '在窗外风景前自拍', '自拍，眼前放着一杯水']){
    const plan=photoComposition({request,subject:'角色本人，用后置拍摄',ownPortrait:true,cameraPlan:personaCamera('后置',true),recent:[{camera:'front',framing:'upper'}]});
    assert.equal(plan.camera,'front',request);
    assert.match(plan.chinese,/自拍/);
  }
});

test('explicit camera and crop requests override the selfie default',()=>{
  for(const [request,camera,framing] of [
    ['用后置拍眼前的书桌','rear','scene'],
    ['从你的视角拍风景','rear','scene'],
    ['对镜自拍，半身','mirror','upper'],
    ['请朋友他拍全身','external','full'],
    ['外部视角拍全身','external','full'],
    ['前置自拍，只看脸','front','face'],
    ['自拍从头到脚','front','full'],
  ]){
    const plan=photoComposition({request,subject:'前置自拍',ownPortrait:true});
    assert.equal(plan.camera,camera,request);
    assert.equal(plan.framing,framing,request);
  }
  assert.notEqual(photoComposition({request:'不要自拍，拍你的半身照',ownPortrait:true}).camera,'front');
  assert.equal(photoComposition({request:'不要后置，发张你的自拍',ownPortrait:true}).camera,'front');
});

test('landscapes and artwork keep their requested subjects',()=>{
  const plan=photoComposition({request:'只画海边风景，不要人物',ownPortrait:false});
  assert.notEqual(plan.camera,'front');
  assert.equal(plan.framing,'scene');
});
