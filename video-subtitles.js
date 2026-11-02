export function parseSubtitles(raw,{source='',partial=false}={}){
 let value=raw;if(typeof raw==='string'){try{value=JSON.parse(raw);}catch{value=null;}}
 let rows=[];
 const time=s=>String(s).split(':').reduce((n,v)=>n*60+Number(v.replace(',','.')),0);
 if(value&&typeof value==='object'){
  const list=Array.isArray(value)?value:value.body||value.subtitles||value.data?.body||value.data?.subtitles;
  if(Array.isArray(list))rows=list.map(x=>({start:Number(x.from??x.start??x.start_time),end:Number(x.to??x.end??x.end_time),text:String(x.content??x.text??'')}));
 }
 if(!rows.length&&typeof raw==='string'){
  const lines=raw.replace(/\r/g,'').split('\n');
  for(let i=0;i<lines.length;i++)if(lines[i].includes('-->')){const m=lines[i].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);if(!m)continue;const text=[];while(i+1<lines.length&&lines[i+1].trim())text.push(lines[++i]);rows.push({start:time(m[1]),end:time(m[2]),text:text.join(' ')});}
 }
 const unique=new Set();rows=rows.filter(r=>Number.isFinite(r.start)&&r.start>=0&&Number.isFinite(r.end)&&r.end>=r.start&&r.text.trim()).map(r=>({...r,text:r.text.replace(/<[^>]*>/g,'').replace(/[\x00-\x08]/g,'').trim().slice(0,1000)})).filter(r=>{const k=JSON.stringify(r);if(unique.has(k))return false;unique.add(k);return true;}).sort((a,b)=>a.start-b.start).slice(0,1000);
 return {status:rows.length?'available':'unavailable',source,partial,segments:rows,coverage:rows.length?(partial?'实际字幕片段，不代表整段视频':'读取到的视频字幕；不是观看或听过全部视频的证明'):'没有取得可验证字幕，不按标题猜内容'};
}
export async function readBrowserSubtitles(page,session={}){
 await page.evaluate(()=>{for(const v of document.querySelectorAll('video'))for(const t of [...v.textTracks])if(t.mode==='disabled')t.mode='hidden';});
 await page.waitForTimeout(200);
 const info=await page.evaluate(()=>{
  const videos=[...document.querySelectorAll('video')],cues=[],tracks=[];
  for(const v of videos){for(const t of [...v.textTracks]){for(const cue of [...(t.cues||[])])cues.push({from:cue.startTime,to:cue.endTime,content:cue.text});}for(const t of v.querySelectorAll('track[src]'))if(['subtitles','captions'].includes(t.kind))tracks.push(t.src);}
  const state=window.__INITIAL_STATE__||{},video=state.videoData||{},bvid=video.bvid||state.bvid||location.pathname.match(/BV[\w]+/)?.[0],cid=video.cid||state.cid||video.pages?.[0]?.cid;
  const dom=[...document.querySelectorAll('[class*="subtitle-item-text"],[class*="subtitle-panel-text"]')].map(e=>e.innerText).filter(Boolean).slice(0,200);
  return {cues,tracks,bvid,cid,host:location.hostname,dom,url:location.href};
 });
 if(info.cues.length)return parseSubtitles(info.cues,{source:'html-text-track:'+info.url});
 const read=async url=>{
  const u=new URL(url,page.url());if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;
  const r=await page.request.get(u.href,{timeout:8000});if(!r.ok()||Number(r.headers()['content-length'])>2*1024*1024)return null;
  const body=await r.body();if(body.length>2*1024*1024)return null;
  return {text:body.toString('utf8'),source:u.origin+u.pathname};
 };
 for(const url of info.tracks.slice(0,3))try{const data=await read(url),parsed=data&&parseSubtitles(data.text,{source:data.source});if(parsed?.segments.length)return parsed;}catch{}
 if(/(?:^|\.)bilibili\.com$/.test(info.host)&&info.bvid)try{
  if(!info.cid){const v=await read('https://api.bilibili.com/x/web-interface/view?bvid='+encodeURIComponent(info.bvid)),json=JSON.parse(v?.text||'{}');info.cid=json.data?.cid||json.data?.pages?.[0]?.cid;}
  if(!info.cid)throw Error('没有取得当前视频的实际cid');
  const r=await read('https://api.bilibili.com/x/player/v2?bvid='+encodeURIComponent(info.bvid)+'&cid='+encodeURIComponent(info.cid)),json=JSON.parse(r?.text||'{}');
  const tracks=json.data?.subtitle?.subtitles||[];
  for(const track of tracks.slice(0,3)){if(!track.subtitle_url)continue;const data=await read(new URL(track.subtitle_url,'https://api.bilibili.com').href),parsed=data&&parseSubtitles(data.text,{source:data.source});if(parsed?.segments.length)return {...parsed,language:track.lan||'',machine:!!track.ai_status};}
 }catch{}
 const captured=(session.captionResponses||[]).filter(x=>x.page===info.url).at(-1);if(captured){const parsed=parseSubtitles(captured.text,{source:captured.source});if(parsed.segments.length)return parsed;}
 if(info.dom.length)return {status:'partial',partial:true,source:'visible-subtitle-panel:'+info.url,segments:[],text:info.dom.join('\n').slice(0,16000),coverage:'当前页面实际显示的字幕面板文字，时间与完整性未核实'};
 return parseSubtitles('',{source:info.url});
}
