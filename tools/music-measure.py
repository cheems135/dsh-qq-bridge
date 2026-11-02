"""Local signal measurements, not instrument recognition or a listening model.
Inspired by dsh-soundcheck's evidence/uncertainty separation; original NumPy implementation.
"""
import wave,math
import numpy as np

def measure(path,start=0):
    with wave.open(str(path),'rb') as f:
        sr=f.getframerate();x=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float32)/32768
    if len(x)<sr:return {'status':'too-short','limits':['音频不足一秒，不估计拍速或调性']}
    n=2048;hop=512;freq=np.fft.rfftfreq(n,1/sr);window=np.hanning(n).astype(np.float32)
    bands=[(30,250),(250,800),(800,2500),(2500,6000),(6000,min(12000,sr/2))]
    power=np.zeros(len(freq));chroma=np.zeros(12);flux=[];centroids=[];previous=None
    valid=(freq>=50)&(freq<=min(5000,sr/2));classes=np.round(69+12*np.log2(freq[valid]/440)).astype(int)%12
    for offset in range(0,len(x)-n+1,hop*256):
        stop=min(len(x),offset+hop*255+n)
        frames=np.lib.stride_tricks.sliding_window_view(x[offset:stop],n)[::hop]
        p=np.abs(np.fft.rfft(frames*window,axis=1))**2;power+=p.sum(axis=0)
        for k in range(12):chroma[k]+=p[:,valid][:,classes==k].sum()
        totals=p.sum(axis=1);centroids.extend((p@freq/np.maximum(totals,1e-20)).tolist())
        mag=np.sqrt(p);prev=np.vstack([previous if previous is not None else mag[0],mag[:-1]])
        flux.extend(np.maximum(mag-prev,0).sum(axis=1).tolist());previous=mag[-1]
    rms=float(np.sqrt(np.mean(x*x)));peak=float(np.max(np.abs(x)))
    silence=rms<1e-5
    timeline=[];block=max(1,round(sr*4))
    for i in range(0,len(x),block):
        seg=x[i:i+block];level=float(np.sqrt(np.mean(seg*seg)))
        timeline.append({'start':round(start+i/sr,2),'end':round(start+min(len(x),i+block)/sr,2),'rmsDbfs':round(20*math.log10(max(level,1e-10)),1)})
    envelope=np.asarray(flux,dtype=float);envelope-=envelope.mean();beats=[]
    if not silence and len(envelope)>100 and np.std(envelope)>1e-5:
        length=1<<(2*len(envelope)-1).bit_length();correlation=np.fft.irfft(np.abs(np.fft.rfft(envelope,n=length))**2,n=length)[:len(envelope)]
        correlation/=max(float(correlation[0]),1e-20);rate=sr/hop
        lo=max(1,round(rate*60/200));hi=min(len(correlation)-2,round(rate*60/55));peaks=[i for i in range(lo,hi+1) if correlation[i]>=correlation[i-1] and correlation[i]>=correlation[i+1]]
        for i in sorted(peaks,key=lambda k:correlation[k],reverse=True)[:3]:
            if correlation[i]>.03:beats.append({'bpm':round(rate*60/i,1),'periodicity':round(float(correlation[i]),3)})
    major=np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]);minor=np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]);keys=[]
    if not silence and np.std(chroma)>1e-12:
        for mode,profile in [('major',major),('minor',minor)]:
            for root in range(12):keys.append({'root':['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][root],'mode':mode,'profileCorrelation':round(float(np.corrcoef(chroma,np.roll(profile,root))[0,1]),3)})
        keys.sort(key=lambda k:k['profileCorrelation'],reverse=True)
    total=max(float(power.sum()),1e-20);band_energy=[{'hz':[lo,hi],'fraction':round(float(power[(freq>=lo)&(freq<hi)].sum()/total),4)} for lo,hi in bands]
    return {'status':'measured','sampleRate':sr,'rmsDbfs':round(20*math.log10(max(rms,1e-10)),2),'samplePeakDbfs':round(20*math.log10(max(peak,1e-10)),2),'clippedSamples':int(np.sum(np.abs(x)>=.9999)),'spectralCentroidHz':round(float(np.mean(centroids)),1),'bandEnergy':band_energy,'energyTimeline':timeline,'beatCandidates':beats,'keyCandidates':keys[:3],'keyAmbiguous':len(keys)<2 or keys[0]['profileCorrelation']-keys[1]['profileCorrelation']<.12,'limits':['拍速是周期性候选，存在半速/倍速歧义，不是已确认节拍','调性是频谱模板候选，混音/打击乐/短片段可能不适用；分数不是概率','音频图和测量不能确定乐器、情绪、歌词、创作者意图；可以表达明确标为个人联想的感受','16位重采样的采样峰值不是母带真峰值；没有执行分轨或乐器模型']}
