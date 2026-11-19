export function renderPageNavigation(group,current,heads,escape){
 const button=page=>'<button type="button" class="'+(current===page?'on':'')+'" data-go="'+page+'"'+(current===page?' aria-current="page"':'')+'>'+escape(heads[page][0])+'</button>';
 return '<nav class="subnav" aria-label="'+escape(group.label)+'功能">'+group.pages.map(button).join('')+'</nav>';
}

export function passiveConsoleRequest(method,url,payload){
 if(method==='POST'&&url==='/im-bridge/voice/preview'&&payload?.action==='status')return true;
 if(method!=='POST')return true;
 if(url==='/im-bridge/clientlog')return true;
 const reads={
  '/im-bridge/features/companion':['snapshot'],
  '/im-bridge/features/memory-hub':['snapshot','evidence','search'],
  '/im-bridge/website-mcp':['list','schema'],
 };
 return (reads[url]||[]).includes(payload?.action);
}

function detailEntries(pane){
 const occurrences=new Map();
 return [...pane.querySelectorAll('details')].map(el=>{
  const ancestors=[];
  for(let node=el;node&&pane.contains(node);node=node.parentElement?.closest('details')){
   ancestors.unshift([...node.children].find(child=>child.tagName==='SUMMARY')?.textContent.trim()||'');
  }
  const card=el.closest('.card'),heading=card?.querySelector(':scope > h2,:scope > .section-heading h2')?.textContent.trim()||'';
  const base=el.id?'id:'+el.id:JSON.stringify([card?.id||heading,ancestors]);
  const count=occurrences.get(base)||0;occurrences.set(base,count+1);
  return [base+':'+count,el];
 });
}
function elementPath(el,pane){
 if(!el||!pane.contains(el))return null;
 if(el.id)return '#'+CSS.escape(el.id);
 const parts=[];
 for(let node=el;node&&node!==pane;node=node.parentElement){
  parts.unshift(node.localName+':nth-child('+([...node.parentElement.children].indexOf(node)+1)+')');
 }
 return ':scope > '+parts.join(' > ');
}
// Refreshing data must not collapse disclosures or take the reader back up the page.
// This state is transient and scoped to the current page; it does not save settings.
export function capturePanelView(pane){
 const active=document.activeElement;
 return {
  x:window.scrollX,y:window.scrollY,
  details:new Map(detailEntries(pane).map(([key,el])=>[key,el.open])),
  scroll:[...pane.querySelectorAll('*')].filter(el=>el.scrollTop||el.scrollLeft).map(el=>({path:elementPath(el,pane),top:el.scrollTop,left:el.scrollLeft})),
  focus:pane.contains(active)?{path:elementPath(active,pane),start:active.selectionStart,end:active.selectionEnd}:null,
 };
}
export function restorePanelView(pane,state,{layoutOnly=false}={}){
 if(!state)return;
 for(const [key,el] of detailEntries(pane))if(state.details.has(key))el.open=state.details.get(key);
 if(layoutOnly)return;
 for(const item of state.scroll){const el=pane.querySelector(item.path);if(el){el.scrollTop=item.top;el.scrollLeft=item.left;}}
 const focus=state.focus,el=focus&&pane.querySelector(focus.path);
 if(el){el.focus({preventScroll:true});if(typeof el.setSelectionRange==='function'&&focus.start!=null)try{el.setSelectionRange(focus.start,focus.end);}catch{}}
 window.scrollTo({left:state.x,top:state.y,behavior:'instant'});
}

export function enhancePageNavigation(pane){
 if(!pane)return;
 const settingsPage=!pane.querySelector('.page-overview,.page-daily,.page-diary,.page-monitor,.page-invocations,.page-star');
 const headings=settingsPage?[...pane.querySelectorAll('.page-content h2')].filter(h=>h.textContent.trim()&&!h.closest('details')):[];
 if(headings.length>=5){
  const label=document.createElement('label');label.className='section-jump';
  const caption=document.createElement('span');caption.textContent='本页设置';
  const select=document.createElement('select');select.setAttribute('aria-label','跳到本页的设置分组');
  select.append(new Option('选择分组 · '+headings.length+' 项',''));
  headings.forEach((h,i)=>select.append(new Option(h.textContent.trim(),String(i))));
  select.onchange=()=>{if(select.value==='')return;const target=headings[Number(select.value)];target.tabIndex=-1;target.scrollIntoView({block:'start',behavior:'instant'});target.focus({preventScroll:true});select.value='';};
  label.append(caption,select);pane.querySelector('.page-content')?.before(label);
 }
}
