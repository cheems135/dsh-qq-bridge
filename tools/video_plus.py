"""QQ adapter for video-watch-plus (MIT). No account cookies or chat data are read."""
import math
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "video-watch-plus"


def run(args, timeout=90, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, timeout=timeout,
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), **kwargs)


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def normalize(text):
    # The upstream hallucination checker uses the same punctuation-insensitive comparison.
    return "".join(c for c in text.lower() if c.isalnum())


def verified_segments(segments, duration, voice_input=False):
    rows, suspicious = [], []
    for s in segments:
        value = {"start": round(float(s.start), 2), "end": round(float(s.end), 2),
                 "text": str(s.text).strip(), "noSpeech": float(s.no_speech_prob)}
        # VAD has already selected speech. Short voiced messages sometimes
        # receive a high no-speech score despite good decoder confidence.
        confident_voice = (voice_input and value["noSpeech"] < .9
                           and float(getattr(s, 'avg_logprob', -math.inf)) > -.6
                           and 0 < float(getattr(s, 'compression_ratio', math.inf)) < 2.0)
        if not value["text"] or value["start"] < 0 or value["end"] <= value["start"] or value["end"] > duration + 1 or (value["noSpeech"] >= .6 and not confident_voice):
            continue
        duplicate = next((r for r in rows if normalize(r["text"]) == normalize(value["text"])
                          and r["end"] <= value["start"]), None)
        if duplicate:
            suspicious.append(value)
            suspicious.append(duplicate)
        rows.append(value)
    bad = {(r["start"], r["end"]) for r in suspicious}
    return [r for r in rows if (r["start"], r["end"]) not in bad], len(bad)


