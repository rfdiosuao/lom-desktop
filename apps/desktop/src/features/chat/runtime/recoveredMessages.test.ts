import { describe, expect, it } from 'vitest';
import type { Msg } from '@/state/types';
import { recoveredMessages } from './recoveredMessages';

const tool = (id: string): Msg => ({ id, type: 'tool', callId: id, at: 1, status: 'done' });
const files = (add: number): Msg => ({ id: `files-${add}`, type: 'files', at: 2, changes: [{ path: 'index.html', add, del: 0 }] });

describe('D26 合并恢复后的消息', () => {
  it('历史包含遗漏的写入结果时采用新文件统计，不叠加旧的局部统计', () => {
    const saved = [tool('write-1'), tool('write-2'), files(8)];
    const local = [tool('write-1'), files(3)];
    const messages = recoveredMessages(saved, local, false);
    expect(messages.filter(message => message.type === 'files')).toEqual([files(8)]);
  });

  it('尚未持久化的写入调用及其文件卡片一起保留', () => {
    const local = [tool('write-live'), files(3)];
    expect(recoveredMessages([], local, true)).toMatchObject(local);
  });

  it('重复提问按出现次数对齐，不丢弃最后一条未确认的同文消息', () => {
    const saved: Msg[] = [{ id: 'u1', remoteId: 'remote-u1', type: 'user', at: 1, text: '继续' }];
    const local = [...saved, { id: 'optimistic-u2', type: 'user' as const, at: 2, text: '继续' }];
    expect(recoveredMessages(saved, local, false).map(message => message.id)).toEqual(['u1', 'optimistic-u2']);
  });

  it('只有相同文字的视觉匹配不能制造消息接收凭据', () => {
    const saved: Msg[] = [{ id: 'old-server', remoteId: 'old-remote', type: 'user', at: 1, text: '继续' }];
    const local: Msg[] = [{ id: 'new-local', type: 'user', at: 2, text: '继续', status: 'error' }];
    const messages = recoveredMessages(saved, local, false);
    expect(messages[0]).toMatchObject({ id: 'new-local', status: 'error' });
    expect(messages[0].remoteId).toBeUndefined();
  });

  it('普通工具前后的文本使用核心不同分段 ID，恢复后保持顺序且不重复局部片段', () => {
    const saved: Msg[] = [
      { id: 'before', remoteId: 'segment-1', type: 'assistant', at: 1, text: '先检查' }, tool('read'),
      { id: 'after', remoteId: 'segment-2', type: 'assistant', at: 3, text: '检查后的完整答案' },
    ];
    const local = [saved[0], tool('read'), { ...saved[2], id: 'live', text: '检查后', streaming: true }];
    expect(recoveredMessages(saved, local, false).map(message => message.text || message.callId))
      .toEqual(['先检查', 'read', '检查后的完整答案']);
  });

  it('工作流进度卡片分开了同一核心文本分段时，只保留服务端完整文本一次', () => {
    const saved: Msg[] = [{ id: 'segment', remoteId: 'segment', type: 'assistant', at: 1, text: 'AlphaBeta完整' }, tool('workflow')];
    const local: Msg[] = [
      { id: 'alpha', remoteId: 'segment', type: 'assistant', at: 1, text: 'Alpha' }, tool('workflow'),
      { id: 'beta', remoteId: 'segment', type: 'assistant', at: 3, text: 'Beta', streaming: true },
    ];
    expect(recoveredMessages(saved, local, false).map(message => message.text || message.callId))
      .toEqual(['AlphaBeta完整', 'workflow']);
  });

  it('同一文本分段仍在生成时，把本地分散的片段合并，不能用较短持久化快照截断', () => {
    const saved: Msg[] = [{ id: 'segment', remoteId: 'segment', type: 'assistant', at: 1, text: 'Alpha' }, tool('workflow')];
    const local: Msg[] = [
      { id: 'alpha', remoteId: 'segment', type: 'assistant', at: 1, text: 'Alpha' }, tool('workflow'),
      { id: 'beta', remoteId: 'segment', type: 'assistant', at: 3, text: 'Beta', streaming: true },
    ];
    const messages = recoveredMessages(saved, local, true);
    expect(messages.filter(message => message.type === 'assistant')).toMatchObject([{ text: 'AlphaBeta', streaming: true }]);
  });
});
