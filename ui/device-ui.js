(function(root){
 'use strict';
 var mobileGroups=[
  {id:'home',label:'日常',note:'近况、日程和日记',icon:'home',pages:['overview','daily','diary','star']},
  {id:'messages',label:'消息',note:'聊天与送达',icon:'chat',pages:['monitor','send','sessions','delivery','activity']},
  {id:'character',label:'认识她',note:'人设与记忆',icon:'spark',pages:['persona','profiles','autonomy','study','thoughts','memory']},
  {id:'assets',label:'内容',note:'声音、图片和上网',icon:'image',pages:['voice','songs','imagegen','videogen','sticker','collect','bilibili','qzone','websitemcp','invocations']},
  {id:'system',label:'设置',note:'API 与设备',icon:'settings',pages:['connection','services','devices','whitelist','model','storage','logs','backup']}
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
  var link=doc.getElementById('deviceUiStyles');if(!link){link=doc.createElement('link');link.id='deviceUiStyles';link.rel='stylesheet';doc.head.appendChild(link);}
  var href='/im-bridge/ui/'+(device==='phone'?'mobile':'desktop')+'.css';if(link.getAttribute('href')!==href)link.setAttribute('href',href);
  var bar=doc.getElementById('deviceUiBar');if(!bar)return;
  bar.querySelector('[data-device-label]').textContent=device==='phone'?'随身小世界':'QQ 桥接工作台';
  bar.querySelector('[data-device-note]').textContent=device===runtime?(device==='phone'?'手机运行 · API 模式':'电脑运行 · 自由搭配'):'界面预览 · 机器人仍在'+(runtime==='phone'?'手机':'电脑')+'运行';
  bar.querySelectorAll('[data-ui-device]').forEach(function(button){button.setAttribute('aria-pressed',String(button.dataset.uiDevice===device));});
  var preview=doc.getElementById('devicePreview');preview.hidden=device===runtime;preview.textContent='当前展示'+(device==='phone'?'手机':'电脑')+'界面。实际运行和数据来自'+(runtime==='phone'?'手机':'电脑')+'；请在对应设备打开插件后修改运行设置。';
 }
 root.QQBridgeDeviceUI={groups:groups,supports:supports,apply:apply,previewWriteAllowed:previewWriteAllowed};
})(typeof window==='undefined'?globalThis:window);
