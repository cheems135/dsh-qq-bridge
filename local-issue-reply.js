function issueReplyBase(error,{kind='',partial=false}={}){
 const value=String(error?.message||error||'')+' '+String(error?.code||error?.cause?.code||'');
 const subject=kind==='image'?'这张图':['speech','voice'].includes(kind)?'这段语音':kind==='video'?'这段视频':'这句回复';
 if(/SCHEDULE_TOOL_PAUSED|当前日程.*失败|这个时段先停下/.test(value))return '这个工具在这段日程里已经失败四次了，我先停用它，下个日程需要时再试。';
 if(/SEARCH_UNRELATED/.test(value))return '搜出来的页面没对上你给的词，我还不能确定它的意思，不能拿别的内容糊弄你。';
 if(/JSON|工具调用参数|工具格式|协议错误|参数.*(?:错误|缺少|无效)/i.test(value))return '我刚才给工具的调用格式没写对，这次没执行成功。';
 if(/401|unauthorized|鉴权|身份验证|密钥无效/i.test(value))return `${subject}这次没做成，账号或密钥验证没通过。`;
 if(/403|forbidden|无权限|权限不足/i.test(value))return `${subject}这次没拿到结果，那边拒绝了当前账号的访问。`;
 if(/429|限流|rate.?limit/i.test(value))return `${subject}这次没拿到结果，服务暂时限制了请求频率。先等它恢复，避免反复提交。`;
 if(/ECONNREFUSED|未连接到本地网关|没在运行|未运行/.test(value))return '我这边暂时连不上本地服务了。把本地窗口启动起来，再叫我一声就好。';
 if(/context|上下文|token.{0,15}(?:exceed|limit)|超出.{0,8}容量/i.test(value))return '这次要参考的内容有点多，整理后还是没装下。原消息还在，我先不让你重发。';
 if(/out of memory|显存|cuda.*memory|allocat.*memory/i.test(value))return `${subject}这次没能完成，本地内存或显存有些吃紧。等其他生成任务结束后再试试吧。`;
 if(/timeout|timed out|超时|等待太久|等待超时/i.test(value))return `${subject}等得有点久，这次超时了，还不能确认最终结果。我先不重发，免得重复做一遍。`;
 if(/繁忙|排队|队列|queue|busy|503/i.test(value))return '前面的任务还没忙完，我这次没能开始。等它空下来再试吧。';
 if(/fetch failed|ECONNRESET|断开|连接中断|连接断|响应中断/i.test(value))return `${subject}${partial?'后半段':'刚才'}没能接上，连接中途断了。我先核对，再决定要不要重试，免得重复做一遍。`;
 if(/没有配置|没有.*工作流|找不到.*工作流|请选择.*工作流|未暴露该工具|没.*映射|不存在.*节点|节点.*不存在|未识别|缺少.*节点/.test(value))return `${subject}还差一点本地配置，暂时没法完成。`;
 return `${subject}${partial?'后半段':'刚才'}没做成，返回的信息还不够，我暂时说不准卡在哪里。`;
}
export function localIssueReply(error,options={}){
 let reply=issueReplyBase(error,options);
 if(options.backend==='api')reply=reply.replaceAll('本地服务','模型服务').replaceAll('本地窗口','连接面板').replaceAll('本地连接','服务连接').replaceAll('本地配置','连接配置');
 return reply.trim();
}
