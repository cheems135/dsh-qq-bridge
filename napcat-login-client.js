import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';

const digest = value => createHash('sha256').update(value).digest('hex');
const phases = new Set(['waiting_qrcode', 'generating_qrcode', 'qrcode_scanned', 'initializing', 'ready', 'reconnecting', 'offline']);

export class NapCatLoginError extends Error {
  constructor(code, message) { super(message); this.name = 'NapCatLoginError'; this.code = code; }
}

function error(code, message) { return new NapCatLoginError(code, message); }
function address(host) {
  const raw = String(host || '::').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (['::', '0.0.0.0', 'localhost', '127.0.0.1'].includes(raw)) return '127.0.0.1';
  if (raw === '::1') return '[::1]';
  throw error('REMOTE_WEBUI', '仅支持本机 NapCat WebUI，请在远程设备的 NapCat 中扫码。');
}
function qrUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 8192) return '';
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value : ''; } catch { return ''; }
}
function businessError(value) {
  const message = String(value || '');
  if (/Unauthorized|Authorization Failed|not initialized|token.*invalid/i.test(message)) return error('AUTH_EXPIRED', 'NapCat WebUI 登录凭证已失效。');
  if (/Logined/i.test(message)) return error('ALREADY_LOGGED_IN', 'QQ 已登录，无需再次扫码。');
  if (/restarting|RESTARTING/i.test(message)) return error('RECONNECTING', 'QQ 登录服务正在重连，请稍后重试。');
  if (/Refresh Error|刷新超时|未接受二维码/.test(message)) return error('QR_REFRESH_FAILED', 'QQ 尚未生成新的二维码，请稍后重试或打开 NapCat 检查登录状态。');
  if (/QRCode Get Error/i.test(message)) return error('QR_NOT_READY', 'QQ 尚未生成二维码，请先启动 NapCat 并稍后重试。');
  return error('API_REJECTED', 'NapCat 未接受登录请求，请在 NapCat 中检查登录状态。');
}

export function localJsonRequest({ url, body, headers, timeoutMs, tls }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (!['127.0.0.1', '[::1]'].includes(parsed.hostname) || !['http:', 'https:'].includes(parsed.protocol)) {
      reject(error('REMOTE_WEBUI', '拒绝向非本机地址发送 NapCat 登录信息。')); return;
    }
    const data = Buffer.from(JSON.stringify(body || {}));
    let settled = false;
    let request;
    const finish = (err, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (err) { request?.destroy(); reject(err); } else resolve(value);
    };
    const timer = setTimeout(() => finish(error('WEBUI_TIMEOUT', 'NapCat WebUI 响应超时，请检查登录进程。')), timeoutMs);
    timer.unref?.();
    try {
      request = (parsed.protocol === 'https:' ? https : http).request(parsed, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, ...headers },
        // Trust only the local certificate. Its host name may identify a LAN domain;
        // the request is fixed to a loopback IP and is never redirected.
        ...(tls?.ca ? { ca: tls.ca, checkServerIdentity: () => undefined } : {}),
      }, response => {
        if (response.statusCode !== 200) { response.resume(); finish(error('WEBUI_HTTP', 'NapCat WebUI 返回异常状态。')); return; }
        let size = 0; const chunks = [];
        response.on('data', chunk => { size += chunk.length; if (size > 262144) finish(error('WEBUI_RESPONSE_SIZE', 'NapCat WebUI 响应过大。')); else chunks.push(chunk); });
        response.on('error', () => finish(error('WEBUI_UNAVAILABLE', '无法读取 NapCat WebUI 响应。')));
        response.on('end', () => {
          if (settled) return;
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { finish(error('WEBUI_JSON', 'NapCat WebUI 返回了无效数据。')); }
        });
      });
      request.once('error', () => finish(error('WEBUI_UNAVAILABLE', '无法连接本机 NapCat WebUI，请先启动 NapCat。')));
      request.end(data);
    } catch { finish(error('WEBUI_UNAVAILABLE', '无法连接本机 NapCat WebUI，请先启动 NapCat。')); }
  });
}

/** No network or configuration is touched until a public method is invoked.
 * Credentials are kept in this closure only, never returned or written to disk.
 * Tests can inject every filesystem, time and network dependency.
 */
