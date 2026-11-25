import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const route = '/im-bridge/self-profile/background';
const maxBytes = 8 * 1024 * 1024;
const supported = new Set(['image/png', 'image/jpeg', 'image/webp']);
const pngHeader = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const pngEnd = Buffer.from('0000000049454e44ae426082', 'hex');

function completeImage(bytes, mime, imageSize) {
  const size = imageSize(bytes, mime);
  if (!size?.width || !size.height || size.width > 16384 || size.height > 16384) return false;
  if (mime === 'image/png') {
    return bytes.length > 45 && bytes.subarray(0, 16).equals(pngHeader) &&
      bytes.subarray(-12).equals(pngEnd);
  }
  if (mime === 'image/jpeg') return bytes.readUInt16BE(bytes.length - 2) === 0xffd9;
  if (mime !== 'image/webp' || bytes.length < 25 || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
  let offset = 12;
  let hasImage = false;
  while (offset + 8 <= bytes.length) {
    const chunk = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    if (length > 0 && ['VP8 ', 'VP8L', 'ANMF'].includes(chunk)) hasImage = true;
    offset += 8 + length + (length & 1);
  }
  return hasImage && offset === bytes.length;
}

export function profileBackgroundScope(accountId, selfId) {
  if (typeof accountId !== 'string' || !/^\d{5,20}$/.test(String(selfId ?? ''))) return '';
  return createHash('sha256').update(JSON.stringify([accountId,String(selfId)])).digest('hex');
}

function backgroundPath(root, scope) {
  if (!/^[a-f0-9]{64}$/.test(scope)) throw new Error('无效的资料卡标识');
  return join(root, 'qq-profile-backgrounds', scope + '.image');
}

export function storedProfileBackgroundUrl(root, scope) {
  if (!scope) return '';
  try {
    const stat = statSync(backgroundPath(root, scope), {bigint:true});
    return stat.isFile() ? route+'?scope='+scope+'&v='+stat.mtimeNs+'-'+stat.size : '';
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

// Only this device's verified receiver may read or replace its original picture.
// The request carries an opaque guard, never a QQ number, source URL or disk path.
export function profileBackgroundRoute({getScope, getRoot, sniffImage, imageSize, jsonResponse}) {
  return {kind:'exact', path:route, handler(req, res) {
    const fail = (status, message) => jsonResponse(res,status,{error:message});
    const method = req.method;
    if (!['GET','POST','DELETE'].includes(method)) return fail(405,'不支持的资料卡操作');
    if (method !== 'GET' && req.headers['sec-fetch-site'] === 'cross-site') return fail(403,'拒绝跨站更改资料卡');
    if (method !== 'GET' && req.headers.origin) {
      try {
        const host = new URL((req.socket?.encrypted?'https://':'http://')+req.headers.host);
        if (new URL(req.headers.origin).origin !== host.origin) return fail(403,'拒绝跨站更改资料卡');
      } catch { return fail(403,'请求来源无效'); }
    }
    const initial = getScope();
    const scope = profileBackgroundScope(initial.accountId, initial.selfId);
    const expected = new URL(req.url, 'http://localhost').searchParams.get('scope');
    if (initial.state !== 'ready' || !scope || scope !== expected) return fail(409,'账号已改变或尚未连接，请重新打开资料卡');
    const root = getRoot();
    const file = backgroundPath(root, scope);
    const result = () => {
      const cardBackgroundUrl = storedProfileBackgroundUrl(root,scope);
      jsonResponse(res,200,{ok:true,cardBackgroundUrl,cardBackgroundSource:cardBackgroundUrl?'local':''});
    };
    try {
      if (method === 'GET') {
        const bytes = readFileSync(file);
        const mime = sniffImage(bytes);
        if (!supported.has(mime)) return fail(415,'缓存的背景不是受支持的图片');
        res.setHeader('Content-Type',mime);
        res.setHeader('Cache-Control','private, no-store');
        res.setHeader('X-Content-Type-Options','nosniff');
        res.setHeader('Cross-Origin-Resource-Policy','same-origin');
        res.statusCode=200;
        return res.end(bytes);
      }
      if (method === 'DELETE') {
        rmSync(file,{force:true});
        return result();
      }
    } catch (error) { return fail(error.code==='ENOENT'?404:500,'本机资料卡背景暂不可用'); }

    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!supported.has(mime) && mime !== 'application/octet-stream') return fail(415,'请选择 JPG、PNG 或 WebP 原图');
    const declaredSize = req.headers['content-length'];
    if (declaredSize != null && !/^\d+$/.test(declaredSize)) return fail(400,'图片长度无效');
    if (Number(declaredSize) > maxBytes) return fail(413,'背景文件不能超过 8 MiB');
    let size = 0;
    let chunks = [];
    req.on('data', chunk => {
      if (!chunks) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) { chunks = null; fail(413,'背景文件不能超过 8 MiB'); }
      else chunks.push(bytes);
    });
    req.on('error', () => { if (chunks) { chunks = null; if (!res.destroyed) fail(400,'图片上传中断'); } });
    req.on('end', () => {
      if (!chunks) return;
      if (declaredSize != null && size !== Number(declaredSize)) return fail(400,'图片上传不完整');
      const current = getScope();
      if (current.state !== 'ready' || scope !== profileBackgroundScope(current.accountId,current.selfId) ||
          current.connection !== initial.connection || current.revision !== initial.revision || getRoot() !== root) {
        return fail(409,'上传期间账号或连接已改变，未替换背景');
      }
      const bytes = Buffer.concat(chunks,size);
      const type = sniffImage(bytes);
      if (!supported.has(type) || (mime !== 'application/octet-stream' && type !== mime) || !completeImage(bytes,type,imageSize)) return fail(415,'图片损坏、尺寸过大或内容与格式不符');
      const temp = file + '.' + randomUUID() + '.tmp';
      try {
        mkdirSync(join(root, 'qq-profile-backgrounds'), {recursive:true});
        writeFileSync(temp,bytes,{flag:'wx',mode:0o600});
        renameSync(temp,file);
        result();
      } catch {
        try { rmSync(temp,{force:true}); } catch {}
        fail(500,'资料卡背景未能保存，请检查缓存目录');
      }
    });
  }};
}
