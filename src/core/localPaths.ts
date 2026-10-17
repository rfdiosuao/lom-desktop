/** Local path recognition only; never interpret shell commands or remote URL schemes. */
export function isLocalPath(value: string) {
  return !/[\r\n\0]/.test(value) && !/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith('//') &&
    (/^(\/|~\/|\.\.?\/)/.test(value) || /^[\w\u3400-\u9fff -]+\.[a-z\d]{1,12}(?::\d+)?$/i.test(value));
}
export function resolveLocalPath(value: string, workspace: string, home: string) {
  if (!isLocalPath(value)) throw new Error('这不是可打开的本地路径');
  let path = value.replace(/:\d+(?::\d+)?$/, '');
  if (path.startsWith('~/')) { if (!home) throw new Error('尚未获取主目录'); path = home + path.slice(1); }
  if (!path.startsWith('/')) { if (!workspace) throw new Error('这条会话没有工作目录，无法定位相对路径'); path = workspace + '/' + path; }
  const parts: string[] = [];
  for (const part of path.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
  return '/' + parts.join('/');
}
