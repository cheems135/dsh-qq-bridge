import {existsSync,statSync} from 'node:fs';
import {isAbsolute,join,posix,resolve} from 'node:path';

const WINDOWS_PATH=/^[A-Za-z]:[\\/]/;
const WINDOWS_NAME=/\.exe$/i;

function normalizePlatform(platform){
  const value=String(platform||process.platform).toLowerCase();
  if(['win32','win','windows'].includes(value))return 'win32';
  if(['darwin','mac','macos'].includes(value))return 'darwin';
  if(['linux','android','freebsd','openbsd','netbsd','sunos','aix'].includes(value))return value;
  return value;
}

function compatiblePath(value,platform){
  if(typeof value!=='string'||!value.trim()||value.includes('\0'))return false;
  if(platform==='win32')return !value.startsWith('/')||WINDOWS_PATH.test(value);
  return !WINDOWS_PATH.test(value)&&!value.includes('\\')&&!WINDOWS_NAME.test(value);
}

function executableFile(value,platform){
  if(!compatiblePath(value,platform))return '';
  const path=isAbsolute(value)?value:resolve(value);
  try{return existsSync(path)&&statSync(path).isFile()?path:'';}catch{return '';}
}

function envValue(env,key){
  if(!env)return '';
  const actual=Object.keys(env).find(name=>name.toLowerCase()===key.toLowerCase());
  return actual?String(env[actual]||''):'';
}

function pathDirectories(env,platform){
  const raw=envValue(env,'PATH');
  if(!raw)return [];
  return raw.split(platform==='win32'?';':':').map(part=>{
    let value=part.trim();
    if(value.length>=2&&value.startsWith('"')&&value.endsWith('"'))value=value.slice(1,-1);
    return value&&compatiblePath(value,platform)?value:'';
  }).filter(Boolean);
}

function namesFor(name,platform){
  return platform==='win32'?[name+'.exe']:[name];
}

function joinForPlatform(directory,name,platform){
  return platform==='win32'?join(directory,name):posix.join(directory,name);
}

function systemDirectories(platform){
  if(platform==='win32')return [];
  return ['/usr/bin','/bin','/usr/local/bin'];
}

function findExecutable({configured,names,platform,env}){
  for(const value of configured){
    if(!value)continue;
    if(/[\\/]/.test(value)||isAbsolute(value)){
      const found=executableFile(value,platform);
      if(found)return{path:found,source:'configured'};
      continue;
    }
    for(const directory of pathDirectories(env,platform)){
      for(const name of namesFor(value,platform)){
        const found=executableFile(joinForPlatform(directory,name,platform),platform);
        if(found)return{path:found,source:'configured-path'};
      }
    }
  }
  const directories=systemDirectories(platform);
  for(const directory of directories){
    for(const name of names){
      const found=executableFile(joinForPlatform(directory,name,platform),platform);
      if(found)return{path:found,source:'system'};
    }
  }
  for(const directory of pathDirectories(env,platform)){
    if(directories.includes(directory))continue;
    for(const name of names){
      const found=executableFile(joinForPlatform(directory,name,platform),platform);
      if(found)return{path:found,source:'path'};
    }
  }
  return{path:'',source:'missing'};
}

function configuredValues(...values){
  return values.map(value=>typeof value==='string'?value.trim():'').filter(Boolean);
}

export function resolveVideoRuntime(config={},options={}){
  const source=config&&typeof config==='object'?config:{};
  const platform=normalizePlatform(options.platform);
  const env=options.env||process.env||{};
  const ffmpeg=findExecutable({
    configured:configuredValues(source.ffmpegPath,source.ffmpeg,source.paths?.ffmpegPath,source.paths?.ffmpeg),
    names:namesFor('ffmpeg',platform),platform,env,
  });
  const ffprobe=findExecutable({
    configured:configuredValues(source.ffprobePath,source.ffprobe,source.paths?.ffprobePath,source.paths?.ffprobe),
    names:namesFor('ffprobe',platform),platform,env,
  });
  const pythonNames=platform==='win32'
    ?['python.exe','python3.exe','py.exe']
    :['python3','python'];
  const python=findExecutable({
    configured:configuredValues(source.videoPlusPythonPath,source.pythonPath,source.python,source.paths?.videoPlusPythonPath,source.paths?.pythonPath),
    names:pythonNames,platform,env,
  });
  const basicAvailable=Boolean(ffmpeg.path);
  const enhancedAvailable=basicAvailable&&Boolean(ffprobe.path&&python.path);
  const webSupported=enhancedAvailable;
  const bilibiliDirectSupported=basicAvailable;
  return {
    platform,
    ffmpegPath:ffmpeg.path,
    ffprobePath:ffprobe.path,
    videoPlusPythonPath:python.path,
    pythonPath:python.path,
    basic:{available:basicAvailable,ffmpeg:Boolean(ffmpeg.path)},
    enhanced:{available:enhancedAvailable,ffmpeg:Boolean(ffmpeg.path),ffprobe:Boolean(ffprobe.path),python:Boolean(python.path)},
    basicAvailable,
    enhancedAvailable,
    webSupported,
    bilibiliDirectSupported,
    executables:{ffmpeg:Boolean(ffmpeg.path),ffprobe:Boolean(ffprobe.path),python:Boolean(python.path)},
    sources:{ffmpeg:ffmpeg.source,ffprobe:ffprobe.source,python:python.source},
  };
}
