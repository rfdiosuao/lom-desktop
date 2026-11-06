/* ===== WS-TREE-01：文件类型与大小上限 =====
 * 文件树的图标和阅读区共用这一份规则：先看扩展名，未知扩展名读出内容后再嗅探。 */

const BINARY = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|ico|icns|heic|avif|psd|mp[34]|m4[av]|wav|flac|aac|ogg|mov|avi|mkv|webm|pdf|zip|gz|tgz|tar|7z|rar|bz2|xz|doc|docx|dot|dotx|xls|xlsx|xlsm|ppt|pptx|key|numbers|pages|odt|ods|odp|exe|dll|so|dylib|bin|dmg|pkg|apk|ipa|jar|class|wasm|sqlite3?|db|ttf|otf|woff2?|eot)$/i;
const IMAGE = /\.(?:png|jpe?g|gif|webp|bmp|tiff?|ico|icns|heic|avif|svg)$/i;
const DOC = /\.(?:md|markdown|txt)$/i;

/** svg 是文本（可以直接看源码），其余按扩展名分 */
export const kindOf = (name: string): 'text' | 'binary' => (BINARY.test(name) ? 'binary' : 'text');
/** 图标：图片（含 svg）、文档、代码 */
export const iconOf = (name: string): 'image' | 'file' | 'fileCode' => (IMAGE.test(name) ? 'image' : DOC.test(name) ? 'file' : 'fileCode');

/** 阅读区最多显示的字符数和行数；更长的截断并提示 */
export const TEXT_PREVIEW_CHARS = 512 * 1024;
export const TEXT_PREVIEW_LINES = 5000;
/** 核心报告的大小超过这个值就不读取（整份传输、解析、渲染都会卡住界面） */
export const READ_MAX_BYTES = 16 * 1024 * 1024;
/** 文件树最多显示的条目数 */
export const TREE_MAX_NODES = 5000;

/** 读出的内容是不是二进制：含空字符，或大量无法解码的替换字符 */
export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 8000);
  if (sample.includes('\0')) return true;
  let bad = 0;
  for (const ch of sample) if (ch === '�') bad++;
  return sample.length > 0 && bad / sample.length > 0.02;
}

/** 截断到预览上限；返回是否被截断 */
export function clipPreview(text: string): { shown: string; truncated: boolean } {
  let shown = text.length > TEXT_PREVIEW_CHARS ? text.slice(0, TEXT_PREVIEW_CHARS) : text;
  let at = -1;
  for (let i = 0; i < TEXT_PREVIEW_LINES; i++) { at = shown.indexOf('\n', at + 1); if (at < 0) break; }
  if (at >= 0 && at + 1 < shown.length) shown = shown.slice(0, at);
  return { shown, truncated: shown.length < text.length };
}

export function fmtSize(bytes?: number): string {
  if (bytes === undefined) return '大小未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
