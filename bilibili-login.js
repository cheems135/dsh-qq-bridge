const COOKIE_KEYS = ['SESSDATA', 'bili_jct', 'DedeUserID', 'buvid3'];
const PASSPORT_HOSTS = new Set(['passport.bilibili.com', 'passport.biligame.com']);
const CALLBACK_HOSTS = new Set([...PASSPORT_HOSTS, 'www.bilibili.com', 'bilibili.com']);
const CALLBACK_PATHS = new Set(['/crossDomain', '/x/passport-login/web/crossDomain']);
export const BILI_BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function cookieValue(value, key) {
  const text = String(value || '').replace(/^"(.*)"$/, '$1');
  return text.length <= 8192 && !(key==='SESSDATA'?/[\s;\r\n]/:/[\s;,\r\n]/).test(text) ? text : '';
}

export function loginCookies(headers) {
  const result = {};
  const separate = headers?.getSetCookie?.();
  const rows = separate?.length ? separate : [headers?.get?.('set-cookie') || ''];
  for (const row of rows) {
    for (const match of row.matchAll(/(?:^|[,;])\s*(SESSDATA|bili_jct|DedeUserID|buvid3)=([^;]*?)(?=;|,\s*(?:SESSDATA|bili_jct|DedeUserID|buvid3)=|$)/g)) {
      const value = cookieValue(match[2], match[1]);
      if (value) result[match[1]] = value;
    }
  }
  return result;
}

export const completeBiliCredential = value => !!(value?.SESSDATA && value?.bili_jct && /^\d+$/.test(value?.DedeUserID || ''));

function callbackUrl(value, base) {
  let url;
  try { url = new URL(value, base); } catch { throw Error('B站扫码回调地址无效，请重新申请二维码'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || !CALLBACK_HOSTS.has(url.hostname)) throw Error('B站扫码回调地址不在允许范围');
  return url;
}

/** Resolve both legacy query-cookie and modern crossDomain ticket responses.
 * Keep redirects manual: cookies often arrive on the very first 302 response.
 * Never forward an existing account cookie or contact a URL from gourl.
 */
export async function resolveBiliQrCredential({response, url: rawUrl, fetchImpl = fetch, signal} = {}) {
  let credential = loginCookies(response?.headers);
  let url = rawUrl ? callbackUrl(rawUrl) : null;
  if (url) {
    for (const key of COOKIE_KEYS) {
      const value = cookieValue(url.searchParams.get(key),key);
      if (value && !credential[key]) credential[key] = value;
    }
  }
  if (completeBiliCredential(credential)) return credential;
  const visited = new Set();
  for (let hop = 0; url && hop < 4; hop++) {
    if (!PASSPORT_HOSTS.has(url.hostname) || !CALLBACK_PATHS.has(url.pathname) || visited.has(url.href)) break;
    visited.add(url.href);
    const scoped = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    let result;
    try {
      result = await fetchImpl(url.href, {method:'GET', redirect:'manual', headers:{'user-agent':BILI_BROWSER_UA, referer:'https://www.bilibili.com/'}, signal:scoped});
    } catch (error) {
      signal?.throwIfAborted();
      throw Error('B站登录票据交换未完成，请重新扫码；原登录已保留');
    }
    const next = result.headers?.get?.('location');
    credential = {...credential, ...loginCookies(result.headers)};
    try { await result.body?.cancel?.(); } catch {}
    signal?.throwIfAborted();
    if (result.status >= 200 && result.status < 400 && completeBiliCredential(credential)) return credential;
    if (![301,302,303,307,308].includes(result.status) || !next) break;
    url = callbackUrl(next, url);
  }
  throw Error('扫码确认后未取得完整登录凭据，请重新扫码；原登录已保留');
}
