import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ui/console-controller.js',import.meta.url),'utf8');
function functionSource(name){const start=source.indexOf('  function '+name+'('),tail=source.slice(start+1),end=tail.search(/\n  (?:async )?function |\n  var /);assert(start>=0&&end>0);return source.slice(start,start+end+1);}
test('current connection evidence takes priority over stale companion snapshots in either direction',()=>{
 const c=vm.createContext({data:{status:{connected:true,accountPaused:false}},companionPanel:{value:{online:false}}});
 vm.runInContext(functionSource('currentCompanion'),c);
 assert.equal(c.currentCompanion().online,true);
 c.data.status.connected=false;c.companionPanel.value.online=true;
 assert.equal(c.currentCompanion().online,false);
 c.data.status.connected=true;c.data.status.accountPaused=true;
 assert.equal(c.currentCompanion().online,false);
});
test('workflow draft field identities are stable and isolated across different entries',()=>{
 const c=vm.createContext({});vm.runInContext(functionSource('formKey'),c);
 const field=(id,key,map=false)=>({name:'',closest:selector=>selector==='[data-local-workflow]'?{dataset:{localWorkflow:id}}:null,matches:selector=>selector==='[data-wf],[data-map]',dataset:map?{map:key}:{wf:key}});
 assert.equal(c.formKey(field('one','name')),'workflow:one:name');
 assert.equal(c.formKey(field('two','name')),'workflow:two:name');
 assert.equal(c.formKey(field('one','prompt',true)),'workflow:one:prompt');
});
