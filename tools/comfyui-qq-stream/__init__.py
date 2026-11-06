"""Opt-in token adapter for QQ bridge. Manual Qwen TE prompts are unchanged."""
import contextvars
import functools
import re
import sys
import threading
import time
from aiohttp import web
from server import PromptServer
import nodes

NODE_CLASS_MAPPINGS = {}
_nonce = contextvars.ContextVar('qq_bridge_stream', default=None)
_jobs = {}
_lock = threading.Lock()
_pattern = re.compile(r'^\d{13}-qqs-[a-f0-9-]{36}$')

def _prune():
    now = time.monotonic()
    for key in list(_jobs):
        if now - _jobs[key]['at'] > 180:
            del _jobs[key]
    while len(_jobs) > 32:
        del _jobs[next(iter(_jobs))]

def _append(key, text):
    if not isinstance(text, str) or not text:
        return
    with _lock:
        row = _jobs.get(key)
        if row and len(row['text']) + len(text) <= 64000:
            row['text'] += text
            row['at'] = time.monotonic()

def _collect(call, llm, *, messages, params):
    key = _nonce.get()
    if not key:
        return call(llm, messages=messages, params=params)
    result = call(llm, messages=messages, params={**params, 'stream': True})
    if isinstance(result, dict):
        _append(key, result.get('choices', [{}])[0].get('message', {}).get('content', ''))
        return result
    chunks = []
    try:
        for chunk in result:
            delta = chunk.get('choices', [{}])[0].get('delta', {}).get('content', '')
            if isinstance(delta, str):
                chunks.append(delta)
                _append(key, delta)
    finally:
        close = getattr(result, 'close', None)
        if close:
            close()
    return {'choices': [{'message': {'role': 'assistant', 'content': ''.join(chunks)}, 'finish_reason': 'stop'}]}

def _ensure_hook():
    cls = nodes.NODE_CLASS_MAPPINGS.get('QwenTE_MultiTurnChat')
    if cls is None:
        return False
    if getattr(cls.run, '_qq_stream_adapter', False):
        return True
    module = sys.modules.get(cls.__module__)
    if module is None or not hasattr(module, '_调用chat_completion'):
        return False
    original_call = module._调用chat_completion
    module._调用chat_completion = functools.partial(_collect, original_call)
    original_run = cls.run

    @functools.wraps(original_run)
    def run(self, *args, **kwargs):
        key = kwargs.get('请求ID', args[3] if len(args) > 3 else '')
        if not isinstance(key, str) or not _pattern.fullmatch(key) or kwargs.get('skill加载器'):
            return original_run(self, *args, **kwargs)
        with _lock:
            _prune()
            _jobs[key] = {'text': '', 'done': False, 'at': time.monotonic()}
        token = _nonce.set(key)
        try:
            return original_run(self, *args, **kwargs)
        finally:
            _nonce.reset(token)
            with _lock:
                if key in _jobs:
                    _jobs[key]['done'] = True
                    _jobs[key]['at'] = time.monotonic()

    run._qq_stream_adapter = True
    cls.run = run
    return True

@PromptServer.instance.routes.get('/qq_bridge/stream/health')
async def health(request):
    return web.json_response({'ok': True, 'version': 1, 'available': _ensure_hook()}, headers={'Cache-Control': 'no-store'})

@PromptServer.instance.routes.get('/qq_bridge/stream/{nonce}')
async def progress(request):
    key = request.match_info['nonce']
    if not _pattern.fullmatch(key):
        return web.json_response({'error': 'invalid stream id'}, status=400)
    try:
        after = max(0, min(64000, int(request.query.get('after', 0))))
    except ValueError:
        return web.json_response({'error': 'invalid offset'}, status=400)
    with _lock:
        _prune()
        row = _jobs.get(key)
        value = {'text': row['text'][after:], 'offset': len(row['text']), 'done': row['done']} if row else {'text': '', 'offset': after, 'done': False}
    return web.json_response(value, headers={'Cache-Control': 'no-store'})

def _on_prompt(value):
    _ensure_hook()
    return value

PromptServer.instance.add_on_prompt_handler(_on_prompt)
