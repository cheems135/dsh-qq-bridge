import {readConsoleSource} from './console-source.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createExpressionLearning} from '../expression-learning.js';import {learningConfig} from '../learning-memory.js';
const root=new URL('../',import.meta.url);
test('no fixed study engine, bundled vocabulary or automatic curriculum remains in the plugin',()=>{
 for(const file of ['meme-knowledge.js','meme-study.js','assets/meme-knowledge.json','assets/expression-dialogues.json'])assert.equal(fs.existsSync(new URL(file,root)),false,file);
 const source=fs.readFileSync(new URL('index.js',root),'utf8');assert.doesNotMatch(source,/createMemeStudy|memeStudyTimer|memeKnowledge|directivesSeeded/);
 assert.equal(learningConfig({}).focus,'mixed');assert.equal(learningConfig({focus:'social-memes'}).focus,'mixed');
});
test('expression reference is empty until actual dialogue learning has supplied something',()=>{
 const service=createExpressionLearning({storage:{read:()=>null,write:()=>{}},allowed:()=>true,ask:()=>{throw Error('No autonomous model calls in a reference query');}});
 assert.deepEqual(service.hintDetailed({accountId:'a',key:'private:1',personaId:'p'},'红温 破防 你在干嘛'),{text:'',ids:[]});assert.equal(service.snapshot({}).corpus,0);
});
test('learning screen renders without the removed fixed-study controls and all inline scripts compile',()=>{
 const html=readConsoleSource();
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(match[1].trim())new vm.Script(match[1]);
 const start=html.indexOf('  function learningNotebookMarkup('),end=html.indexOf('  function viewSongs()',start),scope={companionPanel:{value:{}},companionPanelToolbar:()=>'',esc:String};vm.createContext(scope);vm.runInContext(html.slice(start,end),scope);
 const markup=scope.viewStudy();assert.match(markup,/她的学习本/);assert.doesNotMatch(markup,/学习全部|cpMeme|梗词库/);assert.match(markup,/固定任务/);
});
