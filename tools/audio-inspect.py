import sys,json,subprocess,importlib.util,math,tempfile
from pathlib import Path
from uuid import uuid4
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def run(args,timeout=40):
    result=subprocess.run(args,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout)
    if result.returncode:raise ValueError('本地音频解码失败')
    return result
def main(req):
    runtime=req['runtime'];source=Path(req['file']).resolve()
    if not source.is_file() or source.stat().st_size>128*1024*1024:raise ValueError('音频不可读取或超过128MB')
    ffmpeg=runtime['ffmpegPath'];ffprobe=runtime['ffprobePath']
    metadata=json.loads(run([ffprobe,'-v','error','-show_format','-show_streams','-of','json',str(source)],15).stdout)
    duration=float(metadata.get('format',{}).get('duration') or 0)
    stream=next((s for s in metadata.get('streams',[]) if s.get('codec_type')=='audio'),None)
    if not stream:raise ValueError('文件没有音频轨道')
    limit=900 if req.get('music') else 180
    start=max(0,float(req.get('start') or 0));end=min(duration,float(req.get('end') or min(duration,start+limit)))
    if not math.isfinite(duration) or duration<=0 or end<=start:raise ValueError('音频时间范围无效')
    end=min(end,start+limit)
    with tempfile.TemporaryDirectory(prefix='audio-',dir=req['cacheDir']) as directory:
        wav=Path(directory)/'sample.wav'
        run([ffmpeg,'-v','error','-protocol_whitelist','file,pipe','-ss',str(start),'-i',str(source),'-t',str(end-start),'-vn','-ac','1','-ar','22050' if req.get('music') else '16000','-y',str(wav)],90)
        root=Path(__file__).resolve().parent.parent
        acoustic=load('bridge_audio_probe',root/'vendor/video-watch-plus/scripts/audio_probe.py')
        features=acoustic.features(acoustic.decode_mono(str(wav),ffmpeg));verdict=acoustic.verdict(features)
        result={'ok':True,'duration':duration,'start':start,'end':end,'partial':start>0 or end<duration,'channels':stream.get('channels'),'sampleRate':stream.get('sample_rate'),'acoustic':verdict,'transcription':{'status':'not-requested','segments':[]},'coverage':'仅本机抽样音频测量；不能据此猜测具体乐器、情绪或完整歌词'}
        if req.get('music'):
            result['acoustic']={'kind':'实际音乐信号测量，未执行人声分离或乐器识别','confidence':'not-a-vocal-detector','note':'视频语音/器乐启发式不适用于混合人声歌曲，不能据此判纯音乐'}
            measurement=load('bridge_music_measure',root/'tools/music-measure.py')
            result['music']=measurement.measure(wav,start)
            result['coverage']='实际解码并测量 '+str(round(start,2))+'–'+str(round(end,2))+' 秒音频'+('（片段）' if result['partial'] else '（完整取得的文件）')+'；不能据此猜测具体乐器、心情或准确歌词'
        if req.get('charts'):
            result['charts']=[]
            for kind,filter in [('waveform','showwavespic=s=1200x220:colors=0x009688'),('spectrogram','showspectrumpic=s=1100x520:legend=1:scale=log:fscale=log:color=intensity')]:
                chart=Path(req['cacheDir'])/(kind+'-'+uuid4().hex+'.png')
                try:
                    run([ffmpeg,'-v','error','-i',str(wav),'-lavfi',filter,'-frames:v','1','-y',str(chart)],90)
                    result['charts'].append({'kind':kind,'file':str(chart),'start':start,'end':end,'note':'真实音频的波形/对数频谱，非封面图；横轴对应本片段时间，不能读取歌词或当作乐器识别'})
                except Exception as e:result.setdefault('warnings',[]).append(kind+'图生成失败，仍保留真实测量结果')
        if req.get('transcribe'):
            try:
                from faster_whisper import WhisperModel
                model=WhisperModel(runtime['whisperModelPath'],device='cpu',compute_type='int8',cpu_threads=int(runtime.get('whisperThreads') or 2),local_files_only=True)
                segments,_=model.transcribe(str(wav),language=req.get('language') or 'zh',beam_size=3,vad_filter=True,condition_on_previous_text=False)
                helper=load('bridge_video_validation',root/'tools/video_plus.py');rows,suspect=helper.verified_segments(segments,end-start)
                result['transcription']={'status':'candidate' if rows else 'no-verified-speech','segments':rows,'rejectedSegments':suspect,'note':'机器听写候选，可能有错字；音乐不能当作完整准确歌词'}
            except Exception:result['transcription']={'status':'unavailable','segments':[],'note':'本地听写组件或模型尚不可用；不代表无人说话'}
        return result
if __name__=='__main__':
    try:print(json.dumps(main(json.load(sys.stdin)),ensure_ascii=False,allow_nan=False))
    except Exception as error:print(json.dumps({'ok':False,'error':str(error)},ensure_ascii=False))
