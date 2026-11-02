import {mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync,renameSync,realpathSync,statSync} from 'node:fs';
import {join,dirname,basename,relative,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const number=(v,min=0,max=4096)=>{v=Number(v);if(!Number.isFinite(v)||v<min||v>max)throw Error('画笔坐标或尺寸无效');return v;};
const color=v=>{if(v===undefined)return 'none';if(!/^(?:#[a-f\d]{3,8}|none|transparent|black|white|red|blue|green|pink|yellow|gray)$/i.test(v))throw Error('请使用颜色值，不接受外部资源');return v;};
export function drawingSvg(project){const shapes=(project.shapes||[]).map(s=>{
 const paint=' fill="'+color(s.fill)+'" stroke="'+color(s.stroke||'#465575')+'" stroke-width="'+number(s.width??3,0,100)+'" stroke-linecap="round" stroke-linejoin="round"';
 if(s.type==='path'){if(!/^[MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]{1,20000}$/.test(s.d||''))throw Error('画笔路径无效');return '<path d="'+esc(s.d)+'"'+paint+'/>';}
 if(s.type==='line')return '<line x1="'+number(s.x1)+'" y1="'+number(s.y1)+'" x2="'+number(s.x2)+'" y2="'+number(s.y2)+'"'+paint+'/>';
 if(s.type==='ellipse')return '<ellipse cx="'+number(s.cx)+'" cy="'+number(s.cy)+'" rx="'+number(s.rx)+'" ry="'+number(s.ry)+'"'+paint+'/>';
 if(s.type==='rect')return '<rect x="'+number(s.x)+'" y="'+number(s.y)+'" width="'+number(s.w)+'" height="'+number(s.h)+'" rx="'+number(s.radius||0)+'"'+paint+'/>';
 if(s.type==='text')return '<text x="'+number(s.x)+'" y="'+number(s.y)+'" font-size="'+number(s.size||24,8,200)+'" fill="'+color(s.fill||'#465575')+'">'+esc(String(s.text||'').slice(0,100))+'</text>';
 throw Error('不支持的笔画类型');
 }).join('');return '<svg xmlns="http://www.w3.org/2000/svg" width="'+project.width+'" height="'+project.height+'" viewBox="0 0 '+project.width+' '+project.height+'"><rect width="100%" height="100%" fill="'+color(project.background||'#ffffff')+'"/>'+shapes+'</svg>';
}
export async function renderDrawing(svg,file,{width,height,tempDir=join(dirname(file),'.renderer')}){mkdirSync(tempDir,{recursive:true});const chromium=require('./vendor/playwright-core').chromium,paths=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'];const browser=await chromium.launch({headless:true,env:{...process.env,TEMP:tempDir,TMP:tempDir},artifactsDir:tempDir,...(paths.find(existsSync)?{executablePath:paths.find(existsSync)}:{} )});try{const page=await browser.newPage({viewport:{width,height}});await page.setContent('<style>html,body{margin:0;padding:0;background:transparent}</style>'+svg);await page.locator('svg').screenshot({path:file});}finally{await browser.close();}}
export function createDrawingStudio({getRoot,render=renderDrawing,now=()=>Date.now()}={}){
 const dir=c=>{const p=join(getRoot(),'drawings',createHash('sha256').update(JSON.stringify([c.accountId,c.personaId])).digest('hex').slice(0,24));mkdirSync(p,{recursive:true});return p;};
 const load=(c,id)=>{if(!/^[a-f\d-]{36}$/.test(id||''))throw Error('请使用当前画本的真实作品id');return JSON.parse(readFileSync(join(dir(c),id+'.json'),'utf8'));};
 const save=(c,p)=>{const file=join(dir(c),p.id+'.json'),tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(p));renameSync(tmp,file);};
 async function act(args,c){
  if(args.action==='list')return {ok:true,works:readdirSync(dir(c)).filter(n=>n.endsWith('.json')).map(n=>{const p=load(c,n.slice(0,-5)),file=join(dir(c),p.id+'.png');return {id:p.id,title:p.title,strokes:p.shapes.length,updatedAt:p.updatedAt,...(existsSync(file)?{file}: {})};})};
  if(args.action==='create'){const p={id:randomUUID(),title:String(args.title||'新画').slice(0,60),width:number(args.width||768,64,2048),height:number(args.height||768,64,2048),background:color(args.background||'#ffffff'),shapes:[],at:now(),updatedAt:now()};save(c,p);return {ok:true,id:p.id,width:p.width,height:p.height,strokes:0,substantive:false,coverage:'已建空白画布，尚未绘制'};}
  const p=load(c,args.id);
  if(args.action==='draw'){const shapes=Array.isArray(args.shapes)?args.shapes:[];if(!shapes.length||shapes.length>200||p.shapes.length+shapes.length>3000)throw Error('一次添加1到200笔，一幅画最多3000笔');const next={...p,shapes:[...p.shapes,...shapes],updatedAt:now()};drawingSvg(next);save(c,next);return {ok:true,id:p.id,strokes:next.shapes.length,substantive:false,coverage:'实际笔画已写入画本，render可查看并继续修改'};}
  if(args.action!=='render')throw Error('未知绘画动作');if(!p.shapes.length)throw Error('空白画布不能算已完成作品');const svg=drawingSvg(p),sourceFile=join(dir(c),p.id+'.svg'),file=join(dir(c),p.id+'.png');writeFileSync(sourceFile,svg);await render(svg,file,{...p,tempDir:join(getRoot(),'browser','drawing-renderer')});if(!existsSync(file))throw Error('绘制结果尚未导出');return {ok:true,id:p.id,title:p.title,file,sourceFile,strokes:p.shapes.length,substantive:true,coverage:'真实画布上的'+p.shapes.length+'笔已导出PNG，SVG与画本源文件保留，可继续修改；未自动发送QQ'};
 }
 function verifyArtifact(file,c){
  const base=realpathSync(dir(c)),target=realpathSync(String(file||'')),rel=relative(base,target);
  if(!rel||rel.startsWith('..')||isAbsolute(rel)||dirname(target)!==base||!/^[a-f\d-]{36}\.png$/i.test(basename(target)))throw Error('只能分享当前账号人设画本中的实际作品');
  const project=load(c,basename(target,'.png')),stat=statSync(target),bytes=readFileSync(target);
  if(!project.shapes?.length||!stat.isFile()||stat.size>16*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('画本没有有效的已导出图片');
  return {ok:true,substantive:true,tool:'bridge_drawing',file:target,sha256:createHash('sha256').update(bytes).digest('hex'),title:project.title,coverage:'已核实当前账号人设画本、实际笔画和已导出PNG，可分享既有作品，不要求重新绘制'};
 }
 return {act,verifyArtifact};
}
