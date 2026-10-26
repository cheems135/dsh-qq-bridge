import qrcode from './vendor/qrcode-generator.cjs';

// Encode entirely in this process. QQ login URLs are never sent to an external
// QR service, embedded as SVG markup, or copied to logs.
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

export function createQrSvg(value, { size = 280 } = {}) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('二维码链接格式无效。');
  let url;
  try { url = new URL(value); } catch { throw new Error('二维码链接格式无效。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('二维码链接格式无效。');
  const qr = qrcode(0, 'M');
  try { qr.addData(value, 'Byte'); qr.make(); } catch { throw new Error('无法生成本地登录二维码。'); }
  const requestedSize = Math.min(1024, Math.max(220, Number(size) || 280));
  // At least four white modules on every edge are required for robust scanning.
  const count = qr.getModuleCount();
  const scale = Math.max(3, Math.floor(requestedSize / (count + 8)));
  return qr.createSvgTag({ cellSize: scale, margin: 4 * scale, scalable: true });
}
