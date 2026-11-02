import { describe, expect, it } from 'vitest';
import type { Msg } from '@/state/types';
import { fileChangeOf, friendlyModelError, mergeFileChange, normCallId, toolDetail, toolLabel } from './tools';

const WS = '/Users/me/Documents/Lom';

describe('D01 §2.4 工具调用的展示', () => {
  it('D01 统一工具调用 id：去掉 aionrs- 前缀', () => {
    expect(normCallId('aionrs-call_1')).toBe('call_1');
    expect(normCallId('call_1')).toBe('call_1');
  });

  it('D01 工具名翻译成原型里的中文名，未知工具保留原名', () => {
    expect(toolLabel('Write')).toBe('写入文件');
    expect(toolLabel('ExecCommand')).toBe('运行命令');
    expect(toolLabel('SomethingNew')).toBe('SomethingNew');
  });

  it('D01 副标题：工作文件夹内的文件显示相对路径，命令显示命令本身', () => {
    expect(toolDetail({ file_path: `${WS}/site/index.html` }, WS)).toBe('site/index.html');
    expect(toolDetail({ file_path: '/etc/hosts' }, WS)).toBe('/etc/hosts');
    expect(toolDetail({ command: 'npm run build' }, WS)).toBe('npm run build');
  });

  it('D01 写文件 / 改文件生成文件变更，其他工具不生成', () => {
    expect(fileChangeOf('Write', { file_path: `${WS}/a.html`, content: 'a\nb\nc' }, WS)).toEqual({ path: 'a.html', add: 3, del: 0 });
    expect(fileChangeOf('Edit', { file_path: `${WS}/a.html`, old_string: 'x', new_string: 'y\nz' }, WS)).toEqual({ path: 'a.html', add: 2, del: 1 });
    expect(fileChangeOf('Read', { file_path: `${WS}/a.html` }, WS)).toBeNull();
  });

  it('D01 同一轮里的文件变更合并到一张卡片；用户新发消息后另起一张', () => {
    const list: Msg[] = [{ id: 'u', type: 'user', at: 0, text: '做网页' }];
    mergeFileChange(list, { path: 'a.html', add: 3, del: 0 });
    mergeFileChange(list, { path: 'b.css', add: 2, del: 0 });
    mergeFileChange(list, { path: 'a.html', add: 1, del: 1 });
    expect(list.filter(m => m.type === 'files')).toHaveLength(1);
    expect(list[1].changes).toEqual([{ path: 'a.html', add: 4, del: 1 }, { path: 'b.css', add: 2, del: 0 }]);
    list.push({ id: 'u2', type: 'user', at: 1, text: '再改一下' });
    mergeFileChange(list, { path: 'a.html', add: 1, del: 0 });
    expect(list.filter(m => m.type === 'files')).toHaveLength(2);
  });
});

describe('S04-01 AC-5 积分不足的提示', () => {
  it('S04-01 AC-5 Lom 云端的额度类报错翻译成可操作的提示（中英文都识别）', () => {
    for (const raw of ['用户额度不足, 剩余额度: 0', '预扣费额度失败, 用户剩余额度: 10, 需要预扣费额度: 500', 'Insufficient user quota, remaining quota: 0']) {
      expect(friendlyModelError(raw, true)).toContain('积分不足');
    }
    expect(friendlyModelError('无效的令牌', true)).toContain('积分已用完或登录凭据失效');
    expect(friendlyModelError('Invalid token', true)).toContain('重新登录');
  });

  it('S04-01 AC-5 自带 Key 的任务原样显示报错（Invalid token 就是 Key 填错了）', () => {
    expect(friendlyModelError('Invalid token', false)).toBe('Invalid token');
    expect(friendlyModelError('用户额度不足', false)).toBe('用户额度不足');
  });
});

describe('用户消息里的附件标记', () => {
  it('拆出正文和附件路径；没有标记时原样返回', async () => {
    const { splitFilesMarker } = await import('./tools');
    expect(splitFilesMarker('看看这张图\n\n[[AION_FILES]]\n/tmp/a.png\n/tmp/b.pdf')).toEqual({ text: '看看这张图', paths: ['/tmp/a.png', '/tmp/b.pdf'] });
    expect(splitFilesMarker('普通消息')).toEqual({ text: '普通消息', paths: [] });
  });
});
