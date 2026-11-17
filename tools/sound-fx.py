"""场景音效处理器：台词音频 + 场景名 -> 带环境声的成品。
输入 JSON：{input, output, scene, fx?, layers?[], ffmpegPath?}
只做本地合成，不联网、不取样，也不改台词内容。"""
import json, math, subprocess, sys, os
from pathlib import Path
import numpy as np, soundfile as sf, pyworld as pw
from numpy.fft import rfft, irfft, rfftfreq

FS = 24000
PERIOD = 5.0
FF = 'ffmpeg'

def decode(path):
    p = subprocess.run([FF, '-v', 'error', '-i', path, '-ac', '1', '-ar', str(FS), '-f', 'f32le', 'pipe:1'],
                       capture_output=True)
    if p.returncode or not p.stdout:
        raise ValueError('音频解码失败')
    return np.ascontiguousarray(np.frombuffer(p.stdout, dtype='<f4').astype(np.float64))

def filt(sig, gain_fn):
    S = rfft(sig); f = rfftfreq(len(sig), 1 / FS)
    return irfft(S * gain_fn(f), n=len(sig))

def reverb(sig, rt60, wet=0.3, pre=0.01, seed=7):
    rng = np.random.default_rng(seed)
    n = int(rt60 * FS); t = np.arange(n) / FS
    ir = rng.normal(0, 1, n) * np.exp(-6.9 * t / rt60)
    ir = filt(ir, lambda f: 1 / (1 + (f / 3500) ** 2))
    ir /= max(1e-9, np.abs(ir).max())
    ir = np.concatenate([np.zeros(int(pre * FS)), ir])
    wet_sig = np.convolve(sig, ir)[:len(sig) + len(ir)]
    wet_sig /= max(1e-9, np.abs(wet_sig).max())
    out = np.zeros(max(len(sig), len(wet_sig)))
    out[:len(sig)] += sig
    out[:len(wet_sig)] += wet_sig * wet * np.abs(sig).max()
    return out

def fabric(n, level=0.04, seed=3):
    """被子/布料摩擦：带通噪声 + 慢速起伏"""
    rng = np.random.default_rng(seed)
    x = rng.normal(0, 1, n)
    x = filt(x, lambda f: np.exp(-((np.log(np.maximum(f, 20)) - np.log(900)) ** 2) / 0.9))
    t = np.arange(n) / FS
    env = 0.5 + 0.5 * np.sin(2 * np.pi * 0.7 * t) * np.sin(2 * np.pi * 0.23 * t + 1)
    return x / max(1e-9, np.abs(x).max()) * env * level

def roomtone(n, level=0.006, seed=5):
    rng = np.random.default_rng(seed)
    x = rng.normal(0, 1, n)
    x = filt(x, lambda f: 1 / (1 + (f / 500) ** 2.2))
    return x / max(1e-9, np.abs(x).max()) * level

def bubbles(n, count=18, level=0.05, seed=11):
    rng = np.random.default_rng(seed)
    out = np.zeros(n)
    for _ in range(count):
        i = int(rng.integers(0, max(1, n - 500))); d = int(rng.integers(120, 400))
        t = np.arange(d) / FS; f = rng.uniform(250, 800)
        out[i:i + d] += np.sin(2 * np.pi * f * t * (1 + 3 * t)) * np.exp(-t * 30) * level
    return out

