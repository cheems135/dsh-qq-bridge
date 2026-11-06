function structuralCopy(value){
  if(Array.isArray(value))return value.map(structuralCopy);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,structuralCopy(item)]));
  return value;
}

function section(parent,key){
  const value=parent[key];
  if(value&&typeof value==='object'&&!Array.isArray(value))return value;
  const next={};
  parent[key]=next;
  return next;
}

function normalizeProfiles(profiles){
  if(Array.isArray(profiles))return profiles.map(profile=>profile&&typeof profile==='object'?{...profile,proactive:true}:profile);
  if(!profiles||typeof profiles!=='object')return profiles;
  return Object.fromEntries(Object.entries(profiles).map(([key,profile])=>[
    key,
    profile&&typeof profile==='object'?{...profile,proactive:true}:profile,
  ]));
}

export function nonpaymentOpen(settings={}){
  return settings?.permissionsMode!=='configured';
}

/**
 * Apply the nonpayment-only policy without mutating the supplied settings.
 * A configured permission set is preserved as-is.
 */
export function applyNonpaymentPolicy(settings={}, {mobile=false}={}){
  const next=structuralCopy(settings&&typeof settings==='object'?settings:{});
  if(!nonpaymentOpen(next))return next;

  next.permissionsMode='open-nonpayment';
  // Tool authority does not imply constant social availability. Migrate once.
  if(next.socialPacingRevision!=='20261106-natural-rest-v1'){next.groupRequireAt=true;section(next,'life').sleep=true;next.socialPacingRevision='20261106-natural-rest-v1';}
  const agency=section(next,'agency');
  Object.assign(agency,{
    enabled:true,
    autonomous:true,
    browser:true,
    desktop:!mobile,
    phone:true,
    workspace:mobile?'internal':'desktop',
  });

  const phone=section(next,'phone');
  Object.assign(phone,{enabled:true,autonomous:true,learning:true});

  const realism=section(next,'realism');
  Object.assign(section(realism,'safety'),{phone:true});
  realism.unlimitedProactive=true;

  Object.assign(section(next,'life'),{maxTasksPerDay:0});
  section(next,'dnd').enabled=false;

  const autonomy=section(next,'autonomy');
  Object.assign(autonomy,{
    enabled:true,
    initiate:true,
    explore:true,
    qzoneImages:true,
    chatIdleMinutes:0,
  });
  Object.assign(section(autonomy,'shareMedia'),{enabled:true,limits:false,voice:true,images:true,duringChat:true,idle:true});

  const companion=section(next,'companion');
  Object.assign(companion,{expressionMode:'free',casualInitiative:true,maxBubbles:0,maxReplyChars:0});

  next.contactProfiles=normalizeProfiles(next.contactProfiles);
  return next;
}
