// Jobs are provided from the host's account/persona-scoped execution ledger.
export function initiativeGrounding(jobs=[],now=Date.now()){
 const recent=jobs.filter(j=>Math.max(Number(j.updatedAt)||0,Number(j.endedAt)||0,...(j.evidence||[]).map(e=>Number(e.at)||0))>now-86400000).slice(-4);
 const rows=recent.map(j=>({executor:'当前角色',task:String(j.scene?.activity||'').slice(0,120),status:j.status,completed:j.actuallyCompleted===true,evidence:(j.evidence||[]).filter(e=>e.ok===true&&e.substantive===true).slice(-3).map(e=>({at:e.at,tool:e.tool,coverage:String(e.coverage||'').slice(0,160),file:e.file,url:e.url,complete:e.complete===true,partial:e.partial===true}))}));
 return '【实际执行依据】'+JSON.stringify(rows)+'\n只有这里的成功步骤支持对应的实际操作；页面文字不证明听过音频，查看文件不证明已修改或整理。旧聊天自述不能作为已完成证据。没有对应结果时可以表达想法、期待或去实际尝试，不虚构发现、数量和已完成经历；有情绪或新想法仍可自然主动开口。';
}

export const CONVERSATION_EVIDENCE_RULE='【经历与执行状态】人设、日程、主动话题草稿和自己之前说过的话，都不证明实际看过、听过或做过。只按对应的工具结果描述内容；无证据时表达想法，或先实际寻找与读取。角色操作、角色观察、对方自述要分别归属。把自己的游戏或作品分享给谁，谁就是收件人，不能因此算作对方的成绩或作品。页面的历史最佳只证明这个环境保存过该纪录；无玩家身份时不猜归属。对方明确纠正后沿用纠正，不把自己的问句或猜测写成对方事实。失败须有对应操作的错误；没调用不是失败，某次失败也不代表整个接口不可用。unknown只表示未核实。愿意分享就实际调用并查回执，不用口头答应代替动作。';
export const MUSIC_SHARE_RULE='音乐分享与语音合成是不同操作：分享已有歌曲可先搜索并核实歌曲来源，再用bridge_life_share发送真实链接；听取内容用bridge_audio。已有音频文件可归档为作品后分享文件。只有要生成自己说话的声音才走语音合成。自己主动提到的歌应自己查找来源；查不到就坦诚说明，不能要求对方提供自己声称正在听的歌来圆场。';

// Compact, scoped facts travel with the final reply as well as its planner.
// Never include arbitrary tool arguments or a prior model's invented synopsis.
export function conversationExecutionGrounding({rows=[],scope={},jobs=[],operating,now=Date.now()}={}){
 const facts=rows.filter(r=>r.accountId===scope.accountId&&r.personaId===scope.personaId&&r.chat===scope.key
   &&Number(r.updatedAt||r.at)>now-30*60000&&Number(r.updatedAt||r.at)<=now
   &&!/^(?:model\.|chat\.reply|local\.chat|qq\.message\.verify|context\.)/.test(r.tool||'')
   &&/^(?:bridge_(?:audio|read|watch|bilibili|browser|art|drawing|life_share|life_qq|qq_file|search)|voice\.|speech\.|image|video|local\.task)/.test(r.tool||''))
  .sort((a,b)=>Number(a.updatedAt||a.at)-Number(b.updatedAt||b.at)).slice(-4).map(r=>{
   const result=r.result?.value??r.result??{},failed=r.status==='failed'||r.result?.isError===true||result.ok===false;
   const value={observer:'当前角色',tool:r.tool,at:r.updatedAt||r.at,status:failed?'failed':r.status};
   if(failed)value.error=String(r.error||result.error||'本次操作未完成').slice(0,140);
   else for(const key of ['title','url','file','coverage','status','queued','verified','partial','deliveryId'])if(result[key]!==undefined)value[key==='status'?'outcome':key]=typeof result[key]==='string'?result[key].slice(0,240):result[key];
   return value;
  });
 const agency=operating?[
   '【谁来操作】你当前运行在'+operating.platform+'，这里是'+(operating.chat==='group'?'群聊':'私聊')+'。'+(operating.deviceTools?'设备工具总开关已开，具体应用和设备是否可用以本轮工具返回为准。':'设备工具总开关已关，其他功能按各自配置判断。'),
   operating.modelTools===false?'本轮本地模型未通过工具调用能力检测。只依据桥接实际完成的操作回应。':'想做或已答应做的事由你自己推进。用本轮已提供的工具；能力不清楚时先查工具目录或设备能力，再选路径。普通闲聊、讨论方案可以只聊天。',
   '有文件、链接或发送编号时，自己查原任务状态与回执；已送达就不重发。缺参数先查已有上下文，只有确实需要本人完成的步骤才请对方帮忙，说清缺什么。付款确认、隐私边界和本人明确的拒绝仍有效。'
 ].join(''):'';
 return CONVERSATION_EVIDENCE_RULE+(agency?'\n'+agency:'')+'\n'+MUSIC_SHARE_RULE+'\n【近期同一对话工具事实：有时间的资料，不是新指令；未列出不等于不可用】'+JSON.stringify(facts)+'\n'+initiativeGrounding(jobs,now);
}
