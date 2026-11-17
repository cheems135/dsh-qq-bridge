import {IMAGE_STYLES} from './image-persona.js';
import {normalizePromptModel,promptModelEvidence} from './image-model-prompts.js';
// RunningHub configuration entries contain routing hints and node values only.
// Credentials and service addresses remain on the enclosing local configuration.
const clip = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
export function normalizeWorkflowEntry(value, index = 0) {
  const source = value && typeof value === 'object' ? value : {};
  const mode = source.mode === 'app' ? 'app' : source.mode==='workflow'?'workflow':source.mode==='auto'||!source.promptNodeId?'auto':'workflow';
  const workflowId = clip(source.workflowId, 100);
  const webappId = clip(source.webappId, 100);
  const discovery=normalizeDiscovery(source.discovery);
  return {
    id: clip(source.id, 80).replace(/[^a-zA-Z0-9_-]/g, '') || 'workflow-' + index,
    name: clip(source.name, 80) || '工作流 ' + (index + 1),
    promptLanguage:['zh','en'].includes(source.promptLanguage)?source.promptLanguage:'',promptModel:normalizePromptModel(source.promptModel),fixedPromptMode:source.fixedPromptMode==='preserve'?'preserve':'refine',triggerWords:nodeText(source.triggerWords).slice(0,500),
    style:IMAGE_STYLES.includes(source.style)?source.style:'auto', referenceMode:source.referenceMode==='off'?'off':'auto',referenceTarget:normalizeTargets(source.referenceTarget?[source.referenceTarget]:[])[0]||null,referenceReuseMissing:false,
    note: clip(source.note, 500), mode, workflowId, webappId,usePersonalQueue:source.usePersonalQueue===true||source.usePersonalQueue==='true'?'true':'false',
    autoDetect:source.autoDetect!==undefined?source.autoDetect===true:!source.promptNodeId,
    promptTargets:normalizeTargets(source.promptTargets),negativeTargets:normalizeTargets(source.negativeTargets),
    discovery,
    promptNodeId: clip(source.promptNodeId, 100),
    promptField: clip(source.promptField, 100) || 'text',
    instanceType: ['default','lite','plus'].includes(source.instanceType) ? source.instanceType : 'lite',
    extraNodes: (Array.isArray(source.extraNodes) ? source.extraNodes : []).slice(0, 64).map(item => ({
      nodeId: clip(item?.nodeId, 100), fieldName: clip(item?.fieldName, 100) || 'text',
      fieldValue: repairedNodeValue(item,discovery),
    })).filter(item => item.nodeId && !(source.discovery?.source==='request-example' && item.nodeId==='Description:' && item.fieldName==='text' && item.fieldValue==='' && !source.discovery.fields?.some(f=>String(f.nodeId)===item.nodeId && f.fieldName===item.fieldName))),
  };
}
export function normalizeRunningHub(value) {
  const config = value && typeof value === 'object' ? { ...value } : {};
  const seen = new Set();
  let list = (Array.isArray(config.workflows) ? config.workflows : []).slice(0, 40).map(normalizeWorkflowEntry).filter(entry => {
    if (seen.has(entry.id)) return false; seen.add(entry.id); return true;
  });
  // An explicit empty list means the user deleted their entries; never resurrect it.
  if (!Array.isArray(config.workflows) && (config.workflowId || config.webappId || config.promptNodeId)) {
    list = [normalizeWorkflowEntry({ ...config, id: 'legacy', name: '原有配置' })];
  }
  // Only an unambiguous, single-entry legacy library may choose itself. Once
  // several workflows exist, the saved manual selection is authoritative.
  const active = list.find(entry => entry.id === config.activeWorkflowId)
    || (!config.manualSelectionRequired && !config.activeWorkflowId && list.length === 1 ? list[0] : null);
  return { ...config, workflows: list, activeWorkflowId: active?.id || '', ...(active || (Array.isArray(config.workflows) ? {workflowId:'',webappId:'',promptNodeId:''} : {})) };
}
export function chooseRunningHub(value, selector = '') {
  const config = normalizeRunningHub(value);
  if (!config.activeWorkflowId) throw new Error('没有选中当前图片工作流，请在图像生成页手动选择并保存');
  if (selector && selector !== config.activeWorkflowId) throw new Error('生图期间工作流选择已改变，请重新生成提示词');
  return config;
}
export function splitWorkflowRequest(value, config) {
  return {text: String(value ?? '').trim(), selector: ''};
}

