// Post a QQ Zone 说说 through NapCat's local OneBot websocket.
const endpoint = new URL(process.env.NAPCAT_WS_URL || 'ws://127.0.0.1:3001');
if (process.env.NAPCAT_ACCESS_TOKEN) endpoint.searchParams.set('access_token', process.env.NAPCAT_ACCESS_TOKEN);
const text = process.argv.slice(2).join(' ').trim();
if (!text) { console.error('no text'); process.exit(1); }

const ws = new WebSocket(endpoint);
let seq = 0;
const pending = new Map();
const call = (action, params = {}) => new Promise((resolve, reject) => {
  const echo = 'e' + (++seq);
  pending.set(echo, { resolve, reject });
  ws.send(JSON.stringify({ action, params, echo }));
  setTimeout(() => { if (pending.has(echo)) { pending.delete(echo); reject(new Error('timeout ' + action)); } }, 15000);
});

ws.addEventListener('message', ({data: raw}) => {
  let msg;
  try { msg = JSON.parse(String(raw)); } catch { return; }
  const p = msg.echo && pending.get(msg.echo);
  if (!p) return;
  pending.delete(msg.echo);
  if (msg.status === 'failed' || msg.retcode !== 0) p.reject(new Error('napcat ' + msg.status + ' ' + msg.retcode + ' ' + (msg.wording || '')));
  else p.resolve(msg.data);
});
ws.addEventListener('error', (e) => { console.error('ws error', e.message); process.exit(1); });

ws.addEventListener('open', async () => {
  try {
    const cookies = await call('get_cookies', { domain: 'qzone.qq.com' });
    const csrf = await call('get_csrf_token', {});
    const cookieHeader = String(cookies?.cookies ?? '');
    const token = Number(csrf?.token ?? 0);
    if (!cookieHeader || !token) throw new Error('no cookie or token');
    const skey = (cookieHeader.match(/(?:^|;\s*)skey=([^;]+)/) || [])[1] || '';
    let hash = 5381;
    for (const ch of skey) hash += (hash << 5) + ch.charCodeAt(0);
    const bkn = (hash & 0x7fffffff) >>> 0;
    const login = await call('get_login_info', {});
    const uin = String(login?.user_id ?? '');
    const body = new URLSearchParams({
      syn_tweet_verson: '1', paramstr: '1', who: '1', con: text,
      feedversion: '1', ver: '1', ugc_right: '1', to_sign: '0',
      hostuin: uin, code_version: '1', format: 'json',
      qzreferrer: `https://user.qzone.qq.com/${uin}`,
    }).toString();
    const res = await fetch(`https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?g_tk=${bkn}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookieHeader,
        referer: `https://user.qzone.qq.com/${uin}`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
    const raw = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(raw.replace(/^[^{]*/, '')); } catch {}
    if (!res.ok) throw new Error('http ' + res.status + ' ' + raw.slice(0, 200));
    if (parsed && parsed.code !== undefined && Number(parsed.code) !== 0) throw new Error('code=' + parsed.code + ' ' + (parsed.message || ''));
    console.log('OK ' + raw.slice(0, 200));
  } catch (error) {
    console.error('FAIL ' + error.message);
    process.exitCode = 1;
  } finally {
    ws.close();
  }
});
