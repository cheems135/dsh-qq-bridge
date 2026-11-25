import {createRequire} from 'node:module';
let engine;
export function hostImageEngine(){
 if(engine)return engine;
 for(const parent of [import.meta.url,process.argv[1]].filter(Boolean))try{const require=createRequire(parent);try{return engine=require('sharp');}catch{}return engine=createRequire(require.resolve('@deepseek-ai/dsh-attachment-local'))('sharp');}catch{}
 throw Error('图片尺寸适配组件暂不可用');
}
export async function fitIncomingImage(bytes,{limits={},policy={},sharp=hostImageEngine()}={}){
 const original=Buffer.from(bytes),image=sharp(original,{animated:true,limitInputPixels:64000000}),meta=await image.metadata();
 const width=meta.width,height=meta.pageHeight||meta.height;
 if(!(width>0&&height>0))throw Error('图片尺寸无法读取');
 const maxEdge=Math.min(limits.maxImageDimension||8192,policy.maxDimension||8192),maxPixels=Math.min(limits.maxImagePixels||64000000,policy.maxPixels||4194304);
 const scale=Math.min(1,maxEdge/Math.max(width,height),Math.sqrt(maxPixels/(width*height)));
 if(scale>=1)return {bytes:original,resized:false,width,height};
 const output=await image.resize({width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)),fit:'inside',withoutEnlargement:true}).toBuffer();
 return {bytes:output,resized:true,width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale))};
}
