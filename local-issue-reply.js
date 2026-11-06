export function localIssueReply(error,{kind='',partial=false}={}){
 const value=String(error?.message||error||'')+' '+String(error?.code||error?.cause?.code||'');
 const subject=kind==='image'?'这张图':kind==='speech'?'这段语音':kind==='video'?'这段视频':'这句回复';
 if(/ECONNREFUSED|未连接到本地网关|没在运行|未运行/.test(value))return '我这边暂时连不上本地服务了。把本地窗口启动起来，再叫我一声就好。';
 if(/context|上下文|token.{0,15}(?:exceed|limit)|超出.{0,8}容量/i.test(value))return '这次要参考的内容有点多，整理后还是没装下。较长的内容分几条发给我吧，我接着看。';
 if(/out of memory|显存|cuda.*memory|allocat.*memory/i.test(value))return `${subject}这次没能完成，本地内存或显存有些吃紧。等其他生成任务结束后再试试吧。`;
 if(/timeout|timed out|超时|等待太久|等待超时/i.test(value))return `${subject}等得有点久，还没拿到完整结果。可以看看本地窗口是不是还有任务排队，稍后再试一下。`;
 if(/繁忙|排队|队列|queue|busy|503/i.test(value))return '前面还有任务在忙，我这边暂时没轮到。等它空下来，再试一下就好。';
 if(/fetch failed|ECONNRESET|断开|连接中断|连接断|响应中断/i.test(value))return `${subject}${partial?'后半段':'刚才'}没能接上，本地连接中途断了。等服务恢复后再试一下吧。`;
 if(/没有配置|没有.*工作流|找不到.*工作流|未暴露该工具|没.*映射|不存在.*节点|节点.*不存在|未识别|缺少.*节点/.test(value))return `${subject}还差一点本地配置，暂时没法完成。到本地窗口检查一下对应的模型或工作流吧。`;
 return `${subject}${partial?'后半段':'刚才'}出了点状况，没能完整接上。可以在本地窗口看一下具体原因，稍后再试试。`;
}
