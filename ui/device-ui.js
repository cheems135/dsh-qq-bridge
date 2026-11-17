(function(root){
 'use strict';
 var mobileGroups=[
  {id:'home',label:'日常',note:'近况、日程和日记',icon:'home',pages:['overview','daily','diary','star']},
  {id:'messages',label:'消息',note:'聊天与送达',icon:'chat',pages:['monitor','send','sessions','delivery','activity','invocations']},
  {id:'character',label:'认识她',note:'人设与记忆',icon:'spark',pages:['persona','profiles','directives','autonomy','study','thoughts','memory']},
  {id:'assets',label:'内容',note:'声音、图片和上网',icon:'image',pages:['voice','songs','imagegen','videogen','sticker','collect','bilibili','qzone','websitemcp']},
  {id:'system',label:'设置',note:'API 与设备',icon:'settings',pages:['connection','prompts','services','devices','whitelist','model','storage','backup']}
 ];
 function groups(device,desktop){return (device==='phone'?mobileGroups:desktop).map(function(g){return Object.assign({},g,{pages:g.pages.slice()});});}
 function supports(device,page){return device!=='phone'||mobileGroups.some(function(g){return g.pages.indexOf(page)>=0;});}
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
  var href='/im-bridge/ui/'+(device==='phone'?'mobile':'desktop')+'.css?v=1.62.75';if(link.getAttribute('href')!==href)link.setAttribute('href',href);
  // Moving an already adjacent stylesheet detaches it briefly in Chromium and
  // flashes the legacy layout on every status poll. Order it only when needed.
  var design=doc.getElementById('bridgeDesignStyles');if(design&&link.nextElementSibling!==design)link.after(design);
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
