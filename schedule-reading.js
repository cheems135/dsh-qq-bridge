// Reading experience is supported by content returned for this task, never by
// a schedule status, a model's narrative, or a successful discovery tool alone.
const metadataTool=/^(?:bridge_)?(?:tools|capabilities|search|task|life_(?:adjust|checkpoint|finish|qq|request)|qq_(?:read|profile|api))$/i;
const contentTool=/(?:read|browser|website|watch|audio|listen|screen|device|native)/i;
export const SCHEDULE_READING_RULE='【日程阅读事实】日程的 activity、status、actual、计划、标题、工具发现和你自己的历史说法都不能证明已经阅读。只有本任务实际内容证据才支持“我刚看到/读到/听到”；没有证据时可表达想去看、好奇或一般知识，不可编曾经看到某篇文章。部分内容只能说实际覆盖部分，不能说全文或整片已看完。工具返回证据不足时先实际读取或改写为真实意图，不重复发送被拒的草稿。';
function readingItems(job={}){return (Array.isArray(job.evidence)?job.evidence:[]).filter(e=>e?.ok===true&&e.substantive===true&&!metadataTool.test(String(e.tool||e.kind||''))&&contentTool.test(String(e.tool||e.kind||''))&&String(e.coverage||e.body||e.excerpt||'').trim()&&!/(?:没有|尚未|未)(?:读取|阅读|读到|取得).{0,3}(?:正文|具体内容)|^(?:只有|仅|只取得|只读到)?(?:搜索结果|标题列表|推荐首页|首页|导航)/.test(String(e.coverage||'')));}
export function schedulePromptEvidence(job={},limit=6){const all=Array.isArray(job.evidence)?job.evidence:[],recent=all.slice(-limit),read=readingItems(job).at(-1);if(read&&!recent.includes(read))recent[0]=read;return recent;}
export function scheduleReadingEvidence(job={}){
 const evidence=readingItems(job);
 const complete=evidence.filter(e=>!e.partial&&e.complete!==false&&e.fullViewed!==false&&!/(?:未|没|不)(?:读完|看完|听完)|只(?:看到|读到|听到)|仅(?:当前|首个|部分)|片段|预览|未证明|不代表.{0,8}(?:完整|全部|全文)/.test(String(e.coverage||''))&&(e.complete===true||e.fullViewed===true||/(?:已(?:实际)?(?:读完|看完|听完)全文|已读取全文|完整正文已读取)/.test(String(e.coverage||''))));
 return {observed:evidence.length>0,complete:complete.length>0,sources:evidence.slice(-6).map(e=>({tool:e.tool||e.kind,url:e.url||'',coverage:String(e.coverage||e.body||e.excerpt).slice(0,900),complete:complete.includes(e)}))};
}
function clauses(value){
 // Remove explicitly attributed quotations, not quotation marks around a whole
 // self-authored reply; those must not be a way around the assertion check.
 return String(value||'').replace(/(?:你|对方|他|她|用户)(?:刚才|刚|曾经|之前)?(?:说|写|问|提到)[：:]?\s*[“「『"][^”」』"]*[”」』"]/g,'').split(/[，,。！？!?；;\n]/).map(v=>v.trim()).filter(Boolean);
}
function asserted(clause){
 if(/(?:不是没|并非没|不能说没).{0,6}(?:看|读|听|浏览)/.test(clause))return true;
 if(/(?:还没|尚未|没有|没|未曾|不曾|从没|打算|准备|计划|想要|想去|想再|希望|待会|等会|稍后|明天|如果|假如).{0,12}(?:看|读|听|浏览)/.test(clause))return false;
 if(/^(?:你|他|她|对方|作者|用户)/.test(clause))return false;
 if(/\bI\s+(?:want|plan|hope|will|haven['’]?t|didn['’]?t|have not|did not)\b/i.test(clause))return false;
 return /(?:我(?:刚刚|刚|才|已经|曾经|之前|今天|现在|方才)?|刚刚|刚才|刚|已经|才|方才|^)(?:[^，,。！？!?；;\n]{0,10}?)(?:看(?:到|见|了|过|完)|读(?:到|了|过|完)|听(?:到|了|过|完)|浏览(?:了|过|完)|刷(?:到|了|过)|翻(?:到|了|过))/.test(clause)||/(?:这|那)(?:篇|个|条|本)?(?:文章|网页|视频|书)(?:里|中)?(?:说|写|讲)|(?:文章|网页|视频)(?:里|中)(?:说|写|讲|提到)/.test(clause)||/\bI(?:['’]ve|\s+have)?\s+(?:just\s+)?(?:read|saw|seen|watched|heard|listened|was reading|finished reading)\b/i.test(clause);
}
export function unsupportedScheduleReading(value,job={}){
 const proof=scheduleReadingEvidence(job);
 for(const clause of clauses(value)){
  if(!asserted(clause))continue;
  if(!proof.observed)return {reason:'missing_reading_evidence',clause};
  if(!proof.complete&&/(?:读完|看完|听完|浏览完|整篇|全文|全片|全部看完|完整看完)|\b(?:finished reading|entire|whole)\b/i.test(clause))return {reason:'partial_reading_evidence',clause};
 }
 return null;
}
export function assertScheduleReading(value,job={}){
 const invalid=unsupportedScheduleReading(value,job);if(!invalid)return value;
 throw Object.assign(Error(invalid.reason==='partial_reading_evidence'?'本任务只取得部分内容，不能声称全文或整片已读完；请只分享实际覆盖的部分。':'本任务没有实际阅读内容证据，不能声称刚看到、读过或听过；请先实际读取，或按当前人设表达想去看、好奇，不重发这条草稿。'),{code:'SCHEDULE_READING_EVIDENCE_REQUIRED',reason:invalid.reason});
}
