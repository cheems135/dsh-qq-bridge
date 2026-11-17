"""场景声学后处理：JSON 进 JSON 出。用 WORLD 改谱包络，实现鼻音、反共振、闷、辅音吃掉。
不联网、不需要模型；输入输出都是本地文件。"""
import json, math, subprocess, sys, os
import numpy as np
import soundfile as sf
import pyworld as pw

FS = 24000
PERIOD = 5.0

def decode(path, ffmpeg='ffmpeg'):
    p = subprocess.run([ffmpeg, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(FS), '-f', 'f32le', 'pipe:1'],
                       capture_output=True)
    if p.returncode or not p.stdout:
        raise ValueError('音频解码失败')
    return np.ascontiguousarray(np.frombuffer(p.stdout, dtype='<f4').astype(np.float64))

def run(req):
    src = req.get('input'); dst = req.get('output'); fx = req.get('fx') or {}
    if not src or not dst or not os.path.isfile(src):
        raise ValueError('需要有效的输入与输出路径')
    if not dst.endswith('.wav'):
        raise ValueError('输出必须是 wav')
    x = decode(src, req.get('ffmpegPath') or 'ffmpeg')
    if len(x) < FS * 0.2:
        raise ValueError('音频太短，无法做场景处理')
    f0, t = pw.harvest(x, FS, 65., 1000., PERIOD)
    f0 = pw.stonemask(x, f0, t, FS)
    sp = pw.cheaptrick(x, f0, t, FS)
    ap = pw.d4c(x, f0, t, FS)
    voiced_ratio = float((f0 > 0).mean()) if len(f0) else 0.
    # 有声帧太少（大量气口/静音）时，整形会把噪声放大成怪音，直接放弃处理
    if voiced_ratio < 0.35:
        return {'ok': False, 'error': '有声帧只占 %.0f%%，处理会把气口放大，跳过' % (voiced_ratio * 100)}
    freqs = np.linspace(0, FS / 2, sp.shape[1])

    gain = np.ones_like(freqs)
    pole = fx.get('pole')            # [中心Hz, 强度]
    if pole:
        gain *= 1 + float(pole[1]) * np.exp(-((freqs - float(pole[0])) / (float(pole[0]) * 0.42)) ** 2)
    for center, depth in (fx.get('anti') or []):
        gain *= 1 - float(depth) * np.exp(-((freqs - float(center)) / (float(center) * 0.24)) ** 2)
    cutoff = fx.get('cutoff')
    if cutoff:
        gain *= 1 / (1 + (freqs / float(cutoff)) ** 1.3)
    sp = sp * gain[None, :]

    smooth = int(fx.get('formantSmooth') or 0)   # 震动被限制：谱包络时间平滑帧数
    if smooth > 1:
        pad = np.pad(sp, ((smooth // 2, smooth // 2), (0, 0)), mode='edge')
        sp = np.array([pad[i:i + smooth].mean(axis=0) for i in range(sp.shape[0])])

    consonant = fx.get('consonant') or 0         # 辅音帧高频砍掉的比例
    if consonant and fx.get('consonantCutoff'):
        hf = 1 / (1 + (freqs / float(fx['consonantCutoff'])) ** 2)
        for i in np.flatnonzero(f0 <= 0):
            sp[i] *= hf * (1 - float(consonant) * 0.5)
    breath = fx.get('breath') or 0
    if breath:
        ap = np.clip(ap * (1 + float(breath)), 0.02, 1.0)

    y = pw.synthesize(np.ascontiguousarray(f0), np.ascontiguousarray(sp), np.ascontiguousarray(ap), FS, PERIOD)
    y = np.ascontiguousarray(y[:len(x)])
    peak = float(np.abs(y).max()) or 1.0
    y = np.tanh(y / (peak * 1.25)) * 0.89
    sf.write(dst, y, FS, subtype='PCM_16')
    return {'ok': True, 'status': 'processed', 'file': dst, 'duration': round(len(y) / FS, 3),
            'fx': list(fx.keys()), 'note': '按场景参数整形谱包络与辅音帧；不改变台词与音高走向'}

if __name__ == '__main__':
    try:
        result = run(json.load(sys.stdin))
    except Exception as e:
        result = {'ok': False, 'error': str(e)[:300]}
    print(json.dumps(result, ensure_ascii=False))
