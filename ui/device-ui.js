(function(root){
 'use strict';
 var sections=[
  {id:'home',label:'首页',short:'首页',note:'近况与用量',icon:'home',pages:['overview']},
  {id:'messages',label:'消息与任务',short:'消息',note:'聊天、执行与送达',icon:'chat',pages:['monitor','delivery','invocations']},
  {id:'character',label:'人格与记忆',short:'人格',note:'角色、关系与成长',icon:'spark',pages:['persona','memory','profiles','star','study','thoughts','directives']},
  {id:'social',label:'生活与社交',short:'生活',note:'日程、空间与频道',icon:'users',pages:['daily','diary','autonomy','qzone','guild','bilibili']},
  {id:'assets',label:'作品',short:'作品',note:'歌曲、图片与视频',icon:'image',pages:['songs','photo','sticker','collect']},
  {id:'api',label:'API 服务',short:'API',note:'云端模型与生成工作流',icon:'spark',pages:['api','imagegen','voice','apisong','videogen']},
  {id:'local',label:'本地功能',short:'本地',note:'本地网关、模型与工作流',icon:'link',pages:['local']},
  {id:'connections',label:'能力与连接',short:'连接',note:'账号、工作流与设备',icon:'link',pages:['connection','services','websitemcp','devices']},
  {id:'system',label:'设置',short:'设置',note:'权限、模型与备份',icon:'settings',pages:['whitelist','model','prompts','storage','backup','maintenance']}
 ];
 function groups(device,desktop){
  return (desktop||sections).map(function(g){return Object.assign({},g,{pages:g.pages.filter(function(p){return device!=='phone'||(p!=='local'&&p!=='photo');})});}).filter(function(g){return g.pages.length;});
 }
 function supports(device,page){return groups(device).some(function(g){return g.pages.indexOf(page)>=0;});}
 function previewWriteAllowed(url,body){
  if(url==='/im-bridge/device-profiles')return ['select','save'].indexOf(body&&body.action)>=0;
  if(url==='/im-bridge/device-sync')return true;
  if(url==='/im-bridge/clientlog')return true;
  if(/^\/im-bridge\/features\/(?:companion|memory-hub)$/.test(url))return ['snapshot','evidence','search'].indexOf(body&&body.action)>=0;
  return url==='/im-bridge/website-mcp'&&['list','schema'].indexOf(body&&body.action)>=0;
 }
 function apply(device,runtime){
  if(!root.document)return;
  var doc=root.document;doc.documentElement.dataset.deviceUi=device;
  try{root.localStorage.setItem('qqbridge-runtime-device-v1',device);}catch(e){}
  var link=doc.getElementById('deviceUiStyles');if(!link){link=doc.createElement('link');link.id='deviceUiStyles';link.rel='stylesheet';doc.head.appendChild(link);}
  var href='/im-bridge/ui/'+(device==='phone'?'mobile':'desktop')+'.css?v=1.63.0-rc.13';if(link.getAttribute('href')!==href)link.setAttribute('href',href);
  // Moving an already adjacent stylesheet detaches it briefly in Chromium and
  // flashes the legacy layout on every status poll. Order it only when needed.
  var design=doc.getElementById('bridgeDesignStyles');if(design&&link.nextElementSibling!==design)design.before(link);
  var bar=doc.getElementById('deviceUiBar');if(!bar)return;
  bar.querySelector('[data-device-label]').textContent=device==='phone'?'随身小世界':'QQ 桥接工作台';
  bar.querySelector('[data-device-note]').textContent=device==='phone'?'手机运行 · API 模式':'电脑运行 · 自由搭配';
  var preview=doc.getElementById('devicePreview');if(preview)preview.hidden=true;
 }
 root.QQBridgeDeviceUI={groups:groups,supports:supports,apply:apply,previewWriteAllowed:previewWriteAllowed};
 // Restore the remembered shell before painting; server status remains authoritative.
 if(root.document){
  var cached='';try{cached=root.localStorage.getItem('qqbridge-runtime-device-v1');}catch(e){}
  if(cached==='phone'||cached==='desktop'){
   apply(cached,cached);
   if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',function(){apply(root.document.documentElement.dataset.deviceUi,cached);},{once:true});
  }
 }
})(typeof window==='undefined'?globalThis:window);
