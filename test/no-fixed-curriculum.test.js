import {readConsoleSource} from './console-source.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createExpressionLearning} from '../expression-learning.js';import {learningConfig} from '../learning-memory.js';
const root=new URL('../',import.meta.url);
test('no fixed study engine, bundled vocabulary or automatic curriculum remains in the plugin',()=>{
 for(const file of ['meme-knowledge.js','meme-study.js','assets/meme-knowledge.json','assets/expression-dialogues.json'])assert.equal(fs.existsSync(new URL(file,root)),false,file);
 const source=fs.readFileSync(new URL('index.js',root),'utf8');assert.doesNotMatch(source,/createMemeStudy|memeStudyTimer|memeKnowledge|directivesSeeded/);
 assert.equal(learningConfig({}).focus,'mixed');assert.equal(learningConfig({focus:'social-memes'}).focus,'mixed');
});
test('a bundled public reference does not turn an unrelated phrase into a lesson',()=>{
 const service=createExpressionLearning({storage:{read:()=>null,write:()=>{}},allowed:()=>true,ask:()=>{throw Error('No autonomous model calls in a reference query');}});
 const meta={accountId:'a',key:'private:1',personaId:'p'};
 assert.deepEqual(service.hintDetailed(meta,'红温 破防 你在干嘛'),{text:'',ids:[]});
 const snapshot=service.snapshot(meta);
 assert(snapshot.corpus>0);assert.equal(snapshot.corpus,snapshot.references.length);
 assert.equal(snapshot.learned,0);
});
test('learning screen renders without the removed fixed-study controls and all inline scripts compile',()=>{
 const html=readConsoleSource();
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
 const start=html.indexOf('  function learningNotebookMarkup('),end=html.indexOf('  function viewSongs()',start),scope={companionPanel:{value:{}},companionPanelToolbar:()=>'',esc:String};vm.createContext(scope);vm.runInContext(html.slice(start,end),scope);
 const markup=scope.viewStudy();assert.match(markup,/她的学习本/);assert.doesNotMatch(markup,/学习全部|cpMeme|梗词库/);assert.match(markup,/固定任务/);
 const m={accountId:'first',key:'private:1',personaId:'first'},service=createExpressionLearning({storage:{read:()=>null,write:()=>{}},allowed:()=>true});
 service.hintDetailed(m,'好消息，我通过了',{compact:true,auditId:'test-sample'});
 scope.companionPanel.value.expression=service.snapshot(m);
 const retrieved=scope.viewStudy();
 assert(retrieved.includes('公开贴吧表达参考 '+scope.companionPanel.value.expression.references.length+' 条'));
 assert(retrieved.includes('已提炼的表达方法 0 条'));assert(retrieved.includes('已取作参考'));assert(retrieved.includes('贴吧样本 · '));
 assert(!retrieved.includes('data-cp-feedback="test-sample"'));
 service.recordOutcome(m,{auditId:'test-sample',status:'delivered',messageIds:['qq1']});
 scope.companionPanel.value.expression=service.snapshot(m);
 const delivered=scope.viewStudy();
 assert(delivered.includes('QQ 已确认送达'));assert(delivered.includes('data-cp-feedback="test-sample"'));
 assert(!html.includes('LCCC 小样本（约 220 条）'));
});