def eq_only(x, fx):
    """只做频响整形，不重合成：没有 WORLD 二次声码器，所以不带电音"""
    fr = np.linspace(0, FS / 2, len(x) // 2 + 1)
    gain = np.ones_like(fr)
    pole = fx.get('pole')
    if pole:
        gain *= 1 + float(pole[1]) * np.exp(-((fr - float(pole[0])) / (float(pole[0]) * .5)) ** 2)
    for c, d in (fx.get('anti') or []):
        gain *= 1 - float(d) * np.exp(-((fr - float(c)) / (float(c) * .3)) ** 2)
    if fx.get('highpass'):
        gain *= 1 / (1 + (float(fx['highpass']) / np.maximum(fr, 1)) ** 2.2)
    if fx.get('cutoff'):
        gain *= 1 / (1 + (fr / float(fx['cutoff'])) ** 1.3)
    S = rfft(x)
    return irfft(S * gain, n=len(x)), {'shaped': True, 'method': 'eq-only'}

def shape(x, fx, method='world'):
    """谱包络造型；有声帧太少就跳过（避免把气口放大成怪声）"""
    f0, t = pw.harvest(x, FS, 65., 1000., PERIOD); f0 = pw.stonemask(x, f0, t, FS)
    if float((f0 > 0).mean()) < 0.35:
        return x, {'shaped': False, 'reason': '有声帧不足 35%'}
    sp = pw.cheaptrick(x, f0, t, FS); ap = pw.d4c(x, f0, t, FS)
    fr = np.linspace(0, FS / 2, sp.shape[1]); gain = np.ones_like(fr)
    pole = fx.get('pole')
    if pole:
        gain *= 1 + float(pole[1]) * np.exp(-((fr - float(pole[0])) / (float(pole[0]) * .42)) ** 2)
    for c, d in (fx.get('anti') or []):
        gain *= 1 - float(d) * np.exp(-((fr - float(c)) / (float(c) * .24)) ** 2)
    if fx.get('highpass'):
        gain *= 1 / (1 + (float(fx['highpass']) / np.maximum(fr, 1)) ** 2.2)
    if fx.get('cutoff'):
        gain *= 1 / (1 + (fr / float(fx['cutoff'])) ** 1.3)
    sp = sp * gain[None, :]
    smooth = int(fx.get('formantSmooth') or 0)
    if smooth > 1:
        pad = np.pad(sp, ((smooth // 2, smooth // 2), (0, 0)), mode='edge')
        sp = np.array([pad[i:i + smooth].mean(axis=0) for i in range(sp.shape[0])])
    if fx.get('consonant') and fx.get('consonantCutoff'):
        hf = 1 / (1 + (fr / float(fx['consonantCutoff'])) ** 2)
        for i in np.flatnonzero(f0 <= 0):
            sp[i] *= hf * (1 - float(fx['consonant']) * .5)
    if fx.get('breath'):
        ap = np.clip(ap * (1 + float(fx['breath'])), .02, 1.)
    y = pw.synthesize(np.ascontiguousarray(f0), np.ascontiguousarray(sp), np.ascontiguousarray(ap), FS, PERIOD)
    return np.ascontiguousarray(y[:len(x)]), {'shaped': True, 'voicedRatio': round(float((f0 > 0).mean()), 3)}


def wet_squelch(dur=0.05, level=0.12, seed=0):
    """湿声：参考真实录音（soundgasm 三条，90 秒）实测——
    事件极短（0.03–0.06 秒）、密度 1.4–4 次/秒、而且**是亮的**（2.5kHz 以上占 10–24%）。
    以前做成 0.14 秒的闷「咕噜」，方向是反的。"""
    rng = np.random.default_rng(seed); n = max(64, int(dur * FS)); t = np.arange(n) / FS
    # 主体：1–3kHz 的短促负压爆
    burst = rng.normal(0, 1, n) * np.exp(-t * 120)
    burst = filt(burst, lambda f: np.exp(-((np.log(np.maximum(f, 30)) - np.log(1800)) ** 2) / 0.9))
    burst = burst / max(1e-9, np.abs(burst).max())
    # 低频底：一点口腔共鸣，别太多
    body = rng.normal(0, 1, n) * np.exp(-t * 90)
    body = filt(body, lambda f: 1 / (1 + (f / 500) ** 2))
    body = body / max(1e-9, np.abs(body).max()) * 0.35
    y = burst + body
    return y / max(1e-9, np.abs(y).max()) * level

def suck(dur=0.36, level=0.16, seed=1):
    """吸吮：按 velaric ingressive 的实际过程做——舌后与软腭先闭合形成腔体，
    舌体下降使腔内压降低（吸入段），最后前部闭合释放，进气形成一声短爆。
    所以爆音在末尾，不在开头。"""
    rng = np.random.default_rng(seed); n = int(dur * FS); t = np.arange(n) / FS
    # 吸入段：管内负压，气流方向向内，听感是逐渐变亮、变紧的窄带噪声
    pull = rng.normal(0, 1, n) * np.exp(-((t - dur * 0.45) ** 2) / (2 * (dur * 0.3) ** 2))
    pull = filt(pull, lambda f: np.exp(-((np.log(np.maximum(f, 30)) - np.log(900)) ** 2) / 0.9))
    pull *= (0.5 + 0.5 * np.clip(t / dur, 0, 1))
    # 释放段：20ms 宽带的“啵”，能量集中在最后
    pop_n = int(0.022 * FS); pop = np.zeros(n)
    pt = np.arange(pop_n) / FS
    burst = rng.normal(0, 1, pop_n) * np.exp(-pt * 220)
    burst = filt(burst, lambda f: (f / 1800) ** 1.1 / (1 + (f / 1800) ** 2))
    pop[n - pop_n:] = burst / max(1e-9, np.abs(burst).max())
    y = 0.55 * pull / max(1e-9, np.abs(pull).max()) + 0.9 * pop
    return y * level

def slap(dur=0.22, level=0.22, seed=2):
    """拍打：极短高频瞬态 + 低频冲击，之后一点皮肤余响"""
    rng = np.random.default_rng(seed); n = int(dur * FS); t = np.arange(n) / FS
    crack = rng.normal(0, 1, n) * np.exp(-t * 180)
    crack = filt(crack, lambda f: (f / 2200) ** 1.2 / (1 + (f / 2200) ** 2))
    body = np.sin(2 * np.pi * 95 * t) * np.exp(-t * 26)
    y = 0.7 * crack / max(1e-9, np.abs(crack).max()) + 0.6 * body
    return y * level

def breath(dur, level=0.06, rate=5.0, tier=2, seed=3):
    """急促换气：参考素材实测每 0.20–0.26 秒一次。
    tier 控制气声强弱（对应 H1-H2）：1≈10dB 绷紧、2≈14dB、3≈17dB 最漏气。"""
    rng = np.random.default_rng(seed); n = int(dur * FS); t = np.arange(n) / FS
    # 用余弦形包络而不是正弦尖峰：之前 5Hz 的尖峰听起来像一声声「咳」
    env = (0.5 - 0.5 * np.cos(2 * np.pi * rate * t)) ** 0.8
    x = rng.normal(0, 1, n) * env
    # 档位越高，高频保留越多、整体越“漏气”
    hi = {1: 800, 2: 1200, 3: 1900}[int(np.clip(tier, 1, 3))]
    x = filt(x, lambda f: np.exp(-((np.log(np.maximum(f, 30)) - np.log(hi)) ** 2) / 1.5))
    gain = {1: 0.75, 2: 1.0, 3: 1.35}[int(np.clip(tier, 1, 3))]
    return x / max(1e-9, np.abs(x).max()) * level * gain


def squelch(dur=0.5, level=0.09, seed=4):
    """粘稠挤压：低速频率调制的水声，比 wet 长"""
    rng = np.random.default_rng(seed); n = int(dur * FS); t = np.arange(n) / FS
    x = rng.normal(0, 1, n)
    x = filt(x, lambda f: np.exp(-((np.log(np.maximum(f, 30)) - np.log(900)) ** 2) / 1.2))
    mod = 0.4 + 0.6 * np.abs(np.sin(2 * np.pi * (3 + 2 * t) * t))
    env = np.minimum(1, t / .05) * np.exp(-t * 3)
    return x / max(1e-9, np.abs(x).max()) * env * mod * level

def react(dest, at, dur=0.32, depth=0.55, seed=0):
    """拍打后的身体反应：先被压下去的 90ms，然后回上来，尾巴带一点房间"""
    i = max(0, int(at * FS)); m = min(int(dur * FS), len(dest) - i)
    if m <= 10: return
    t = np.arange(m) / FS
    env = np.where(t < 0.09, 1 - depth * (t / 0.09), (1 - depth) + depth * np.clip((t - 0.09) / 0.18, 0, 1))
    dest[i:i + m] *= env
    tail = dest[i:i + m] * 0.14
    d = int(0.06 * FS)
    if i + m + d < len(dest): dest[i + m:i + m + d] += tail[-d:] * np.linspace(1, 0, d)


def swallow(dur=0.34, level=0.14, seed=0):
    """吞咽：文献里吞咽声主频约 690Hz、时长零点几秒；前段喉部抬升的低频隆起，末尾一声轻爆"""
    rng = np.random.default_rng(seed); n = int(dur * FS); t = np.arange(n) / FS
    body = rng.normal(0, 1, n) * np.exp(-((t - dur * 0.4) ** 2) / (2 * (dur * 0.22) ** 2))
    body = filt(body, lambda f: np.exp(-((np.log(np.maximum(f, 30)) - np.log(690)) ** 2) / 0.55))
    body = body / max(1e-9, np.abs(body).max())
    tail_n = int(0.03 * FS); tt = np.arange(tail_n) / FS
    tail = np.sin(2 * np.pi * 320 * tt) * np.exp(-tt * 90) * 0.35
    y = np.zeros(n); y += body
    y[n - tail_n:] += tail
    return y * level


def kisssuck(dur=0.28, level=0.13, seed=0):
    """亲嘴那种吸吮：唇对唇含住 → 口腔轻微负压 → 分开时「啵」一声，尾音带湿。
    比吞吐的吸吮慢、软，能量更低更闷。"""
    rng = np.random.default_rng(seed); n = int(dur * FS); t = np.arange(n) / FS
    # 含住：很轻的摩擦，低频偏重
    hold = rng.normal(0, 1, n) * np.sin(np.pi * np.clip(t / dur, 0, 1)) ** 0.7
    hold = filt(hold, lambda f: 1 / (1 + (f / 1400) ** 2))
    hold = hold / max(1e-9, np.abs(hold).max()) * 0.45
    # 分开：颏部小爆音 + 唇部湿尾
    pop_n = int(0.035 * FS); tt = np.arange(pop_n) / FS
    pop = np.sin(2 * np.pi * 260 * tt) * np.exp(-tt * 70) * 0.9
    pop += rng.normal(0, 1, pop_n) * np.exp(-tt * 120) * 0.35
    pop = filt(pop, lambda f: 1 / (1 + (f / 2600) ** 1.4))
    y = hold.copy(); y[n - pop_n:] += pop
    wet_n = int(0.05 * FS); wt = np.arange(wet_n) / FS
    wet = rng.normal(0, 1, wet_n) * np.exp(-wt * 40) * 0.18
    wet = filt(wet, lambda f: np.exp(-((np.log(np.maximum(f, 30)) - np.log(1200)) ** 2) / 0.9))
    y = np.concatenate([y, wet])
    return y / max(1e-9, np.abs(y).max()) * level


def wind(n, level=0.055, seed=0):
    """户外风：极低频为主、缓慢起伏。雨是宽带沙沙声，风不是——风要闷、要慢。"""
    rng = np.random.default_rng(seed)
    x = rng.normal(0, 1, n)
    # 只留 60–500Hz 的主体，1.5k 以上几乎清空
    x = filt(x, lambda f: 1 / (1 + (f / 300) ** 3.2))
    t = np.arange(n) / FS
    # 两个不同周期的慢起伏，避免节奏感
    gust = 0.35 + 0.65 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.07 * t + 0.6)) * (0.55 + 0.45 * np.sin(2 * np.pi * 0.019 * t + 2.1))
    body = x / max(1e-9, np.abs(x).max()) * gust
    # 一点极低频胸腔感
    rumble = np.sin(2 * np.pi * 48 * t) * 0.12 * gust
    y = body + rumble
    return y / max(1e-9, np.abs(y).max()) * level

def cabin(n, level=0.03, seed=1):
    """车内：极低频发动机嗡声 + 微弱胎噪"""
    rng = np.random.default_rng(seed)
    t = np.arange(n) / FS
    rumble = np.sin(2 * np.pi * 42 * t) * 0.5 + np.sin(2 * np.pi * 63 * t) * 0.3
    tire = filt(rng.normal(0, 1, n), lambda f: 1 / (1 + (f / 600) ** 2))
    y = rumble + tire / max(1e-9, np.abs(tire).max()) * 0.5
    return y / max(1e-9, np.abs(y).max()) * level

def rain(n, level=0.16, seed=0, heavy=0.5):
    """雨：宽带的沙沙（雨幕）+ 随机雨滴 + 低频水汽。
    heavy 越大，雨滴越密、低频越厚。"""
    rng = np.random.default_rng(seed)
    t = np.arange(n) / FS
    # 雨幕：宽带偏中高，缓慢起伏
    hiss = rng.normal(0, 1, n)
    hiss = filt(hiss, lambda f: (1 / (1 + (140 / np.maximum(f, 20)) ** 2)) / (1 + (f / 7500) ** 1.2))
    hiss = hiss / max(1e-9, np.abs(hiss).max())
    swell = 0.75 + 0.25 * np.sin(2 * np.pi * 0.06 * t + 1.3)
    # 低频水汽
    body = filt(rng.normal(0, 1, n), lambda f: 1 / (1 + (f / 220) ** 2.4))
    body = body / max(1e-9, np.abs(body).max()) * (0.35 + 0.4 * heavy)
    # 雨滴：短促高频 tick
    drops = np.zeros(n)
    count = int(n / FS * (14 + 26 * heavy))
    for _ in range(count):
        i = int(rng.integers(0, max(1, n - 400))); d = int(rng.integers(60, 200))
        tt = np.arange(d) / FS
        drops[i:i + d] += rng.normal(0, 1, d) * np.exp(-tt * 260) * rng.uniform(0.3, 1.0)
    drops = filt(drops, lambda f: (f / 2500) ** 1.6 / (1 + (f / 2500) ** 2))
    drops = drops / max(1e-9, np.abs(drops).max()) * (0.25 + 0.35 * heavy)
    y = hiss * swell * 0.8 + body + drops
    return y / max(1e-9, np.abs(y).max()) * level

def windcall(n, level=0.12, seed=0):
    """骑车通话的风噪：麦克风被气流直吹——持续的风啸 + 阵风拍麦的低频冲击，
    再被电话带宽削过，所以听起来是「呼——呼——」叠着爆音。"""
    rng = np.random.default_rng(seed)
    t = np.arange(n) / FS
    # 持续风啸：宽带但偏中低，带慢速起伏
    roar = rng.normal(0, 1, n)
    roar = filt(roar, lambda f: 1 / (1 + (f / 1200) ** 1.6))
    roar = roar / max(1e-9, np.abs(roar).max())
    gust = 0.4 + 0.6 * np.clip(np.sin(2 * np.pi * 0.35 * t + 0.4) * np.sin(2 * np.pi * 0.11 * t + 1.7), 0, 1)
    body = roar * gust
    # 阵风拍麦：低频「噗」，不规则，1 秒 2–5 次
    hits = np.zeros(n)
    pos = 0
    while pos < n:
        gap = int(rng.uniform(0.18, 0.5) * FS)
        dur = int(rng.uniform(0.05, 0.12) * FS)
        tt = np.arange(dur) / FS
        hits[pos:pos + dur] += (rng.normal(0, 1, dur) * np.exp(-tt * 35)) * rng.uniform(0.5, 1.0)
        pos += gap + dur
    hits = filt(hits, lambda f: 1 / (1 + (f / 600) ** 2))
    hits = hits / max(1e-9, np.abs(hits).max()) * 0.55
    y = body + hits
    return y / max(1e-9, np.abs(y).max()) * level

def drown(n, level=0.14, seed=0):
    """溺水：声音被水吃掉（强低通）＋气泡上浮＋水体涌动＋偶尔的压力闷响。
    气泡是上浮的，所以频率往上走；这是和「冒泡玩具」的区别。"""
    rng = np.random.default_rng(seed)
    t = np.arange(n) / FS
    # 水体：低沉的涌动，慢速调制
    body = rng.normal(0, 1, n)
    body = filt(body, lambda f: 1 / (1 + (f / 300) ** 2.6))
    body = body / max(1e-9, np.abs(body).max())
    swirl = 0.55 + 0.45 * np.sin(2 * np.pi * 0.23 * t + 0.9) * np.sin(2 * np.pi * 0.07 * t + 2.4)
    # 气泡：数量多、单个短，音高上扫
    bub = np.zeros(n)
    for _ in range(int(n / FS * 22)):
        i = int(rng.integers(0, max(1, n - 900))); d = int(rng.uniform(0.02, 0.09) * FS)
        tt = np.arange(d) / FS
        f0 = rng.uniform(220, 480); sweep = rng.uniform(1.6, 3.2)
        bub[i:i + d] += np.sin(2 * np.pi * f0 * (1 + sweep * tt) * tt) * np.exp(-tt * 45) * rng.uniform(0.3, 1.0)
    bub = filt(bub, lambda f: 1 / (1 + (f / 1400) ** 2))
    bub = bub / max(1e-9, np.abs(bub).max()) * 0.5
    # 压力：低频闷响，像水压挤耳朵
    press = np.zeros(n); pos = 0
    while pos < n:
        pos += int(rng.uniform(0.8, 1.8) * FS)
        d = int(0.16 * FS)
        if pos + d >= n: break
        tt = np.arange(d) / FS
        press[pos:pos + d] += np.sin(2 * np.pi * 52 * tt) * np.exp(-tt * 12) * 0.5
    y = body * swirl * 0.9 + bub + press
    return y / max(1e-9, np.abs(y).max()) * level
_BREATH_RATE=[5.0];_BREATH_TIER=[2]


def wetbed(n, rate=2.6, level=0.16, seed=0):
    """湿声床：按参考实测的密度（1.4–4 次/秒）连续撒短促亮湿声。
    单个 0.03–0.06 秒，中心 1.8kHz，2.5kHz 以上必须有能量。"""
    rng = np.random.default_rng(seed)
    y = np.zeros(n); t = 0.0
    while True:
        t += rng.exponential(1.0 / max(rate, 0.2))
        i = int(t * FS)
        if i >= n: break
        d = int(rng.uniform(0.03, 0.06) * FS); tt = np.arange(d) / FS
        burst = rng.normal(0, 1, d) * np.exp(-tt * rng.uniform(90, 140))
        burst = filt(burst, lambda f: np.exp(-((np.log(np.maximum(f, 30)) - np.log(rng.uniform(1500, 2200))) ** 2) / 0.9))
        burst /= max(1e-9, np.abs(burst).max())
        body = np.sin(2 * np.pi * rng.uniform(180, 320) * tt) * np.exp(-tt * 70) * 0.25
        e = (burst + body) * rng.uniform(0.5, 1.0)
        m = min(d, n - i); y[i:i + m] += e[:m]
    return y / max(1e-9, np.abs(y).max()) * level

SAMPLE_DIR = str(Path(__file__).resolve().parent.parent / 'assets' / 'sfx-samples')

def real_wet(n, rate=2.4, level=0.5, seed=0, dir_=None):
    """真实湿声层：直接铺从参考录音里切出来的样本（assets/sfx-samples/*.wav）。
    合成再怎么调也做不出唾液那种黏，样本才像。"""
    import glob
    d = dir_ or SAMPLE_DIR
    files = sorted(glob.glob(d + '/*.wav'))
    if not files: return np.zeros(n)
    rng = np.random.default_rng(seed)
    y = np.zeros(n); t = 0.0
    import subprocess as _sp
    cache = {}
    def load(f):
        if f not in cache:
            import soundfile as _sf
            a, sr = _sf.read(f, dtype='float64')
            if sr != FS:
                raw = _sp.run(['ffmpeg','-v','error','-i',f,'-ac','1','-ar',str(FS),'-f','f32le','pipe:1'],capture_output=True).stdout
                a = np.frombuffer(raw, dtype='<f4').astype(np.float64)
            cache[f] = np.ascontiguousarray(a.mean(axis=1) if a.ndim > 1 else a)
        return cache[f]
    while True:
        t += rng.exponential(1.0 / max(rate, 0.2))
        i = int(t * FS)
        if i >= n: break
        e = load(files[int(rng.integers(0, len(files)))]) * rng.uniform(0.35, 1.0)
        m = min(len(e), n - i); y[i:i + m] += e[:m]
    peak = float(np.abs(y).max()) or 1.0
    return y / peak * level
def place(layer, dest, n, at, dur, seed):
    """把事件放到时间轴上的指定位置，越界自动裁"""
    if layer == 'wet': e = wet_squelch(dur, seed=seed)
    elif layer == 'suck': e = suck(max(dur, .3), seed=seed)
    elif layer == 'slap': e = slap(seed=seed)
    elif layer == 'squelch': e = squelch(max(dur, .4), seed=seed)
    elif layer == 'breath': e = breath(max(dur, .5), seed=seed, rate=float(_BREATH_RATE[0]), tier=int(_BREATH_TIER[0]))
    elif layer == 'swallow': e = swallow(seed=seed)
    elif layer == 'kisssuck': e = kisssuck(seed=seed)
    else: return
    i = max(0, min(n - 1, int(at * FS)))
    m = min(len(e), n - i)
    dest[i:i + m] += e[:m]

def gaps(x, min_sil=0.12):
    """找出台词里的静音段，用来自然落点"""
    win = int(FS * 0.02); pad = np.pad(np.abs(x), (0, (-len(x)) % win))
    rms = np.sqrt(np.mean(pad.reshape(-1, win) ** 2, axis=1))
    thr = max(rms.max() * 0.08, 1e-4); out = []; i = 0
    while i < len(rms):
        if rms[i] < thr:
            j = i
            while j < len(rms) and rms[j] < thr: j += 1
            if (j - i) * 0.02 >= min_sil: out.append(((i + j) / 2 * 0.02, (j - i) * 0.02))
            i = j
        else: i += 1
    return out


def add_layer(x, y):
    """叠加环境层：长度不一致时对齐到较长的那个，避免广播错误"""
    if len(y) > len(x): x = np.pad(x, (0, len(y) - len(x)))
    elif len(y) < len(x): y = np.pad(y, (0, len(x) - len(y)))
    return x + y

def run(req):
    global FF
    FF = req.get('ffmpegPath') or 'ffmpeg'
    src, dst, scene = req.get('input'), req.get('output'), req.get('scene') or '口含'
    if not src or not os.path.isfile(src): raise ValueError('输入音频不存在')
    if not dst or not dst.endswith('.wav'): raise ValueError('输出必须是 wav')
    x = decode(src)
    fx = req.get('fx') or {}
    report = {'scene': scene}
    if fx:
        method = req.get('method') or 'world'
        x, rep = (eq_only(x, fx) if method == 'filter' else shape(x, fx)); report.update(rep)
    layers = req.get('layers') or []
    _BREATH_RATE[0]=float(req.get('breathRate') or 5.0);_BREATH_TIER[0]=int(req.get('breathTier') or 2)
    n = len(x)
    # 事件层：湿声/吸吮/拍打/粘稠/喘，默认落在台词的静音段，位置按开口前/后区分
    events = req.get('events') or []
    if events:
        slot = gaps(x, min_sil=float(req.get('minSilence') or 0.12))
        for idx, ev in enumerate(events):
            name = ev.get('layer') or 'wet'
            at = ev.get('at')
            if at is None:
                spread = float(ev.get('spread') or 0.5)
                if slot:
                    g = slot[min(len(slot) - 1, int(idx * spread) % max(1, len(slot)))]
                    at = g[0] + g[1] * (0.15 + 0.7 * ((idx * 0.37) % 1))
                else:
                    at = (idx + 1) * 0.6
            place(name, x, n, float(at), float(ev.get('dur') or 0.2), seed=100 + idx)
        report['events'] = len(events)
    for idx, rc in enumerate(req.get('react') or []):
        react(x, float(rc.get('at') or 0.6), float(rc.get('dur') or 0.32), float(rc.get('depth') or 0.55), seed=200 + idx)
    if 'fabric' in layers: x = add_layer(x, fabric(n))
    if 'roomtone' in layers: x = add_layer(x, roomtone(n))
    if 'bubbles' in layers: x = add_layer(x, bubbles(n))
    if 'wind' in layers: x = add_layer(x, wind(n))
    if 'realwet' in layers: x = add_layer(x, real_wet(n, rate=float(req.get('wetRate') or 2.4), level=float(req.get('wetLevel') or 0.5)))
    if 'wetbed' in layers: x = add_layer(x, wetbed(n, rate=float(req.get('wetRate') or 2.6), level=float(req.get('wetLevel') or 0.16)))
    if 'breath' in layers: x = add_layer(x, breath(n/FS, level=0.055, rate=float(_BREATH_RATE[0]), tier=int(_BREATH_TIER[0])))
    if 'drown' in layers: x = add_layer(x, drown(n, level=float(req.get('drownLevel') or 0.14)))
    if 'windcall' in layers: x = add_layer(x, windcall(n, level=float(req.get('windLevel') or 0.12)))
    if 'rain' in layers: x = add_layer(x, rain(n, level=float(req.get('rainLevel') or 0.16), heavy=float(req.get('rainHeavy') or 0.5)))
    if 'room' in layers:
        rt = float(req.get('rt60') or .5); x = reverb(x, rt, wet=float(req.get('wet') or .3))
    peak = float(np.abs(x).max()) or 1.
    x = np.tanh(x / (peak * 1.25)) * .89
    sf.write(dst, x, FS, subtype='PCM_16')
    report.update({'ok': True, 'file': dst, 'duration': round(len(x) / FS, 3), 'layers': layers, 'fx': list(fx.keys())})
    S = np.abs(rfft(x)); f = rfftfreq(len(x), 1 / FS)
    band = lambda lo, hi: float((S[(f >= lo) & (f < hi)] ** 2).sum())
    tot = max(band(20, 11000), 1e-9)
    report['bands'] = {'200-400': round(band(200, 400) / tot * 100, 1),
                       '800-1200': round(band(800, 1200) / tot * 100, 1),
                       '2500+': round(band(2500, 8000) / tot * 100, 2)}
    return report

if __name__ == '__main__':
    try:
        out = run(json.load(sys.stdin))
    except Exception as e:
        out = {'ok': False, 'error': str(e)[:300]}
    print(json.dumps(out, ensure_ascii=False))