function normalizeTargets(value) {
  return (Array.isArray(value)?value:[]).slice(0,16).map(t=>({nodeId:clip(t?.nodeId,100),fieldName:clip(t?.fieldName,100)})).filter(t=>t.nodeId&&t.fieldName&&!/api.?key|password|secret|token/i.test(t.fieldName));
}
function normalizeDiscovery(value) {
  if(!value||value.version!==1||!/^\d{1,30}$/.test(String(value.targetId||'')))return null;
  const safeField=field=>{const type=clip(field.type,30).toUpperCase(),numeric=/^(NUMBER|INT|FLOAT|DOUBLE|INTEGER)$/.test(type);return{nodeId:clip(field.nodeId,100),fieldName:clip(field.fieldName,100),label:clip(field.label,160),nodeName:clip(field.nodeName,100),type:numeric?'NUMBER':type==='COMBO'?'LIST':type,value:typeof field.value==='boolean'||typeof field.value==='number'?field.value:nodeText(field.value),required:field.required===true,integer:field.integer===true,...(Number.isFinite(field.min)?{min:field.min}:{}),...(Number.isFinite(field.max)?{max:field.max}:{}),options:(numeric||/^(IMAGE|AUDIO|VIDEO|STRING)$/.test(type)?[]:Array.isArray(field.options)?field.options:[]).slice(0,40).map(o=>({value:clip(o.value,200),label:clip(o.label,150)}))};};
  return{version:1,contractRevision:clip(value.contractRevision,80),submitProtocol:value.submitProtocol==='legacy'?'legacy':'v2',source:value.source==='request-example'?'request-example':'metadata',modelEvidence:promptModelEvidence([],Array.isArray(value.modelEvidence)?value.modelEvidence:[]),prefixTargets:normalizeTargets(value.prefixTargets),targetId:String(value.targetId),mode:value.mode==='app'?'app':'workflow',title:clip(value.title,100),checkedAt:Number(value.checkedAt)||0,status:clip(value.status,30),message:clip(value.message,200),promptTargets:normalizeTargets(value.promptTargets),negativeTargets:normalizeTargets(value.negativeTargets),reference:clip(value.reference,900),negativeReference:clip(value.negativeReference,600),
    fields:(Array.isArray(value.fields)?value.fields:[]).slice(0,300).filter(f=>f&&f.nodeId&&f.fieldName&&!/api.?key|password|secret|token/i.test(f.fieldName)).map(safeField),requiredFields:(Array.isArray(value.requiredFields)?value.requiredFields:[]).slice(0,40).map(safeField),choices:(Array.isArray(value.choices)?value.choices:[]).slice(0,30).map(c=>({nodeId:clip(c.nodeId,100),fieldName:clip(c.fieldName,100),label:clip(c.label,160),targets:normalizeTargets(c.targets)}))};
}

// Older metadata parsing mistook the schema's type token for a selectable value.
// Repair only that exact token; never replace a user's valid numeric override.
function repairedNodeValue(item,discovery){
  const value=item?.fieldValue,field=discovery?.fields.find(f=>f.nodeId===String(item?.nodeId)&&f.fieldName===item?.fieldName);
  if(field?.type==='NUMBER'&&/^(INT|FLOAT|DOUBLE|INTEGER|NUMBER)$/.test(String(value))&&String(field.value??'').trim()&&Number.isFinite(Number(field.value)))return field.value;
  return typeof value==='number'||typeof value==='boolean'?value:nodeText(value);
}

function nodeText(value){return String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,2000);}