def main(req):
    runtime, directory = req["runtime"], Path(req["outDir"]).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    ffmpeg, ffprobe = runtime["ffmpegPath"], runtime["ffprobePath"]
    media = req.get("media")
    if not media:
        from urllib.parse import urlparse
        url = req.get("url", "")
        u = urlparse(url)
        domains = {"bilibili.com", "www.bilibili.com", "b23.tv", "douyin.com", "www.douyin.com", "v.douyin.com", "kuaishou.com", "www.kuaishou.com", "v.kuaishou.com"}
        if u.scheme != "https" or u.hostname not in domains or u.username or u.password or u.port:
            raise ValueError("仅从明确支持的视频平台读取公开视频链接")
        cache = Path(req.get("cacheDir") or (directory / "media-cache"))
        cache.mkdir(parents=True, exist_ok=True)
        key = hashlib.sha256(url.encode("utf-8")).hexdigest()[:24]
        cached = next((p for p in cache.glob(key + ".*") if p.is_file() and p.suffix.lower() in {".mp4", ".webm", ".mkv", ".mov"} and 0 < p.stat().st_size <= 128 * 1024 * 1024), None)
        if cached:
            media = str(cached)
        else:
            import yt_dlp
            options = {"outtmpl": str(cache / (key + ".%(ext)s")), "noplaylist": True,
                       "format": "best[height<=720][ext=mp4]/best[height<=720]", "quiet": True,
                       "no_warnings": True, "socket_timeout": 12, "retries": 1,
                       "max_filesize": 128 * 1024 * 1024, "ffmpeg_location": str(Path(ffmpeg).parent),
                       "match_filter": lambda info, **kw: "视频超过15分钟" if (info.get("duration") or 0) > 900 else None}
            with yt_dlp.YoutubeDL(options) as dl:
                info = dl.extract_info(url, download=False)
                if info.get("is_live") or info.get("_type") in ("playlist", "multi_video"):
                    raise ValueError("暂不自动读取直播或合集")
                if not info.get("duration") or info["duration"] > 900:
                    raise ValueError("目前读取15分钟以内的单个视频")
                info = dl.process_ie_result(info, download=True)
                media = dl.prepare_filename(info)
            try:
                for old in sorted((p for p in cache.glob("*") if p.suffix.lower() in {".mp4", ".webm", ".mkv", ".mov"}), key=lambda p: p.stat().st_mtime, reverse=True)[6:]:
                    old.unlink()
            except OSError:
                pass
    media = str(Path(media).resolve())
    metadata = json.loads(run([ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", media], 15).stdout)
    duration = float(metadata["format"]["duration"])
    if duration <= 0 or duration > 900 or Path(media).stat().st_size > 128 * 1024 * 1024:
        raise ValueError("视频为空、超过128MB或超过15分钟")
    if req.get("resolveOnly") is True:
        return {"media": media, "duration": duration, "status": "resolved"}
    config = directory / "vw.config.json"
    config.write_text(json.dumps({"ffmpeg": ffmpeg, "ffprobe": ffprobe,
                                 "magick": runtime.get("magickPath", ""), "font": runtime.get("fontPath", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")}), encoding="utf-8")
    probe = run([sys.executable, str(VENDOR / "vendor/vw.py"), "--config", str(config),
                 "probe", media, "--out", str(directory)], 100)
    timeline = json.loads((directory / "timeline.json").read_text(encoding="utf-8"))
    video_stream = next(s for s in metadata["streams"] if s.get("codec_type") == "video")
    visual_duration = min(duration, float(video_stream.get("duration") or duration))
    start = max(0.0, min(float(req.get("start") or 0), max(0.0, visual_duration - .25)))
    window_seconds = max(0.0, float(req.get("window") or 0))
    if window_seconds > 0:
        end = min(visual_duration - .25, start + window_seconds)
        if end <= start:
            end = min(visual_duration - .25, start + .5)
    else:
        start = 0.0
        end = max(0, visual_duration - .25)
    count = min(12, max(4, int(req.get("maxFrames", 8))))
    points = min(6, max(2, count))
    skeleton = [start + (end - start) * i / (points - 1) for i in range(points)]
    cuts = [min(end, max(start, float(t) + .12)) for t in timeline.get("cuts", []) if start - .2 <= float(t) <= end + .2]
    times = sorted(set(round(max(start, min(end, t)), 3) for t in skeleton + cuts[:max(0, count-len(skeleton))]))[:count]
    frames = []
    for i, at in enumerate(times):
        frame = directory / ("frame-%02d.jpg" % i)
        run([ffmpeg, "-v", "error", "-protocol_whitelist", "file,pipe", "-ss", str(at), "-i", media,
             "-frames:v", "1", "-vf", "scale=1280:1280:force_original_aspect_ratio=decrease",
             "-q:v", "3", "-threads", "1", "-y", str(frame)], 12)
        frames.append({"at": at, "file": frame.name})
    audio_start = start if window_seconds > 0 else 0.0
    audio_limit = window_seconds if window_seconds > 0 else 180.0
    covered = max(0.0, min(audio_limit, duration - audio_start))
    audio = {"status": "no_track", "segments": [], "coveredSeconds": round(covered, 2), "partial": audio_start + covered < duration - .5, "start": round(audio_start, 2)}
    if covered > .2 and any(s.get("codec_type") == "audio" for s in metadata.get("streams", [])):
        try:
            wav = directory / "speech.wav"
            run([ffmpeg, "-v", "error", "-protocol_whitelist", "file,pipe", "-ss", str(audio_start), "-i", media, "-t", str(covered),
                 "-vn", "-ac", "1", "-ar", "16000", "-y", str(wav)], 25)
            acoustic = load("video_plus_acoustic", VENDOR / "scripts/audio_probe.py")
            features = acoustic.features(acoustic.decode_mono(str(wav), ffmpeg))
            verdict = acoustic.verdict(features)
            audio = {"status": "unknown", "acoustic": verdict, "segments": [],
                     "coveredSeconds": round(covered, 2), "partial": audio_start + covered < duration - .5, "start": round(audio_start, 2), "suspiciousSegments": 0}
            if "静音" in verdict["kind"] or "纯音" in verdict["kind"] or "器乐/音乐为主" in verdict["kind"]:
                audio["status"] = "no_verified_speech"
            else:
                try:
                    if runtime.get("mobile") is True or runtime.get("allowWhisper") is False:
                        raise RuntimeError("Local speech inference is disabled for this device")
                    if not runtime.get("whisperModelPath"):
                        raise RuntimeError("Local speech inference is disabled for this device")
                    from faster_whisper import WhisperModel
                    model = WhisperModel(runtime["whisperModelPath"], device="cpu", compute_type="int8", cpu_threads=int(runtime.get("whisperThreads", 2)),
                                         local_files_only=True)
                    segments, _ = model.transcribe(str(wav), language="zh", beam_size=3, vad_filter=True,
                                                   condition_on_previous_text=False)
                    rows, suspect = verified_segments(segments, covered)
                    for row in rows:
                        row["start"] = round(row["start"] + audio_start, 2)
                        row["end"] = round(row["end"] + audio_start, 2)
                    audio.update(status="transcribed" if rows else "no_verified_speech", segments=rows,
                                 suspiciousSegments=suspect)
                except Exception:
                    audio.update(status="unavailable", error="本地语音转写未成功，不代表音轨无人说话")
        except Exception:
            # Video frames remain valid evidence even when optional audio decoding
            # or speech analysis is unavailable. Do not expose codec details.
            audio = {"status": "unavailable", "segments": [],
                     "coveredSeconds": round(covered, 2), "partial": audio_start + covered < duration - .5, "start": round(audio_start, 2),
                     "error": "本地音轨分析未成功，不代表音轨无人说话"}
    return {"duration": duration, "frames": frames, "audio": audio, "audioDecoded": audio["status"] not in {"no_track", "unavailable"},
            "status": "sampled", "cuts": timeline.get("cuts", []), "source": "video-watch-plus-local",
            "window": {"start": round(start, 2), "end": round(end, 2), "requested": window_seconds > 0}}


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        result = main(request)
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    except Exception:
        # yt-dlp and codec errors may contain signed URLs or browser details.
        print(json.dumps({"ok": False, "error": "未取得可解码视频或分析超时；该来源可能需要登录或暂不支持"}, ensure_ascii=False))
        sys.exit(1)
