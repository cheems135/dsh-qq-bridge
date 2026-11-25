// Presentation groups are independent of the historical persona/source metadata.
// Members remain available for exact edits; grouping never rewrites an archive.
export function groupMemoryScopes(scopes=[]){
 const groups=new Map();
 for(const scope of scopes){if(!scope?.meta)continue;const kind=scope.meta.kind||(scope.meta.key?'chat':'life'),id=encodeURIComponent(JSON.stringify([kind,scope.meta.key||'']));
  let group=groups.get(id);if(!group){group={...scope,meta:{...scope.meta,personaId:''},libraryKey:id,members:[]};for(const field of ['days','months','years','anchors','items','pendingDays','pending','applications','log'])group[field]=[];groups.set(id,group);}
  group.members.push(scope);
  for(const field of ['days','months','years','anchors','items','pendingDays','pending','applications','log'])for(const row of scope[field]||[]){
   const fingerprint=field==='items'?JSON.stringify([row.kind,row.summary,row.source?.id]):JSON.stringify(row);
   if(!group[field].some(old=>old._libraryFingerprint===fingerprint))group[field].push({...row,_libraryFingerprint:fingerprint});
  }
 }
 for(const group of groups.values()){
  group.subjects={};for(const item of group.items)group.subjects[item.subject||'其他知识']=(group.subjects[item.subject||'其他知识']||0)+1;
  group.status=group.members.map(s=>s.status).filter(Boolean).sort((a,b)=>(b.at||0)-(a.at||0))[0]||null;
  if(group.members.some(s=>s.effects)){group.effects={};for(const field of ['retrieved','reviewed','positive','negative','suspended'])group.effects[field]=group.members.reduce((n,s)=>n+(Number(s.effects?.[field])||0),0);group.effects.meaning='召回不等于正确应用；原始来源与实际答复分别保留';}
 }
 return [...groups.values()];
}
