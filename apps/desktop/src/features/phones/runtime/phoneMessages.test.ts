import { expect, it } from 'vitest';
import { phoneMessages, type PhoneRow } from './phoneMessages';
const row: PhoneRow = { id: 'm', role: 'assistant', at: 1, text: '先检查。检查完了。', blocks: [
  { id: 'a', kind: 'text', text: '先检查。', title: '', status: '' },
  { id: 'b', kind: 'tool_use', text: 'file.txt', title: '列出文件', status: 'RUNNING', command: 'ls' },
  { id: 'c', kind: 'text', text: '检查完了。', title: '', status: '' },
] };
it('R02 renders text/tool/text in phone order, without aggregate duplication', () => {
  const list = phoneMessages(row, 'dev_a', 2);
  expect(list.map(m => m.type)).toEqual(['assistant', 'tool', 'assistant']);
  expect(list.map(m => m.text || m.output)).toEqual(['先检查。', 'file.txt', '检查完了。']);
  expect(list[1]).toMatchObject({ command: 'ls', status: 'running' });
  expect(list.every(m => m.agent === 'dev_a')).toBe(true);
});
it('R02 streaming changes output/status without changing card ids or ordering', () => {
  const before = phoneMessages(row, 'dev_a', 2);
  const next = structuredClone(row); next.blocks![1].status = 'SUCCESS'; next.blocks![1].text += '\nnext.txt';
  const after = phoneMessages(next, 'dev_a', 2);
  expect(after.map(m => m.id)).toEqual(before.map(m => m.id));
  expect(after[1]).toMatchObject({ status: 'done', output: 'file.txt\nnext.txt' });
});
it('R02 scopes tool ids to the message to avoid cross-turn collapse collisions', () => {
  expect(phoneMessages(row, 'dev_a', 2)[1].id).not.toBe(phoneMessages({ ...row, id: 'other' }, 'dev_a', 2)[1].id);
});
it('R02 preserves plain messages and tool-only turns without empty assistant bubbles', () => {
  expect(phoneMessages({ ...row, blocks: [] }, 'dev_a', 2)[0].text).toBe(row.text);
  expect(phoneMessages({ ...row, text: '', blocks: [row.blocks![1]] }, 'dev_a', 2).map(m => m.type)).toEqual(['tool']);
  expect(phoneMessages({ ...row, role: 'user' }, 'dev_a', 2)).toHaveLength(1);
});
it('R02 empty running tool still has expandable content; cancellation is not failure', () => {
  const input = { ...row, text: '', blocks: [{ ...row.blocks![1], text: '' }] };
  expect(phoneMessages(input, 'dev_a', 2)[0].output).toBe('等待工具输出…');
  input.blocks[0].status = 'CANCELLED';
  expect(phoneMessages(input, 'dev_a', 2)[0]).toMatchObject({ detail: '已取消', status: 'pending' });
});
it('D08 手机历史恢复保留图片正文与附件定位，纯图片回复也能展示', () => {
  const text = '![设计稿](minis://workspace/result.png)';
  const history = phoneMessages({ id: 'image', role: 'assistant', text, at: 1, attachments: ['result.png'] }, 'dev_a', 2, 'session');
  expect(history).toHaveLength(1);
  expect(history[0].text).toBe(text);
  expect(history[0].attachments?.[0].phoneFile).toEqual({ device: 'dev_a', session: 'session', message: 'image', index: 0 });
  expect(phoneMessages({ id: 'image', role: 'assistant', text: '', at: 1, attachments: ['result.png'] }, 'dev_a', 2, 'session')[0].type).toBe('assistant');
});
