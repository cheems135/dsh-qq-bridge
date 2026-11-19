import test from 'node:test';
import assert from 'node:assert/strict';
import {photoComposition} from '../image-persona.js';
import {applyLocalPortraitPlan} from '../local-portrait-plan.js';
import {createImageStudio} from '../image-studio.js';

const behind='拍一张你坐在书桌旁背对镜头的照片，回头看相机，双手搭在椅背';
test('explicit camera placement and body orientation override selfie and default waist-up crop',()=>{
  for(const request of [behind,'拍你的背影照','从她的斜后方拍','从侧面拍一张','用三脚架拍摄','不要自拍，给我拍张你的照片','非自拍，拍张你的照片']){
    const plan=photoComposition({request,subject:'上一张前置自拍',ownPortrait:true,recent:[{framing:'face'}]});
    assert.equal(plan.camera,'external',request);
    assert.equal(plan.framing,'scene',request);
    assert.doesNotMatch(plan.english,/selfie lens/);
  }
  assert.equal(photoComposition({request:'从侧面拍一张上半身',ownPortrait:true}).framing,'upper');
  assert.equal(photoComposition({request:'前置自拍，身体背对镜头回头',ownPortrait:true}).camera,'front');
  assert.equal(photoComposition({request:'对镜自拍',ownPortrait:true}).camera,'mirror');
  assert.equal(photoComposition({request:'后置镜头看桌面',ownPortrait:true}).camera,'rear');
  assert.equal(photoComposition({request:'拍一张你的照片',subject:'她的背影',ownPortrait:true}).camera,'front');
});

test('local camera override retains the character identity and uses the current crop',()=>{
  const plan=applyLocalPortraitPlan(behind,{ownPortrait:true,prompt:'拍摄当前角色',camera:'front',framing:'upper'});
  assert.equal(plan.ownPortrait,true);
  assert.equal(plan.camera,'external');
  assert.equal(plan.framing,'scene');
  assert.doesNotMatch(plan.cameraChinese,/腰部|前置自拍/);
});

test('the API optimizer and verifier receive an external scene without a selfie or waist crop constraint',async()=>{
  const v=photoComposition({request:behind,ownPortrait:true});
  const plan={prompt:behind,humanRequest:behind,ownPortrait:true,camera:v.camera,framing:v.framing,cameraEnglish:[v.english,v.framingEnglish].join(' '),cameraChinese:[v.chinese,v.framingChinese].join(' ')};
  let optimized=0,reviewed=0;
  const studio=createImageStudio({getConfig:()=>({promptLanguage:'en'}),visualPlan:()=>plan,ask:async(system,input)=>{
    const json=JSON.parse(input), constraints=json.requirements||json;
    if(system.startsWith('【图像细节核对】')){
      reviewed++;
      assert.match(json.finalPrompt,/camera positioned behind/i);
      assert.doesNotMatch(json.finalPrompt,/waist|selfie/i);
      return JSON.stringify({ok:true,missing:[]});
    }
    optimized++;
    assert.equal(constraints.camera,'external');
    assert.equal(constraints.framing,'scene');
    assert.match(constraints.currentHumanRequest,/背对镜头/);
    return JSON.stringify({prompt:'The camera positioned behind her captures her sitting beside the desk and looking back over her shoulder, with both hands resting on the chair back. Gentle window light falls across the wooden desk and marks the edge of her shoulder.'});
  }});
  const prepared=await studio.prepare(behind);
  assert.match(prepared.prompt,/camera positioned behind/i);
  assert.ok(optimized>0&&reviewed>0);
});
