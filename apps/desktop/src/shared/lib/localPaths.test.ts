import { describe, expect, it } from 'vitest';
import { isInlineCodePath, isLocalPath, isOpenablePath, resolveLocalPath } from './localPaths';

describe('CW07 isLocalPath 保守识别', () => {
  it.each(['TCP/IP', 'and/or', 'CI/CD', '24/7', 'A/B', 'HTTP/2', '输入/输出', 'n/a', '3.14/2', 'example.com/path'])(
    'CW07 正文斜杠词组 %s 不是本地路径', value => {
      expect(isLocalPath(value)).toBe(false);
    });

  it.each(['README.md', 'Node.js', 'e.g', 'v1.2', '3.14'])('CW07 歧义裸串 %s 不是本地路径', value => {
    expect(isLocalPath(value)).toBe(false);
  });

  it.each(['github.com/foo/bar.md', 'example.com/a/b.ts', 'raw.githubusercontent.com/u/r/main/a.png'])(
    'CW07 域名开头的网址 %s 不是本地路径', value => {
      expect(isLocalPath(value)).toBe(false);
      expect(isOpenablePath(value)).toBe(false);
    });

  it('CW07 显式 ./ 开头的域名目录仍是本地相对路径', () => {
    expect(isLocalPath('./github.com/foo.md')).toBe(true);
    expect(isOpenablePath('./github.com/foo.md')).toBe(true);
  });

  it.each(['/work/a.md', '~/a.md', './a.md', '../a.md', 'src/a.ts', 'docs/guide.md', 'C:\\Users\\a.txt', 'c:/Users/a.txt'])(
    'CW07 明确路径 %s 是本地路径', value => {
      expect(isLocalPath(value)).toBe(true);
    });
});

describe('CW07 Windows 盘符不被 scheme 守卫误杀', () => {
  it.each(['C:\\Users\\a.txt', 'D:\\work\\x.md', 'c:/Users/a.txt'])('CW07 %s 可打开并正确解析', value => {
    expect(isOpenablePath(value)).toBe(true);
    expect(resolveLocalPath(value, '/work', '/home')).toBe(value.replace(/\\/g, '/'));
  });

  it('CW07 远程协议仍被拒绝', () => {
    expect(isLocalPath('https://example.com/a.md')).toBe(false);
    expect(isOpenablePath('javascript:alert(1)')).toBe(false);
  });
});

describe('CW07 行内代码路径', () => {
  it('CW07 a.md 这类短占位名可点击', () => {
    expect(isInlineCodePath('a.md')).toBe(true);
    expect(isInlineCodePath('docs/a.ts')).toBe(true);
    expect(isInlineCodePath('/work/a b.md')).toBe(true);
  });

  it.each(['README.md', 'Node.js', 'e.g', 'v1.2', '3.14'])('CW07 歧义串 %s 仍按行内代码显示', value => {
    expect(isInlineCodePath(value)).toBe(false);
  });
});
