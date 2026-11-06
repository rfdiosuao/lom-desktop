/* ===== PHONE-PROFILE-02：手机头像的校验。手机传来的一切都是不可信数据 =====
 * 只收 png / jpeg / webp，按文件头判定类型（不信 mime），拒绝 SVG；核对字节数、像素尺寸（64–512）和桌面自己算出的 SHA-256。 */

export const LOGO_MAX_BYTES = 256 * 1024;
const MIN_SIDE = 64, MAX_SIDE = 512;
export type LogoMime = 'image/png' | 'image/jpeg' | 'image/webp';

const u16 = (b: Uint8Array, i: number) => b[i] | b[i + 1] << 8;
const be16 = (b: Uint8Array, i: number) => b[i] << 8 | b[i + 1];
const be32 = (b: Uint8Array, i: number) => (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function jpegSize(b: Uint8Array): [number, number] | undefined {
  for (let i = 2; i + 9 < b.length;) {
    if (b[i] !== 0xff) return undefined;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [be16(b, i + 7), be16(b, i + 5)];
    i += 2 + be16(b, i + 2);
  }
  return undefined;
}
function webpSize(b: Uint8Array): [number, number] | undefined {
  const kind = ascii(b, 12, 4);
  if (kind === 'VP8 ' && b.length > 30) return [u16(b, 26) & 0x3fff, u16(b, 28) & 0x3fff];
  if (kind === 'VP8L' && b.length > 25 && b[20] === 0x2f) { const v = (b[21] | b[22] << 8 | b[23] << 16 | b[24] << 24) >>> 0; return [(v & 0x3fff) + 1, (v >>> 14 & 0x3fff) + 1]; }
  if (kind === 'VP8X' && b.length > 29) return [(b[24] | b[25] << 8 | b[26] << 16) + 1, (b[27] | b[28] << 8 | b[29] << 16) + 1];
  return undefined;
}

/** 按文件头识别类型和像素尺寸；不认识、SVG、截断都返回 undefined */
export function sniffLogo(b: Uint8Array): { mime: LogoMime; width: number; height: number } | undefined {
  let mime: LogoMime, size: [number, number] | undefined;
  if (b.length > 24 && ascii(b, 1, 3) === 'PNG' && b[0] === 0x89 && ascii(b, 12, 4) === 'IHDR') { mime = 'image/png'; size = [be32(b, 16), be32(b, 20)]; }
  else if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) { mime = 'image/jpeg'; size = jpegSize(b); }
  else if (b.length > 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') { mime = 'image/webp'; size = webpSize(b); }
  else return undefined;
  return size ? { mime, width: size[0], height: size[1] } : undefined;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}

export interface LogoReply { mime: string; sha256: string; size: string; data: string }

/** 通过校验返回 data: URL；任何不符都抛错（调用方只记录，不打扰用户，沿用旧图） */
export async function checkLogo(reply: LogoReply, expectedSha: string): Promise<string> {
  const { mime, sha256, size, data } = reply;
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > Math.ceil(LOGO_MAX_BYTES / 3) * 4) throw new Error('phone.logo_invalid：头像数据格式不对或超过大小限制');
  const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
  if (bytes.length > LOGO_MAX_BYTES || String(bytes.length) !== size) throw new Error('phone.logo_invalid：头像字节数与声明不符');
  const found = sniffLogo(bytes);
  if (!found || found.mime !== mime) throw new Error('phone.logo_invalid：头像不是 png / jpeg / webp，或类型与声明不符');
  if ([found.width, found.height].some(n => n < MIN_SIDE || n > MAX_SIDE)) throw new Error('phone.logo_invalid：头像尺寸需在 64–512 像素之间');
  const actual = await sha256Hex(bytes);
  if (actual !== expectedSha || actual !== sha256) throw new Error('phone.logo_invalid：头像哈希与声明不符');
  return `data:${found.mime};base64,${data}`;
}
