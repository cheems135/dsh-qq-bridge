import {createFormState,sameFormValue,formScope} from '../ui/form-state.js';
import {passiveConsoleRequest} from '../ui/console-interaction.js';
import {readConsoleSource} from './console-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source=readConsoleSource();
function code(name){const start=source.indexOf('  function '+name+'(');assert(start>=0);const tail=source.slice(start+1),end=tail.search(/\n  (?:async )?function |\n  var /);assert(end>0);return source.slice(start,start+end+1);}
function fixture(){
 let form={first:'old',other:'old'},resolve,reject;
 const listeners={};
 const formState=createFormState();formState.begin('settings',form);
 const context=vm.createContext({formState,sameFormValue,passiveConsoleRequest,tab:'settings',renderedTab:'settings',renderedEditingId:'',mutationEpoch:0,
  formScope,data:{settings:{activeAccountId:'first'}},formBaselines:formState.baselines,pageDrafts:formState.drafts,personaTool:'',floatingSaveCapture:null,
  readForm:()=>({...form}),deviceUiPreview:()=>false,renderDraftNotice(){},feed(){},feedName:()=>'',
  $:()=>({addEventListener:(name,fn)=>{listeners[name]=fn;}}),formKey:field=>field.key,
  fieldsSaved:()=>['first'],requestApi:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})});
 for(const name of ['sameValue','rememberDraft','markSaved','api'])vm.runInContext(code(name),context);
 const start=source.indexOf("    ['input', 'change'].forEach(function (name)");
 const end=source.indexOf("    window.addEventListener('beforeunload'",start);
 assert.ok(start>=0&&end>start);
 vm.runInContext(source.slice(start,end),context);
 function edit(value){
  for(const [key,next] of Object.entries(value)){
   form[key]=next;
   listeners.input({target:{key,matches:()=>true}});
  }
 }
 return {context,edit,save:()=>context.api('POST','/im-bridge/settings',{first:form.first}),resolve:()=>resolve({ok:true}),reject:()=>reject(Error('test save failed'))};
}
test('saving one section leaves unrelated unsaved fields in the draft',async()=>{
 const f=fixture();f.edit({first:'saved',other:'unsaved'});const p=f.save();f.resolve();await p;
 assert.equal(f.context.formBaselines.settings.first,'saved');assert.equal(f.context.formBaselines.settings.other,'old');assert.equal(f.context.pageDrafts.settings.other,'unsaved');
});
test('edits made while a save is pending remain unsaved',async()=>{
 const f=fixture();f.edit({first:'submitted'});const p=f.save();f.edit({first:'typed later'});f.resolve();await p;
 assert.equal(f.context.formBaselines.settings.first,'submitted');assert.equal(f.context.pageDrafts.settings.first,'typed later');
});
test('failed save preserves the draft and original baseline',async()=>{
 const f=fixture();f.edit({first:'unsaved'});const p=f.save();f.reject();await assert.rejects(p,/test save failed/);
 assert.equal(f.context.formBaselines.settings.first,'old');assert.equal(f.context.pageDrafts.settings.first,'unsaved');
});
test('a late save from another account cannot clear the current form',async()=>{
 const f=fixture();f.edit({first:'unfinished'});const pending=f.save();
 f.context.data={settings:{activeAccountId:'second'}};f.resolve();await pending;
 assert.equal(f.context.formBaselines.settings.first,'old');assert.equal(f.context.pageDrafts.settings.first,'unfinished');
});
