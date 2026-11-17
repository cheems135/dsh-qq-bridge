(function(global){
 'use strict';
 let nativeHosted=false,dismissed=null;
 let config=null,host=null,view=null,pip=null,session=null,timer=null,expanded=false,forced=false,recording=null,hold=null,transcribing=false,notice='',inputEpoch=0,refreshCounter=0;
 const topPip=()=>{try{return global.top.documentPictureInPicture||global.documentPictureInPicture;}catch{return global.documentPictureInPicture;}};
 const node=(tag,attrs={},text)=>{const el=document.createElement(tag);Object.assign(el,attrs);if(text!==undefined)el.textContent=text;return el;};
 const by=id=>view?.getElementById(id);
 function message(text){notice=String(text||'');if(by('note'))by('note').textContent=notice;}
 function mount(){
  if(host)return;
  host=node('div',{id:'dsh-companion-float'});host.style.cssText='position:fixed;right:16px;bottom:18px;z-index:2147483000;max-width:calc(100vw - 24px)';
  view=host.attachShadow({mode:'open'});view.innerHTML="<style>:host{font:14px/1.55 \"Microsoft YaHei UI\",system-ui,sans-serif;color:#233d52}*{box-sizing:border-box}.box{width:min(352px,calc(100vw - 24px));max-height:calc(100dvh - 24px);background:#f4f8fc;border:1px solid #c5daeb;border-radius:22px;box-shadow:0 12px 40px #233d5226;display:flex;flex-direction:column;overflow:hidden}button,textarea{font:inherit}button{min-height:40px;border:1px solid #c5daeb;border-radius:11px;background:#fff;color:#355970;cursor:pointer;padding:8px 12px;touch-action:none}button:hover{background:#e5f1fb}button:focus-visible,textarea:focus-visible{outline:3px solid #2d6fa8;outline-offset:2px}button:disabled{opacity:.55;cursor:default}.head{display:flex;align-items:center;gap:8px;padding:12px}.surface{position:relative;flex:none;width:44px;height:44px;min-height:0;padding:0;border-radius:50%;border:1px solid #9dc5e2;background:#e5f1fb;user-select:none;color:#478fcb}.surface svg{width:100%;height:100%;display:block}.dot{position:absolute;right:2px;top:2px;width:10px;height:10px;background:#98a9b8;border:2px solid white;border-radius:50%}.heading{flex:1;min-width:0}.heading b{font-size:16px;display:block}.heading small{font-size:12px;color:#526a80}.icon{width:40px;padding:0;font-size:21px}.body{padding:0 14px 14px;overflow:auto;min-height:0}.state{font-size:14px;font-weight:600;margin-bottom:4px}.source{overflow-wrap:anywhere;color:#526a80;font-size:12px;margin:2px 0 5px}.history{max-height:180px;min-height:90px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;margin:12px 0;background:#fff;border:1px solid #d7e5f0;border-radius:14px;padding:10px}.entry{padding:10px;border-radius:10px;margin-bottom:8px;background:#f4f8fc}.entry:last-child{margin:0}.entry.user{background:#e5f1fb}.empty{color:#526a80;text-align:center;padding:12px 4px}textarea{resize:vertical;min-height:76px;width:100%;max-width:100%;border:1px solid #b8cfe2;border-radius:12px;background:white;padding:10px;margin:0}.row{display:flex;gap:8px;margin-top:8px}.row button{flex:1}.primary{background:#2d6fa8;color:white;border-color:#2d6fa8}.primary:hover{background:#255e90}.danger{color:#a6373b}.secondary{margin-top:12px;padding-top:12px;border-top:1px solid #d7e5f0}.secondary button{font-size:12px;padding:6px}.note{color:#526a80;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px}.compact{width:64px;height:64px;border:0;background:transparent;border-radius:50%;box-shadow:0 5px 20px #233d5226;overflow:visible}.compact .head{padding:0}.compact .surface{width:64px;height:64px}.compact .dot{width:13px;height:13px;right:4px;top:4px}.compact .heading,.compact .icon{display:none}[hidden]{display:none!important}@media(prefers-reduced-motion:no-preference){button{transition:background .12s ease}}</style><section class=\"box compact\" role=\"region\" aria-label=\"屏幕陪伴\"><div class=\"head\"><button id=\"surface\" class=\"surface\" title=\"点击展开 · 拖动移动 · 长按说话\" aria-label=\"陪伴悬浮球，点击展开，方向键移动\" aria-expanded=\"false\"><svg viewBox=\"0 0 64 64\" aria-hidden=\"true\"><path d=\"M13 35C13 25 26 20 37 26C44 30 47 28 54 24C55 32 50 39 43 42C41 51 31 53 27 46C18 45 13 42 13 35Z\" fill=\"currentColor\"/><circle cx=\"23\" cy=\"32\" r=\"2\" fill=\"#233d52\"/></svg><span id=\"dot\" class=\"dot\"></span></button><div class=\"heading\"><b>陪你看</b><small>同一个画面，一起看</small></div><button id=\"fold\" class=\"icon\" title=\"收起为悬浮球\" aria-label=\"收起为悬浮球\">−</button><button id=\"close\" class=\"icon\" title=\"关闭并停止识屏\" aria-label=\"关闭并停止识屏\">×</button></div><div id=\"body\" class=\"body\" hidden><div id=\"state\" class=\"state\" role=\"status\">尚未开始</div><div id=\"source\" class=\"source\"></div><div id=\"history\" class=\"history\" aria-live=\"polite\"></div><textarea id=\"draft\" maxlength=\"2000\" aria-label=\"和她说点什么\" placeholder=\"和她说点什么… Ctrl+Enter 发送\"></textarea><div class=\"row\"><button id=\"mic\">按住说话</button><button id=\"send\" class=\"primary\">发送</button></div><div class=\"row\"><button id=\"pause\">暂停陪看</button><button id=\"resume\">继续陪看</button><button id=\"stop\" class=\"danger\">结束</button></div><div id=\"note\" class=\"note\" role=\"status\"></div><div class=\"row secondary\"><button id=\"pin\">桌面悬浮球</button><button id=\"reset\">回到右下角</button></div><div id=\"last\" class=\"source\"></div></div></section>";
  document.body.append(host);
  by('pin').onclick=()=>{void openPinned();};by('fold').onclick=()=>setExpanded(!expanded);
  by('close').onclick=()=>{void close();};by('reset').onclick=()=>{host.style.left=host.style.top='auto';host.style.right='16px';host.style.bottom='18px';setExpanded(false);};
  by('send').onclick=()=>{void send();};by('draft').onkeydown=e=>{if(e.key==='Enter'&&e.ctrlKey&&!e.isComposing){e.preventDefault();void send();}};
  ['pause','resume','stop'].forEach(action=>by(action).onclick=()=>{void control(action);});
  bindHold(by('surface'),true);bindHold(by('mic'),false);
  host.addEventListener('keydown',e=>{if(e.key==='Escape'){if(recording||transcribing)void stopRecording(true);else setExpanded(false);}if(view.activeElement===by('surface')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const r=host.getBoundingClientRect();host.style.left=(r.left+(e.key==='ArrowLeft'?-12:e.key==='ArrowRight'?12:0))+'px';host.style.top=(r.top+(e.key==='ArrowUp'?-12:e.key==='ArrowDown'?12:0))+'px';host.style.right=host.style.bottom='auto';clamp();}});
  by('pin').textContent=config?.device==='desktop'?'桌面悬浮球':topPip()?.requestWindow?'置顶':'置顶说明';
 }
 function clamp(){if(!host||pip)return;const v=global.visualViewport,x=v?.offsetLeft||0,y=v?.offsetTop||0,w=v?.width||global.innerWidth,h=v?.height||global.innerHeight;const r=host.getBoundingClientRect();if(host.style.left!=='auto'&&host.style.left){host.style.left=Math.max(x+8,Math.min(r.left,x+w-r.width-8))+'px';host.style.top=Math.max(y+8,Math.min(r.top,y+h-r.height-8))+'px';}view.querySelector('.box').style.maxHeight=Math.max(64,h-24)+'px';}
 function setExpanded(value){expanded=value;by('body').hidden=!value;view.querySelector('.box').classList.toggle('compact',!value);by('surface').setAttribute('aria-expanded',String(value));if(value)by('draft').focus();else by('surface').focus();if(pip)try{pip.resizeTo(376,value?510:90);}catch{}layoutMobile();clamp();}
 async function close(){if(session&&['running','paused','error'].includes(session.status)&&!await control('stop'))return;await stopRecording(true);dismissed=session?.id||'*';forced=false;setExpanded(false);render();}
 function layoutMobile(){if(!host||config?.device!=='phone')return;by('pin').hidden=true;const viewport=global.visualViewport,height=viewport?.height||global.innerHeight,box=view.querySelector('.box');box.style.maxHeight=Math.max(100,height-132)+'px';box.style.overflow='auto';host.style.left='12px';host.style.right='auto';host.style.bottom='auto';host.style.top=Math.max((viewport?.offsetTop||0)+8,(viewport?.offsetTop||0)+height-host.offsetHeight-108)+'px';}
 function render(){
  if(!host)return;if(config?.device==='desktop'&&nativeHosted){host.style.display='none';return;}host.style.display=forced||(session&&dismissed!==session.id)?'':'none';
  const states={paused:'已暂停',stopped:'已结束',ended:'播放已结束',error:'已因错误暂停'};
  let text='尚未开始',color='#98a9b8';
  if(session){text=states[session.status]||'等待画面';if(session.status==='running'){color='#57a879';text=session.priorityWait?'聊天优先，陪看稍候':!session.observedAt?'等待画面接入':Date.now()-session.observedAt>10000?'画面暂未更新':session.analyzing?'正在理解画面':'正在陪你看';}}
  if(recording)text='正在听你说 · '+Math.floor((Date.now()-recording.startedAt)/1000)+'秒';else if(transcribing)text='正在转成文字…';
  by('state').textContent=text;by('surface').setAttribute('aria-label',text+'，点击展开，方向键移动');by('dot').style.background=session?.status==='error'?'#b67532':color;by('pause').hidden=session?.status!=='running';by('resume').hidden=!['paused','error'].includes(session?.status);by('stop').hidden=!session||['stopped','ended'].includes(session.status);
  by('source').textContent=session?.sourceLabel||session?.url||'尚未选择观察来源';
  by('last').textContent=session?.observedAt?'最近取图 '+new Date(session.observedAt).toLocaleTimeString()+' · 已分析 '+session.analyses+' 次，互动 '+session.reactions+' 次':'尚未收到真实画面';
  const history=by('history');history.replaceChildren();for(const item of session?.messages||[]){const el=node('div',{className:'entry '+(item.role==='user'?'user':'')},(item.role==='user'?'你：':'她：')+item.text+(item.state==='queued'?'（待回复）':''));history.append(el);}if(!history.children.length)history.append(node('div',{className:'empty'},'一起看见的，慢慢聊\n开始后可以打字或按住说话'));history.scrollTop=history.scrollHeight;
  if(session?.error)message(session.error);else by('note').textContent=notice;layoutMobile();clamp();
 }
 async function refresh(){
  if(!config)return;
  const sequence=++refreshCounter;try{const key=config.getKey(),data=await config.api('GET','/im-bridge/visual-session');if(sequence!==refreshCounter||key!==config.getKey())return;const next=(data.sessions||[]).find(s=>s.key===key)||null;if(session&&session.id!==next?.id){await stopRecording(true);by('draft').value='';notice='会话已切换，输入框已清空';}session=next;render();}catch(error){message('状态暂时没连上：'+error.message);if(by('state'))by('state').textContent='连接中断，状态待核实';}
 }
 async function send(){
  if(by('send').disabled)return;const text=by('draft').value.trim();if(!text)return;
  if(!session||session.key!==config.getKey()||session.status!=='running'){message('先开始或继续陪伴，再和她说话');return;}
  const draft=by('draft'),button=by('send'),sessionId=session.id;button.disabled=true;
  try{await config.api('POST','/im-bridge/visual-session',{action:'input',key:session.key,id:session.id,text});if(session?.id===sessionId&&draft.value.trim()===text)draft.value='';message('已提交，等她结合画面回你');await refresh();}catch(e){message(e.message);}finally{button.disabled=false;}
 }
 async function control(action){
  if(!session){message('当前没有陪伴会话');return false;}
  if(action==='resume'&&session.target==='shared'){message('暂停已释放共享；请回到面板重新选择画面继续');return false;}
  if(action!=='resume'){await stopRecording(true);await global.DSHVisualShare?.stop(false);}
  try{await config.api('POST','/im-bridge/visual-session',{key:session.key,id:session.id,action});message('');await refresh();return true;}catch(e){message(e.message);return false;}
 }
 async function openPinned(){
  mount();dismissed=null;forced=true;if(config?.device==='desktop'){try{const result=await config.api('POST','/im-bridge/visual-session',{action:'open-window',key:config.getKey()});nativeHosted=true;render();message('独立桌面悬浮球已打开，可离开插件继续使用');return result;}catch(e){nativeHosted=false;setExpanded(true);message('桌面悬浮球没有打开：'+e.message);render();return;}}if(config?.device==='phone'){setExpanded(true);render();return;}render();if(pip){pip.close();return;}
  const api=topPip();if(!api?.requestWindow){setExpanded(true);message('当前窗口不支持桌面置顶，请在 Microsoft Edge 打开本地面板：'+location.href);return;}
  try{
   pip=await api.requestWindow({width:370,height:400});pip.document.title='视听陪伴';pip.document.body.style.cssText='margin:0;background:#f1f8ff;';pip.document.body.append(host);host.style.cssText='position:static;display:block;max-width:100%';by('pin').textContent='回面板';by('surface').title='点击输入文字，长按说话；拖动窗口标题栏可移动';pip.addEventListener('blur',()=>{if(recording||hold)void stopRecording(true);});setExpanded(true);
   pip.addEventListener('pagehide',()=>{void stopRecording(true);pip=null;document.body.append(host);host.style.cssText='position:fixed;right:16px;bottom:18px;z-index:2147483000;max-width:calc(100vw - 24px)';by('pin').textContent='置顶';render();},{once:true});
  }catch(e){pip=null;setExpanded(true);message('置顶窗口没有打开：'+e.message+'。可点击置顶按钮重试，或在 Edge 打开面板');}
 }
 function bindHold(button,draggable){
  let press=null,suppress=false;
  button.addEventListener('contextmenu',e=>e.preventDefault());
  button.addEventListener('pointerdown',e=>{
   if(e.button!==0)return;button.setPointerCapture?.(e.pointerId);const bounds=host.getBoundingClientRect();press={x:e.clientX,y:e.clientY,left:bounds.left,top:bounds.top,moved:false,long:false};hold=press;
   press.timer=setTimeout(()=>{if(!press||press.moved)return;press.long=true;suppress=true;void startRecording(press);},450);
  });
  button.addEventListener('pointermove',e=>{if(!press||!draggable||pip)return;const dx=e.clientX-press.x,dy=e.clientY-press.y;if(Math.hypot(dx,dy)>8){press.moved=true;suppress=true;clearTimeout(press.timer);if(recording)void stopRecording(true);const width=global.innerWidth,height=global.innerHeight;host.style.left=Math.max(6,Math.min(width-host.offsetWidth-6,press.left+dx))+'px';host.style.top=Math.max(6,Math.min(height-host.offsetHeight-6,press.top+dy))+'px';host.style.right='auto';host.style.bottom='auto';}});
  function release(cancel){if(!press)return;clearTimeout(press.timer);press.released=true;if(press.long)void stopRecording(cancel);press=null;hold=null;}
  button.addEventListener('pointerup',()=>{release(false);setTimeout(()=>{suppress=false;},0);});button.addEventListener('pointercancel',()=>{release(true);suppress=false;});
  button.addEventListener('click',()=>{if(suppress){suppress=false;return;}if(draggable)setExpanded(!expanded);else{setExpanded(true);message('按住按钮说话，松开后转成可编辑文字');}});
 }
 async function startRecording(press){
  if(recording||transcribing)return;
  if(!session||session.key!==config.getKey()||session.status!=='running'){setExpanded(true);message('先开始或继续陪伴，再按住说话');return;}
  if(!navigator.mediaDevices?.getUserMedia||!global.MediaRecorder){setExpanded(true);message('当前窗口不支持录音，请在 Edge 打开面板，或直接输入文字');return;}
  const epoch=inputEpoch;let stream;try{
   setExpanded(true);message('正在等待麦克风许可…');stream=await navigator.mediaDevices.getUserMedia({audio:true});if(press.released||press.moved||epoch!==inputEpoch){stream.getTracks().forEach(t=>t.stop());message('录音已取消');return;}
   const recorder=new MediaRecorder(stream,{mimeType:'audio/webm'}),state={stream,recorder,chunks:[],key:session.key,id:session.id,startedAt:Date.now(),cancel:false,epoch};recording=state;
   recorder.ondataavailable=e=>{if(e.data.size)state.chunks.push(e.data);};recorder.onstop=()=>{void finishRecording(state);};recorder.onerror=()=>{state.cancel=true;void stopRecording(true);};recorder.start();state.timer=setTimeout(()=>{void stopRecording(false);},60000);setExpanded(true);message('松开后转文字，不会自动发送');render();
  }catch(e){stream?.getTracks().forEach(t=>t.stop());recording=null;setExpanded(true);message(e.name==='NotAllowedError'?'麦克风未获允许，仍可直接打字':'录音没能开始：'+e.message);render();}
 }
 async function stopRecording(cancel){if(cancel){inputEpoch++;if(hold)hold.released=true;}const state=recording;if(!state)return;recording=null;state.cancel=cancel===true;clearTimeout(state.timer);try{if(state.recorder.state!=='inactive')state.recorder.stop();}finally{state.stream.getTracks().forEach(t=>t.stop());}render();}
 async function finishRecording(state){
  if(state.cancel){message('已取消录音');return;}
  if(Date.now()-state.startedAt<250){message('录音太短了，按住后说完再松开');return;}
  const blob=new Blob(state.chunks,{type:'audio/webm'});if(!blob.size){message('没有取得录音内容');return;}
  transcribing=true;render();
  try{const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));const value=await config.api('POST','/im-bridge/visual-session',{key:state.key,id:state.id,action:'transcribe',audio:{data:btoa(binary),mediaType:'audio/webm'}});if(state.epoch!==inputEpoch||!session||session.id!==state.id||session.status!=='running')throw Error('陪伴会话已切换，未填入旧录音');const draft=by('draft');draft.value=(draft.value?draft.value+'\n':'')+value.text;setExpanded(true);message('已转成文字，可以修改后再发送');}catch(e){message(e.message);}finally{transcribing=false;render();}
 }
 global.addEventListener('blur',()=>{if(recording||hold)void stopRecording(true);});
 global.visualViewport?.addEventListener('resize',()=>{render();clamp();});global.addEventListener('resize',clamp);
 global.addEventListener('pagehide',()=>{clearInterval(timer);void stopRecording(true);pip?.close();});
 global.DSHCompanionFloat={configure(value){config=value;if(config.device==='desktop')nativeHosted=true;mount();clearInterval(timer);void refresh();timer=setInterval(refresh,1500);},show(){mount();dismissed=null;forced=true;setExpanded(true);render();},openPinned,refresh};
})(globalThis);
