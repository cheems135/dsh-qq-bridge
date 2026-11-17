import {createFormState,sameFormValue} from '../ui/form-state.js';
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
 const formState=createFormState();formState.begin('settings',form);
 const context=vm.createContext({formState,sameFormValue,passiveConsoleRequest,tab:'settings',renderedTab:'settings',renderedEditingId:'',mutationEpoch:0,
  formBaselines:formState.baselines,pageDrafts:formState.drafts,personaTool:'',floatingSaveCapture:null,
  readForm:()=>({...form}),deviceUiPreview:()=>false,renderDraftNotice(){},feed(){},feedName:()=>'',
  fieldsSaved:()=>['first'],requestApi:()=>new Promise((yes,no)=>{resolve=yes;reject=no;})});
 for(const name of ['sameValue','rememberDraft','markSaved','api'])vm.runInContext(code(name),context);
 return {context,edit:value=>{form={...form,...value};context.rememberDraft('settings');},save:()=>context.api('POST','/im-bridge/settings',{first:form.first}),resolve:()=>resolve({ok:true}),reject:()=>reject(Error('test save failed'))};
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
