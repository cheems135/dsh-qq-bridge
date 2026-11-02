import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const psQuote=s=>"'"+String(s).replaceAll("'","''")+"'";
const desktopDelegations=new WeakMap();
/** Only a fixed helper invocation created inside this module can be delegated.
 * Models cannot mint this parent identity by copying a callId or description. */
export function nativeDesktopDelegation(exec){
 const parent=exec?.parent;if(!parent||typeof parent!=='object')return null;
 const item=desktopDelegations.get(parent)?.get(String(exec.arguments?.command||''));
 if(!item||exec.name!=='pwsh'||item.agent!==exec.agent||item.expiresAt<Date.now()||item.execution&&item.execution!==exec)return null;
 item.execution=exec;return {input:{...item.input},parent,createdAt:item.createdAt};
}
/** Invoke the DSH registry with the original agent and guard/approval chain. */
export function createNativeDesktop({getTools,getAgent}){
 return async(input,context)=>{
  const tools=getTools(),agent=getAgent(context.sessionId);
  if(!tools?.execute||!agent||!tools.schemas(agent).some(t=>t.name==='pwsh'))return null;
  const data=Buffer.from(JSON.stringify(input),'utf8').toString('base64'),script=fileURLToPath(new URL('./tools/desktop-action.ps1',import.meta.url));
  const command="[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+data+"')) | & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "+psQuote(script);
  const parent=context.exec||{agent,kind:'local-desktop-internal'},delegations=desktopDelegations.get(parent)||new Map();desktopDelegations.set(parent,delegations);
  const item={agent,input:{...input},createdAt:Date.now(),expiresAt:Date.now()+45000};delegations.set(command,item);
  let result;try{result=await tools.execute({name:'pwsh',arguments:{command,description:'Observe or operate the desktop through DSH',timeout_ms:40000},agent,signal:context.signal||new AbortController().signal,parent,callId:'bridge-desktop-'+randomUUID()});}finally{delegations.delete(command);if(!delegations.size)desktopDelegations.delete(parent);}
  if(result.isError)throw Error('DSH原生桌面工具执行失败：'+String(result.content?.find(c=>c.type==='text')?.text||'权限或执行错误').slice(0,300));
  const value=result.value||{},stdout=typeof value.stdout==='string'?value.stdout:value.stdout?.text;
  if(value.exitCode!==undefined&&value.exitCode!==0)throw Error('DSH桌面命令未成功结束：'+String(value.stderr?.text||'exit '+value.exitCode).slice(0,200));
  let text=stdout||result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')||'';
  // Native pwsh also renders its exit metadata as text; parse only the JSON line.
  const line=text.split(/\r?\n/).find(line=>line.trim().startsWith('{'));
  try{return {...JSON.parse(line||text),backend:'dsh-native-pwsh',nativeTool:'pwsh'};}catch{throw Error('DSH桌面工具没有返回有效屏幕或窗口信息');}
 };
}