export function createNapCatLoginClient({ napcatDir, workDir = napcatDir, readFile = readFileSync, exists = existsSync, transport = localJsonRequest, now = Date.now } = {}) {
  if (!napcatDir || !workDir) throw new TypeError('napcatDir is required');
  let cached = null;
  let pending = null;
  const load = () => {
    let settings;
    try { settings = JSON.parse(String(readFile(join(workDir, 'config', 'webui.json'), 'utf8'))); }
    catch { throw error('WEBUI_CONFIG', '无法读取本机 NapCat WebUI 配置，请检查安装目录。'); }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw error('WEBUI_CONFIG', 'NapCat WebUI 配置格式无效。');
    if (settings.disableWebUI === true) throw error('WEBUI_DISABLED', 'NapCat WebUI 已关闭，无法在插件中刷新二维码。');
    const host = address(settings.host);
    const port = Number(settings.port ?? 6099);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw error('WEBUI_CONFIG', 'NapCat WebUI 端口无效。');
    const cert = join(workDir, 'config', 'cert.pem');
    const secure = exists(cert) && exists(join(workDir, 'config', 'key.pem'));
    const base = (secure ? 'https://' : 'http://') + host + ':' + port;
    const token = typeof settings.token === 'string' ? settings.token : '';
    if (!token) throw error('WEBUI_TOKEN', 'NapCat WebUI 未配置登录令牌。');
    if (settings.enable2FA === true) throw error('WEBUI_2FA', 'NapCat WebUI 启用了双因素验证，请打开 NapCat WebUI 完成验证后扫码。');
    let ca;
    if (secure) { try { ca = readFile(cert); } catch { throw error('WEBUI_CERT', '无法读取本机 NapCat WebUI 证书。'); } }
    return { base, hash: digest(token + '.napcat'), tls: secure ? { ca } : undefined };
  };
  const invoke = async (settings, route, body, credential, timeoutMs) => {
    let reply;
    try { reply = await transport({ url: settings.base + '/api/' + route, body, headers: credential ? { Authorization: 'Bearer ' + credential } : {}, timeoutMs, tls: settings.tls }); }
    catch (err) { if (err instanceof NapCatLoginError) throw err; throw error('WEBUI_UNAVAILABLE', '无法连接本机 NapCat WebUI，请先启动 NapCat。'); }
    if (!reply || typeof reply !== 'object' || reply.code !== 0) throw businessError(reply?.message);
    return reply.data;
  };
  const authenticate = async settings => {
    const key = settings.base + '|' + settings.hash;
    if (cached?.key === key && cached.expires > now()) return cached.credential;
    if (pending?.key === key) return pending.promise;
    const promise = invoke(settings, 'auth/login', { hash: settings.hash }, '', 4500).then(data => {
      if (data?.require2FA) throw error('WEBUI_2FA', 'NapCat WebUI 需要双因素验证，请在 NapCat WebUI 完成验证。');
      if (typeof data?.Credential !== 'string' || !data.Credential || data.Credential.length > 32768) throw error('WEBUI_AUTH', 'NapCat WebUI 未返回有效登录凭证。');
      cached = { key, credential: data.Credential, expires: now() + 50 * 60000 };
      return data.Credential;
    }).finally(() => { if (pending?.promise === promise) pending = null; });
    pending = { key, promise }; return promise;
  };
  const call = async (route, body = {}, timeoutMs = 4500) => {
    const settings = load();
    for (let attempt = 0; attempt < 2; attempt++) {
      const credential = await authenticate(settings);
      try { return await invoke(settings, 'QQLogin/' + route, body, credential, timeoutMs); }
      catch (err) { if (err.code !== 'AUTH_EXPIRED' || attempt) throw err; cached = null; }
    }
  };
  return Object.freeze({
    async getStatus() {
      const data = await call('CheckLoginStatus');
      if (!data || typeof data.isLogin !== 'boolean') throw error('WEBUI_STATUS', 'NapCat 返回了无效登录状态。');
      return { isLogin: data.isLogin, isOffline: data.isOffline === true, loginPhase: phases.has(data.loginPhase) ? data.loginPhase : 'offline', qrLoginAccepted: data.qrLoginAccepted === true, coreReady: data.coreReady === true, qrcodeurl: qrUrl(data.qrcodeurl), hasLoginError: !!data.loginError };
    },
    async getQRCode() { const data = await call('GetQQLoginQrcode'); const url = qrUrl(data?.qrcode); if (!url) throw error('QR_NOT_READY', 'QQ 尚未生成有效二维码。'); return { qrcodeurl: url }; },
    async refreshQR() {
      const data = await call('RefreshQRcode', {}, 14500);
      if (data?.restarting === true) return { qrcodeurl: '', restarting: true };
      const url = qrUrl(data?.qrcodeurl);
      if (!url) throw error('QR_NOT_READY', 'QQ 尚未返回新的二维码。');
      return { qrcodeurl: url, restarting: false };
    },
    async getQuickLoginList() { const data = await call('GetQuickLoginList'); return Array.isArray(data) ? data.map(String).filter(x => /^\d{5,12}$/.test(x)).slice(0, 30) : []; },
    async setQuickLogin(uin) { const id = String(uin || ''); if (!/^\d{5,12}$/.test(id)) throw error('ACCOUNT_INVALID', 'QQ 账号格式无效。'); await call('SetQuickLogin', { uin: id }, 14500); return { requested: true }; },
    clear() { cached = null; },
  });
}
