import {homedir} from 'node:os';
import {join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createDesktopNapCat} from './desktop-napcat.js';
import {createLocalNapCat} from './mobile-napcat.js';
import {createMobilePhoneController} from './mobile-phone-controller.js';
export const isDesktop=process.platform==='win32';
export const platform={
  python:isDesktop?join(homedir(),'.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe'):'/root/projects/.dsh/tools/qq-bridge-mobile-media/bin/python',
  napcatDir:isDesktop?join(homedir(),'NapCat'):'/root/projects/napcat/squashfs-root',
  presetDir:isDesktop?join(homedir(),'Documents/deepseek-harness/default-workspace'):'/root/projects/qq-bridge-mobile-presets',
};
export function createPlatformPhoneController(options){
  if(!isDesktop)return createMobilePhoneController(options);
  return{
    async status(){try{return {...await options.peer()?.phoneRequest({action:'status'}),backend:'usb-dshbox-pilot'};}catch{return{installed:true,enabled:options.getConfig().enabled,connected:false,backend:'usb-dshbox-pilot',devices:[],inputNote:'连接已配对的安卓手机并打开DSHBox，即可通过数据线操作手机。'};}},
    async act(body,context={}){if(!options.authorize(context,body.action))throw Error('当前会话没有手机操作权限');if(!options.getConfig().enabled)throw Error('手机操作已关闭');const peer=options.peer();if(!peer)throw Error('设备同步尚未就绪');const result=await peer.phoneRequest(body);if(!options.authorize(context,body.action))throw Error('手机操作期间权限已改变，未提交旧结果');if(result?.imageTransfer){const image=result.imageTransfer,bytes=Buffer.from(String(image.data||''),'base64');if(bytes.length>8*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('手机返回的截图无效');const dir=join(options.getCacheDir(),'phone');mkdirSync(dir,{recursive:true});const file=join(dir,'peer-'+randomUUID()+'.png');writeFileSync(file,bytes);delete result.imageTransfer;result.file=file;}return result;},
    cancel(){},
  };
}
export function createPlatformNapCat(options){return isDesktop?createDesktopNapCat(options):createLocalNapCat(options);}
