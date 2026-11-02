"""Local score-controlled vocoding; JSON in/out, never downloads models/audio.

The score controls voiced f0 and duration. WORLD spectral envelope/aperiodicity
come from the actual current-voice syllable recording. This is an experimental
resynthesis, not a trained singing voice or a promise of professional quality.
"""
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import numpy as np
import soundfile as sf
import pyworld as pw

FS = 24000
PERIOD = 5.0

class AlignmentRequired(Exception):
    def __init__(self, reason, **details):
        super().__init__(reason)
        self.details = details

def audio_read(filename, ffmpeg=''):
    try:
        x, fs = sf.read(filename, dtype='float64', always_2d=True)
        x = x.mean(axis=1)
        if fs == FS:
            return np.ascontiguousarray(x)
    except (RuntimeError, sf.LibsndfileError):
        pass
    if not ffmpeg:
        raise ValueError('源音频不是24kHz WAV；请配置FFmpeg解码当前音色样本')
    proc = subprocess.run([str(ffmpeg), '-v', 'error', '-i', str(filename), '-ac', '1', '-ar', str(FS), '-f', 'f32le', 'pipe:1'],
                          capture_output=True, timeout=60, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if proc.returncode:
        raise ValueError('当前音色样本解码失败')
    return np.ascontiguousarray(np.frombuffer(proc.stdout, dtype='<f4').astype(np.float64))

def energy_segments(x):
    width = int(FS * .01)
    padded = np.pad(x, (0, (-len(x)) % width))
    rms = np.sqrt(np.mean(padded.reshape(-1, width) ** 2, axis=1))
    if not len(rms) or float(rms.max()) < .0001:
        raise AlignmentRequired('样本中没有可用语音')
    threshold = max(float(rms.max()) * .075, .0008)
    intervals = []
    for i in np.flatnonzero(rms >= threshold):
        t = i * .01
        if intervals and t - intervals[-1][1] <= .11:
            intervals[-1][1] = t + .01
        else:
            intervals.append([t, t + .01])
    intervals = [[max(0., a-.025), min(len(x)/FS, b+.035)] for a, b in intervals if b-a >= .075]
    return intervals

def align(x, labels, supplied=None):
    if supplied:
        if not isinstance(supplied, list):
            raise AlignmentRequired('逐字对齐格式无效')
        found = {}
        previous = -1.
        for row in supplied:
            label = str(row.get('lyric', row.get('text', '')))
            a, b = float(row.get('start', -1)), float(row.get('end', -1))
            if not label or a < 0 or b <= a or b > len(x)/FS + .02 or a < previous:
                raise AlignmentRequired('逐字示范的时间边界不正确')
            if b-a < .07 or b-a > 8:
                raise AlignmentRequired('每个字的示范应在0.07至8秒以内')
            previous = b
            found.setdefault(label, (a, b))
        missing = [s for s in labels if s not in found]
        if missing:
            raise AlignmentRequired('逐字示范缺少所需歌词', missing=missing)
        return found, 'owner-or-provider-timestamps'
    segments = energy_segments(x)
    if len(segments) != len(labels):
        raise AlignmentRequired('逐字停顿未可靠分开，请校正每个字的开始和结束时间', expected=len(labels), detected=len(segments), detectedSegments=segments)
    return dict(zip(labels, segments)), 'strict-energy-pauses'

def interpolate(matrix, position):
    left = np.floor(position).astype(int)
    right = np.minimum(left+1, len(matrix)-1)
    mix = position-left
    return matrix[left]*(1-mix[:, None])+matrix[right]*mix[:, None]

def decompose(sample):
    sample = np.ascontiguousarray(sample, dtype=np.float64)
    f0, times = pw.harvest(sample, FS, f0_floor=65., f0_ceil=1000., frame_period=PERIOD)
    f0 = pw.stonemask(sample, f0, times, FS)
    voiced = np.flatnonzero(f0 > 0)
    if len(voiced) < 3:
        alternate, alternate_times = pw.dio(sample, FS, f0_floor=65., f0_ceil=1000., frame_period=PERIOD)
        alternate = pw.stonemask(sample, alternate, alternate_times, FS)
        if np.count_nonzero(alternate) > len(voiced):
            f0, times = alternate, alternate_times
            voiced = np.flatnonzero(f0 > 0)
    if len(voiced) < 3:
        raise AlignmentRequired('这个字没有足够可辨认的有声段，请提供清晰的单字示范')
    sp = pw.cheaptrick(sample, f0, times, FS)
    ap = pw.d4c(sample, f0, times, FS)
    return f0, sp, ap

def stretch_positions(f0, frames):
    voiced = np.flatnonzero(f0 > 0)
    first, last = int(voiced[0]), int(voiced[-1])
    # Keep consonant attack/tail short; stretch the voiced center to the beat.
    attack = min(first, max(1, int(frames*.18)), 24)
    tail = min(len(f0)-1-last, max(1, int(frames*.12)), 16)
    if first >= last or attack+tail+2 >= frames:
        return np.linspace(0, len(f0)-1, frames)
    return np.interp(np.arange(frames), [0, attack, frames-1-tail, frames-1], [0, first, last, len(f0)-1])

def render(args):
    source = Path(str(args.get('sourceFile', '')))
    target = Path(str(args.get('outputFile', '')))
    if not source.is_file() or not target.is_absolute() or target.suffix.lower() != '.wav':
        raise ValueError('需要有效的本地源音频与绝对WAV输出路径')
    tempo = float(args.get('tempo', 96))
    score = args.get('score', [])
    if not 30 <= tempo <= 240 or not isinstance(score, list) or not 1 <= len(score) <= 200:
        raise ValueError('歌谱速度或音符数量不正确')
    labels = args.get('sampleLyrics') or list(dict.fromkeys(str(n.get('lyric', '')) for n in score if n.get('midi') is not None))
    if not isinstance(labels, list) or not labels or len(set(labels)) != len(labels):
        raise AlignmentRequired('样本歌词必须是按顺序录制的不重复单字列表')
    x = audio_read(source, args.get('ffmpegPath', ''))
    if not len(x) or len(x)/FS > 300:
        raise ValueError('源音频为空或超过5分钟')
    aligned, method = align(x, labels, args.get('alignment'))
    spectra, chunks, notes, offset = {}, [], [], 0
    for note in score:
        lyric, midi, beats = str(note.get('lyric', '')), note.get('midi'), float(note.get('beats', 0))
        if not .125 <= beats <= 16 or midi is not None and (not isinstance(midi, (int, float)) or not 36 <= midi <= 96):
            raise ValueError('音符的MIDI或时值不正确')
        duration = beats*60./tempo
        count = int(round(duration*FS))
        if offset+count > 90*FS:
            raise ValueError('一次按谱清唱最多90秒')
        if midi is None:
            y, hz = np.zeros(count), 0.
        else:
            if lyric not in aligned:
                raise AlignmentRequired('所需歌词没有对应单字示范', missing=[lyric])
            if lyric not in spectra:
                a, b = aligned[lyric]
                spectra[lyric] = decompose(x[int(a*FS):int(b*FS)])
            f0, sp, ap = spectra[lyric]
            frames = max(3, int(math.ceil(duration*1000/PERIOD))+1)
            positions = stretch_positions(f0, frames)
            voiced = f0[np.rint(positions).astype(int)] > 0
            hz = 440.*2.**((float(midi)-69.)/12.)
            target_f0 = np.where(voiced, hz, 0.).astype(np.float64)
            y = pw.synthesize(np.ascontiguousarray(target_f0), np.ascontiguousarray(interpolate(sp, positions)),
                              np.ascontiguousarray(interpolate(ap, positions)), FS, PERIOD)
            y = np.pad(y, (0, max(0, count-len(y))))[:count]
            fade = min(int(FS*.007), count//4)
            if fade:
                y[:fade] *= np.linspace(0, 1, fade)
                y[-fade:] *= np.linspace(1, 0, fade)
        chunks.append(y)
        notes.append({'lyric': lyric, 'midi': midi, 'targetHz': round(hz, 4), 'start': offset/FS, 'end': (offset+count)/FS, 'beats': beats})
        offset += count
    output = np.concatenate(chunks)
    peak = float(np.max(np.abs(output)))
    if peak < .00005:
        raise AlignmentRequired('重合成没有产生可用歌声，请更换清晰的示范')
    output *= min(1., .92/peak)
    checks = []
    for note in notes:
        if not note['targetHz']:
            continue
        a, b = int(note['start']*FS), int(note['end']*FS)
        pad = min(int(FS*.08), (b-a)//5)
        center = np.ascontiguousarray(output[a+pad:b-pad])
        measured, times = pw.dio(center, FS, f0_floor=65., f0_ceil=1000., frame_period=PERIOD)
        measured = pw.stonemask(center, measured, times, FS)
        voiced = measured[measured > 0]
        if len(voiced) >= 3:
            hz = float(np.median(voiced))
            checks.append({'lyric': note['lyric'], 'midi': note['midi'], 'measuredHz': round(hz, 3), 'errorCents': round(abs(1200*np.log2(hz/note['targetHz'])), 2)})
    pitched = sum(1 for n in notes if n['targetHz'])
    quality = {'verifiedNotes': len(checks), 'totalPitchedNotes': pitched, 'checks': checks,
               'status': 'needs-review' if any(c['errorCents'] > 80 for c in checks) else 'checked' if len(checks)==pitched else 'partial',
               'note': '独立DIO估计实际合成音频音高；无法测定的字不标记为已验证，仍需试听音色和咬字。'}
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(target.stem+'.tmp.wav')
    sf.write(str(temp), output, FS, subtype='PCM_16')
    os.replace(temp, target)
    return {'ok': True, 'status': 'rendered', 'file': str(target), 'sampleRate': FS, 'duration': len(output)/FS, 'notes': notes,
            'alignment': [{'lyric': s, 'start': aligned[s][0], 'end': aligned[s][1]} for s in labels], 'alignmentMethod': method,
            'method': 'WORLD-spectral-envelope-plus-score-f0', 'quality':quality, 'limitations': '实验性按谱重合成；音高和时值受谱约束，音色自然度、辅音与咬字需试听确认。'}

def main():
    try:
        data=json.load(sys.stdin)
        result=render(data)
    except AlignmentRequired as e:
        result={'ok':False,'status':'need-alignment','reason':str(e),**e.details}
    except Exception as e:
        result={'ok':False,'status':'failed','reason':str(e)[:400]}
    print(json.dumps(result,ensure_ascii=False))

if __name__=='__main__':
    main()
