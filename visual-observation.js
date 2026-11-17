// Host-owned budgets: model arguments may reduce, never increase, these caps.
export function visualObservationPolicy(context={}){
 const local=context.visualBackend==='local'||context.localTurn===true&&!context.apiTaskAssist;
 return local?{backend:'local',maxFrames:1,intervalMs:1000,maxEdge:640,quality:62,maxBytes:384*1024}
 :{backend:'api',maxFrames:2,intervalMs:400,maxEdge:1024,quality:72,maxBytes:768*1024};
}
export function currentVisualFrames(frames=[],context={}){
 // Keep the newest bounded window. Never sample old frames to fill a quota.
 return frames.slice(-visualObservationPolicy(context).maxFrames);
}
