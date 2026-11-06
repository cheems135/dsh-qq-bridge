import {mkdirSync,readFileSync,writeFileSync,renameSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {imageBytes} from './social-images.js';
export const SOCIAL_IMAGE_RULES='空间配图由你按内容选择：搜索到的图片、实际截图、生成图片、自己逐笔画的作品都可以，也可以不配图。先用 bridge_social_image 准备并观察实际图片，再把返回的 file 放进 bridge_qq_profile.images；不把搜索图说成自拍，不把截图说成画作。生成时沿用正常生图的人设参考、画风、日程穿搭、头饰和场景逻辑，角色风格优先，当前明确要求优先于默认。自拍才使用角色身份，风景或作品不强塞角色。自己画画用 bridge_drawing 建画布、加笔画并 render，不能把生图说成手绘。截图只选你正在浏览的公开作品或自有创作，避开账号、私聊、通知、二维码、凭据和个人信息，必要时重新截局部；公开动态不带私人记忆。没有取得实际文件、准备失败或上传失败时不要声称已经配图，也不要悄悄丢掉选定图片发布纯文字。';
export function createSocialAssets({rootFor,authorize,now=Date.now}={}){
 const root=c=>rootFor(c),manifest=c=>{try{return JSON.parse(readFileSync(join(root(c),'assets.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return {items:[]};throw e;}};
 const check=c=>{if(!authorize(c))throw Error('账号、人设或任务已变化，停止准备空间配图');c.signal?.throwIfAborted();};
 function save(c,value){const target=join(root(c),'assets.json'),tmp=target+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(value));renameSync(tmp,target);}
 function remember(file,{source,query='',captureId='',title=''},c){
  check(c);if(!['search','screenshot','generated','drawing'].includes(source))throw Error('未知空间图片来源');
  const image=imageBytes(readFileSync(realpathSync(file)));check(c);mkdirSync(root(c),{recursive:true});
  const destination=join(root(c),randomUUID()+'.'+image.extension);writeFileSync(destination,image.bytes);
  const item={id:basename(destination),source,query:String(query).slice(0,160),captureId:String(captureId).slice(0,100),title:String(title).slice(0,100),hash:image.hash,at:now()};
  const state=manifest(c);state.items.push(item);save(c,state);
  return {ok:true,file:destination,source,sha256:image.hash,coverage:'实际图片已保存到当前账号人设的公开候选素材目录，尚未发布；请观察画面后决定是否使用'};
 }
 function load(file,c){check(c);const base=realpathSync(root(c)),target=realpathSync(String(file||'')),rel=relative(base,target);if(!rel||rel.startsWith('..')||isAbsolute(rel)||rel!==basename(rel))throw Error('只能使用当前账号人设已准备的空间图片');const item=manifest(c).items.find(i=>i.id===rel);if(!item)throw Error('空间图片没有实际准备记录');const image=imageBytes(readFileSync(target));if(image.hash!==item.hash)throw Error('空间图片已改变，请重新观察并准备后再发布');return {...image,file:target,source:item.source,provenance:{source:item.source,query:item.query,captureId:item.captureId,title:item.title}};}
 function list(c){check(c);return {ok:true,items:manifest(c).items.slice(-40).reverse().map(i=>({file:join(root(c),i.id),source:i.source,query:i.query,title:i.title,at:i.at,sha256:i.hash})),coverage:'只是已准备候选，不代表已发布'};}
 return {remember,load,list};
}
