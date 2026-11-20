import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import wave

spec = importlib.util.spec_from_file_location('video_plus', Path(__file__).resolve().parents[1] / 'tools/video_plus.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def segment(start=0, end=1, text='你好，再说一次', prob=.1, logprob=-.2, compression=1.1):
    return SimpleNamespace(start=start, end=end, text=text, no_speech_prob=prob, avg_logprob=logprob, compression_ratio=compression)

rows, rejected = module.verified_segments([segment(), segment(start=1, end=2)], 3)
assert len(rows) == 2 and rejected == 0, 'real confident repetitions must survive'
rows, rejected = module.verified_segments([segment(logprob=-1), segment(start=1, end=2, logprob=-1)], 3)
assert not rows and rejected == 2, 'weak repeated candidates remain suspect'
for invalid in [segment(prob=float('nan')), segment(start=float('inf')), segment(prob=-.1), segment(end=0)]:
    assert module.verified_segments([invalid], 3) == ([], 1)

calls = []
class Model:
    def __init__(self, *args, **kwargs):
        assert kwargs['device'] == 'cpu' and kwargs['compute_type'] == 'int8'
        calls.append('model')
    def transcribe(self, *args, **kwargs):
        assert kwargs['vad_filter'] is True
        calls.append('vad-asr')
        return iter([segment()]), None
sys.modules['faster_whisper'] = SimpleNamespace(WhisperModel=Model)
module.load = lambda *a: SimpleNamespace(features=lambda x: {}, decode_mono=lambda *a: [], verdict=lambda x: {'kind': '纯音/提示音（非语音、非音乐）'})
with tempfile.TemporaryDirectory(prefix='audio-evidence-') as folder:
    directory = Path(folder)
    media = directory / 'fixture.mp4'
    media.write_bytes(b'fixture')
    def run(args, *a, **kwargs):
        if 'probe' in args:
            (directory / 'timeline.json').write_text('{"cuts":[]}', encoding='utf-8')
        return SimpleNamespace(stdout=json.dumps({'format': {'duration': '3'}, 'streams': [{'codec_type': 'video'}, {'codec_type': 'audio'}]}))
    module.run = run
    req = {'runtime': {'ffmpegPath': 'fixture', 'ffprobePath': 'fixture', 'videoPlusPythonPath': 'fixture', 'whisperModelPath': 'fixture'}, 'outDir': folder, 'media': str(media)}
    result = module.main(req)
    assert calls == ['model', 'vad-asr'], 'acoustic heuristic must not veto VAD/ASR'
    assert result['audio']['status'] == 'transcribed'
    assert result['audio']['crossCheck']['speechCandidateCount'] == 1
    calls.clear()
    req['runtime']['mobile'] = True
    assert module.main(req)['audio']['status'] == 'unavailable'
    assert calls == [], 'mobile must never run local ASR'

    spec = importlib.util.spec_from_file_location('audio_inspect', Path(__file__).resolve().parents[1] / 'tools/audio-inspect.py')
    inspect = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(inspect)
    def run_audio(args, *unused):
        if args[0] == 'ffprobe':
            return SimpleNamespace(stdout=json.dumps({'format': {'duration': '3'}, 'streams': [{'codec_type': 'audio'}]}))
        with wave.open(args[-1], 'wb') as wav:
            wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            wav.writeframes(b'\x40\x20' * 16000)
    def optional_audio_dependency(*unused):
        raise SystemExit('requires NumPy')
    inspect.run = run_audio
    inspect.load = optional_audio_dependency
    sound = inspect.main({'runtime':{'ffmpegPath':'ffmpeg','ffprobePath':'ffprobe','allowSoundEvents':False},
                          'file':str(media),'cacheDir':folder,'start':0,'end':3,'videoSound':True})
    assert sound['ok'] and sound['end'] == 1
    assert sound['acoustic']['confidence'] == 'level-only'
print('PASS: confident repeats, weak repeats, malformed segments, acoustic conflict, CPU-only VAD, and mobile PCM without NumPy')
