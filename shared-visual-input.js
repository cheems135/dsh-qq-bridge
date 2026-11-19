import {timingSafeEqual} from 'node:crypto';
export function sharedTokenMatches(actual,expected){
 if(typeof actual!=='string'||typeof expected!=='string'||actual.length>128)return false;
 const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
function jpegSize(data){
 if(data[0]!==255||data[1]!==216)throw Error('共享画面不是有效JPEG');
 for(let i=2;i+8<data.length;){
  if(data[i++]!==255)throw Error('共享JPEG结构无效');while(data[i]===255)i++;const marker=data[i++];
  if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
  const length=data.readUInt16BE(i);if(length<2||i+length>data.length)throw Error('共享JPEG结构无效');
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {width:data.readUInt16BE(i+5),height:data.readUInt16BE(i+3)};
  i+=length;
 }
 throw Error('无法识别共享画面尺寸');
}
export function normalizeSharedFrame(frame,budget,now=Date.now()){
 if(!frame||typeof frame.data!=='string'||frame.data.length>1400000||!/^[A-Za-z0-9+/]+={0,2}$/.test(frame.data))throw Error('共享画面数据无效或过大');
 const bytes=Buffer.from(frame.data,'base64');if(bytes.length>768*1024||bytes.toString('base64')!==frame.data)throw Error('共享画面超过预算或编码无效');
 const size=jpegSize(bytes);if(!size.width||!size.height||Math.max(size.width,size.height)>budget.maxEdge)throw Error('共享画面尺寸超过当前模型预算');
 if(!Number.isFinite(frame.capturedAt)||now-frame.capturedAt>10000||frame.capturedAt>now+2000)throw Error('共享画面已过期');
 const signature=Array.isArray(frame.signature)&&frame.signature.length===144&&frame.signature.every(n=>Number.isInteger(n)&&n>=0&&n<=255)?frame.signature:undefined;
 const result={data:frame.data,mediaType:'image/jpeg',...size,capturedAt:frame.capturedAt,signature,subtitle:'',audioState:frame.audioState==='captured'?'captured':'not-captured',coverage:'用户通过系统选择器共享的'+(frame.displaySurface==='window'?'窗口':frame.displaySurface==='browser'?'浏览器标签页':'屏幕')+'当前画面；未取得字幕或声音时不推测其内容'};
 if(Number.isFinite(frame.sourceCapturedAt)&&frame.sourceCapturedAt<=frame.capturedAt&&frame.sourceCapturedAt>0){result.sourceCapturedAt=frame.sourceCapturedAt;result.unchangedSource=frame.unchangedSource===true;}
 if(frame.audioChunk){
  const a=frame.audioChunk;if(typeof a.data!=='string'||a.data.length>700000||!Number.isFinite(a.at)||now-a.at>12000||a.at>now+2000)throw Error('共享声音片段无效或过期');
  const bytes=Buffer.from(a.data,'base64');if(bytes.length>512*1024||bytes.subarray(0,4).toString('hex')!=='1a45dfa3')throw Error('共享声音不是有效WebM片段');
  result.audioChunk={data:bytes.toString('base64'),at:a.at,...(Number.isFinite(a.startedAt)&&a.startedAt<=a.at&&a.at-a.startedAt<=15000?{startedAt:a.startedAt}:{}),mediaType:'audio/webm'};
 }
 return result;
}
