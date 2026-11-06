// Count only time outside the group's local foreground work. Overlapping
// phases pause one clock, and each release is idempotent.
export function createLocalGroupWindow({now=Date.now,durationMs=120000}={}){
 const rows=new Map();
 const settle=row=>{const at=now();if(!row.pauses.size)row.remaining=Math.max(0,row.remaining-Math.max(0,at-row.at));row.at=at;return row;};
 const get=key=>{const row=rows.get(key);if(!row)return null;settle(row);if(!row.remaining&&!row.pauses.size){rows.delete(key);return null;}return row;};
 return {
  activate(key){const row=get(key)||{remaining:durationMs,at:now(),pauses:new Set()};row.remaining=durationMs;row.at=now();rows.set(key,row);return durationMs;},
  active(key){return !!get(key)?.remaining;},
  pause(key){const row=get(key);if(!row)return ()=>{};const token=Symbol();row.pauses.add(token);let released=false;return()=>{if(released)return;released=true;if(rows.get(key)!==row)return;settle(row);row.pauses.delete(token);row.at=now();};},
  snapshot(key){const row=get(key);return {active:!!row?.remaining,remainingMs:row?.remaining||0,paused:!!row?.pauses.size};},
  clear(key){if(key===undefined)rows.clear();else rows.delete(key);},
 };
}
