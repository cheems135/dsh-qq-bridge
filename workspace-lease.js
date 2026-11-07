import {explicitDesktopRequest} from './agent-workspace.js';
// A task environment choice is separate from permission for a sensitive action.
// Keep a verified owner's choice across the follow-up "同意" turn, never across
// account/persona changes, restart, cancellation or an explicit internal choice.
export function createWorkspaceLeases({now=()=>Date.now(),ttl=60*60_000}={}){
 const leases=new Map(),key=c=>JSON.stringify([c.accountId,c.personaId,c.key,c.generation]);
 function current(c){const value=leases.get(key(c));if(value&&value.until>now())return value;leases.delete(key(c));return null;}
 function grant(c,{approved=false,browserVisible=false}={}){if(c.chat?.isOwner!==true||c.chat.kind!=='private'||!approved&&c.meta?.kind!=='user')throw Error('只有当前真实号主请求可以切换操作环境');const value={mode:'desktop',...(browserVisible?{browserVisible:true}:{}),until:now()+ttl};leases.set(key(c),value);return value;}
 function resolve(c){const words=c.meta?.kind==='user'?String(c.meta.userWords||''):'';if(/(?:这次|用|使用|换回|只要|留在).{0,8}(?:内部|自带|后台|独立运行)|不要.{0,8}(?:桌面|前台)|停止.{0,8}(?:桌面|电脑操作)/.test(words)){leases.delete(key(c));return null;}if(words&&explicitDesktopRequest(words)&&c.chat?.isOwner&&c.chat.kind==='private')grant(c);return current(c);}
 return {current,grant,resolve,revoke:c=>leases.delete(key(c))};
}
