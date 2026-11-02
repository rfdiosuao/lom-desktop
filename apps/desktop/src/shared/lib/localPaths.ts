/** Local path recognition only; never interpret shell commands or remote URL schemes.
 *  CW07：裸文件名分支原先只要 `单词.后缀` 就算路径，于是 `README.md` / `Node.js` / `e.g` /
 *  `v1.2` / `3.14` 在电脑任务里全变成「打开文件」按钮。
 *  现在裸名必须是**带目录分隔**的相对路径（`src/a.ts`），或落在已知文件后缀白名单里，
 *  且主干不像版本号、代码标识符或单字母缩写。单独的 `README.md` 这类仍按正文处理。
 *
 *  两个入口的区别（CW07）：
 *  - `isLocalPath` 用于「从模型输出里**猜**是不是路径」，必须保守，认错会把正文变成按钮；
 *  - `isOpenablePath` 用于「用户**明确点击**了一个路径」，可以宽松，认错只是打开失败并提示。 */
const EXTENSIONS = /^(?:[cm]?[jt]sx?|json|jsonc|md|mdx|txt|html?|css|scss|less|svg|png|jpe?g|gif|webp|bmp|ico|pdf|zip|tar|gz|tgz|7z|rar|yml|yaml|toml|ini|cfg|conf|lock|log|csv|tsv|xml|xlsx?|docx?|pptx?|sh|bash|zsh|fish|ps1|bat|cmd|py|pyi|rb|rs|go|java|kt|kts|swift|cs|php|lua|r|sql|db|sqlite|wasm|mp3|mp4|wav|flac|mov|avi|mkv|webm|ttf|otf|woff2?)$/i;

/** Windows 盘符必须先于 scheme 守卫判断，否则 `C:\` 会被当成 URL 协议拒掉。 */
const DRIVE = /^[a-z]:[\\/]/i;
/** 显式路径前缀：绝对路径、家目录、./、../ */
const EXPLICIT = /^(\/|~\/|\.\.?\/)/;
/** 带目录的相对路径（至少一级目录 + 文件名）；后缀另由 EXTENSIONS 校验。 */
const RELATIVE = /^(?:[\w\u3400-\u9fff.-]+[\\/])+[\w\u3400-\u9fff.-]+$/;
/** 域名开头 + 斜杠：`github.com/foo/bar.md`、`example.com/a/b.ts` 是网址不是本地文件。
 *  `./github.com/foo.md` 仍走 EXPLICIT 分支，不受影响。 */
const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+[\\/]/i;
const badShape = (value: string) => /[\r\n\0]/.test(value) || value.startsWith('//');
const stripLineSuffix = (value: string) => value.replace(/(?::\d+){1,2}$/, '');
const knownExtension = (value: string) => {
  const ext = /\.([a-z\d]{1,12})$/i.exec(stripLineSuffix(value))?.[1];
  return !!ext && EXTENSIONS.test(ext);
};
/** 相对路径必须同时满足「含目录」和「已知文件后缀」，`TCP/IP`、`and/or` 不算；
 *  域名开头的网址形相对串也排除，避免 `github.com/foo/bar.md` 变成文件按钮。 */
const isRelativeFilePath = (value: string) =>
  !DOMAIN.test(stripLineSuffix(value)) && RELATIVE.test(stripLineSuffix(value)) && knownExtension(value);

/** 裸文件名：仅当落在文件后缀白名单，且主干不是纯数字 / 版本号 / 单字母缩写。 */
function bareFile(value: string) {
  const bare = /^([\w\u3400-\u9fff][\w\u3400-\u9fff .-]*?)\.([a-z\d]{1,12})(?::\d+)?$/i.exec(value);
  if (!bare) return null;
  const [, stem, ext] = bare;
  if (!EXTENSIONS.test(ext)) return null;
  if (/^\d+$/.test(stem)) return null;              // 3.14
  if (stem.length === 1) return null;               // e.g / i.e
  if (/^v?\d+(?:\.\d+)*$/i.test(stem)) return null;  // v1.2 / 1.2.3
  // 单个英文单词 + 通用后缀（README.md / Node.js）在正文里歧义太大，按正文处理；
  // 中文文件名、含空格或点的主干仍算路径（报告.pdf、我的 文档.docx）。
  if (!/[\u3400-\u9fff]/.test(stem) && /^[A-Za-z][A-Za-z0-9]*$/.test(stem)) return null;
  return { stem, ext };
}

export function isLocalPath(value: string) {
  if (badShape(value)) return false;
  if (DRIVE.test(value)) return true;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return false;
  if (EXPLICIT.test(value)) return true;
  if (isRelativeFilePath(value)) return true;
  return !!bareFile(value);
}

/** 行内代码里的路径：用户已明确写成代码，可接受 `a.md` 这种短占位文件名；
 *  仍拒绝 README.md / Node.js（单词名）以及 e.g / v1.2 / 3.14。 */
export function isInlineCodePath(value: string) {
  if (isLocalPath(value)) return true;
  if (badShape(value) || DRIVE.test(value) || /^[a-z][a-z\d+.-]*:/i.test(value)) return false;
  const short = /^([\w\u3400-\u9fff]{1,2})\.([a-z\d]{1,12})(?::\d+)?$/i.exec(value);
  return !!short && EXTENSIONS.test(short[2]) && !/^v?\d+(?:\.\d+)*$/i.test(short[1]);
}

/** 用户明确点击的路径：接受裸文件名（`a.md`），只要形态安全、不像远程地址。
 *  与 `isLocalPath` 分开，避免为了「能点开 a.md」而放宽渲染侧猜测。 */
export function isOpenablePath(value: string) {
  if (badShape(value)) return false;
  if (DRIVE.test(value)) return true;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || DOMAIN.test(value)) return false;
  if (EXPLICIT.test(value) || isRelativeFilePath(value)) return true;
  return /^[\w\u3400-\u9fff][^\s<>"'`|]*$/.test(value);
}

export function resolveLocalPath(value: string, workspace: string, home: string) {
  if (!isOpenablePath(value)) throw new Error('这不是可打开的本地路径');
  let path = value.replace(/:\d+(?::\d+)?$/, '');
  if (path.startsWith('~/')) { if (!home) throw new Error('尚未获取主目录'); path = home + path.slice(1); }
  // 盘符已经是绝对路径，不能再拼工作目录；统一成正斜杠交给核心。
  if (DRIVE.test(path)) return path.replace(/\\/g, '/');
  if (!path.startsWith('/')) { if (!workspace) throw new Error('这条会话没有工作目录，无法定位相对路径'); path = workspace + '/' + path; }
  const parts: string[] = [];
  for (const part of path.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
  return '/' + parts.join('/');
}
