import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRunningHub,chooseRunningHub,splitWorkflowRequest} from '../image-workflows.js';
import {routePersonaWorkflow} from '../image-persona.js';

const entries = [
  {id:'portrait',name:'日常自拍',mode:'workflow',workflowId:'100',style:'anime'},
  {id:'landscape',name:'写实风景',mode:'workflow',workflowId:'200',style:'realistic'},
];

test('RunningHub uses the saved manual image selection regardless of prompt style', () => {
  const config=normalizeRunningHub({workflows:entries,activeWorkflowId:'portrait'});
  assert.equal(routePersonaWorkflow(config,{styles:['realistic'],selector:'landscape',hasReference:false}),'portrait');
  assert.equal(chooseRunningHub(config,'portrait').workflowId,'100');
  assert.throws(()=>chooseRunningHub(config,'landscape'),/选择已改变/);
  assert.deepEqual(splitWorkflowRequest('写实风景|夕阳海岸',config),{text:'写实风景|夕阳海岸',selector:''});
});

test('RunningHub migrates only a single unambiguous legacy choice', () => {
  assert.equal(normalizeRunningHub({workflows:[entries[0]],activeWorkflowId:''}).activeWorkflowId,'portrait');
  assert.equal(normalizeRunningHub({workflows:entries,activeWorkflowId:''}).activeWorkflowId,'');
  const cleared=normalizeRunningHub({workflows:[entries[0]],activeWorkflowId:'',manualSelectionRequired:true});
  assert.equal(cleared.activeWorkflowId,'');
  assert.throws(()=>chooseRunningHub(cleared),/没有选中当前图片工作流/);
  assert.throws(()=>routePersonaWorkflow(cleared,{styles:['anime']}),/没有选中当前图片工作流/);
});
