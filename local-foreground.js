export function createForegroundPriority({now=()=>Date.now(),quietMs=120000}={}){
 let last=0;const foreground=new Set(),background=new Set();
 function reserve(){last=now();for(const c of background)c.abort(Object.assign(Error('QQ 请求优先，后台任务稍后重试'),{code:'LOCAL_ANALYSIS_DEFERRED'}));}
 return {
  reserve,
  enter(){reserve();const id={};foreground.add(id);return()=>{foreground.delete(id);last=now();};},
  beginBackground(controller){if(foreground.size||last&&now()-last<quietMs)throw Object.assign(Error('QQ 请求优先，后台任务等待空闲'),{code:'LOCAL_ANALYSIS_DEFERRED'});background.add(controller);return()=>background.delete(controller);},
  snapshot:()=>({foreground:foreground.size,background:background.size,lastForegroundAt:last,quietMs})
 };
}
