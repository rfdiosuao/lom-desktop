import { describe, expect, it } from 'vitest';
import type { Conv } from '@/state/types';
import { mapHistory } from './history';
import type { CoreMessage } from '@/core/types';

const WS = '/Users/me/Documents/Lom';
const conv: Conv = { id: 'c1', owner: 'pc', title: 't', updated: 0, remote: true, workspace: WS, messages: [] };
const item = (o: Partial<CoreMessage> & Pick<CoreMessage, 'type' | 'content'>): CoreMessage =>
  ({ id: Math.random().toString(36), msg_id: 'm', conversation_id: 'c1', position: 'left', created_at: 1, ...o });

describe('D01 AC-3 从历史记录恢复任务', () => {
  it('D01 AC-3 用户 / 总指挥消息、工具卡片、文件变更和预览文件都能恢复', () => {
    const { messages, previewFile } = mapHistory([
      item({ type: 'text', position: 'right', content: { content: '做一个网站' } }),
      item({ type: 'text', content: { content: '好的，我先生成页面。' } }),
      item({ type: 'tool_call', content: { call_id: 'aionrs-call_1', name: 'Write', args: { file_path: `${WS}/index.html`, content: '<h1>hi</h1>\n<p>x</p>' } } }),
      item({ type: 'text', content: { content: '页面已经生成好了' } }),
    ], conv);
    expect(messages.map(m => m.type)).toEqual(['user', 'assistant', 'tool', 'files', 'assistant']);
    expect(messages[2]).toMatchObject({ tool: '写入文件', detail: 'index.html', status: 'done', callId: 'call_1' });
    expect(messages[3].changes).toEqual([{ path: 'index.html', add: 2, del: 0 }]);
    expect(previewFile).toBe(`${WS}/index.html`);
  });

  it('D01 AC-3 被拒绝的工具调用记为失败，不产生文件变更和预览', () => {
    const { messages, previewFile } = mapHistory([
      item({ type: 'tool_call', content: { call_id: 'aionrs-call_2', name: 'Write', args: { file_path: `${WS}/a.html`, content: 'x' } } }),
      item({ type: 'tool_call', content: { call_id: 'call_2', name: 'cancelled: User denied the tool request', status: 'error' } }),
    ], conv);
    expect(messages).toHaveLength(1);
    expect(messages[0].status).toBe('error');
    expect(messages.some(m => m.type === 'files')).toBe(false);
    expect(previewFile).toBeUndefined();
  });

  it('D01 AC-3 隐藏消息不显示', () => {
    const { messages } = mapHistory([item({ type: 'text', hidden: true, content: { content: '系统提示' } })], conv);
    expect(messages).toHaveLength(0);
  });
});

describe('D26 恢复真实工具执行状态', () => {
  it.each(['running', 'pending'])('明确处于 %s 的写入不能显示成功、文件变更或页面预览', state => {
    const result = mapHistory([item({ type: 'tool_call', status: 'work', content: {
      call_id: 'write-active', name: 'Write', status: state, args: { file_path: `${WS}/index.html`, content: '<h1>尚未写入</h1>' },
    } })], conv);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ type: 'tool', status: 'running' });
    expect(result.messages[0].images).toBeUndefined();
    expect(result.previewFile).toBeUndefined();
  });

  it('工具正文缺少状态时仍尊重核心持久化行的 work 状态', () => {
    const result = mapHistory([item({ type: 'tool_call', status: 'work', content: {
      call_id: 'write-active', name: 'Write', args: { file_path: `${WS}/index.html`, content: '<h1>尚未写入</h1>' },
    } })], conv);
    expect(result.messages.map(message => message.status)).toEqual(['running']);
    expect(result.previewFile).toBeUndefined();
  });

  it.each(['error', 'canceled', 'cancelled', 'failed'])('%s 的工具调用不能产生成功文件变更', state => {
    const result = mapHistory([item({ type: 'tool_call', content: {
      call_id: 'write-ended', name: 'Write', status: state, args: { file_path: `${WS}/index.html`, content: '未完成' },
    } })], conv);
    expect(result.messages.map(message => message.status)).toEqual(['error']);
    expect(result.previewFile).toBeUndefined();
  });

  it('同一次调用已有 completed 结果时才恢复成功文件变更和预览', () => {
    const content = { call_id: 'write', name: 'Write', args: { file_path: `${WS}/index.html`, content: '<h1>完成</h1>' } };
    const result = mapHistory([
      item({ type: 'tool_call', content: { ...content, status: 'running' } }),
      item({ type: 'tool_call', content: { ...content, status: 'completed' } }),
    ], conv);
    expect(result.messages.map(message => message.type)).toEqual(['tool', 'files']);
    expect(result.messages[0].status).toBe('done');
    expect(result.previewFile).toBe(`${WS}/index.html`);
  });
});

it('agent version notices: a newer CLI shows nothing; an older one is a Lom-worded upgrade hint without the upstream name', async () => {
  const { mapHistory } = await import('./history');
  const conv = { id: 'v', owner: 'pc', title: 'Codex', updated: 1, messages: [] };
  const tip = (code: string, content: string, params?: Record<string, string>) => ({ id: code, msg_id: code, type: 'tips', position: 'center', created_at: 1, content: { content, type: 'info', code, params } });
  const { messages } = mapHistory([
    tip('CLI_VERSION_NEWER', 'The installed codex is newer than the version AionUi verified. It should still work; report anything that behaves oddly. (installed codex-cli 0.160.1 / verified by AionUi: 0.151.0)', { cli: 'codex' }),
    tip('CLI_VERSION_OLDER', 'The installed codex is older than the version AionUi verified; some features may be missing.', { cli: 'codex', reported: '0.140.0', verified: '0.151.0' }),
    tip('OTHER', '额度不足'),
  ] as never, conv as never);
  expect(messages.map(m => m.text)).toEqual(['本机的 codex 版本较旧（0.140.0），部分功能可能用不了，建议升级到 0.151.0 或更新的版本', '额度不足']);
  expect(messages.some(m => /AionUi/.test(m.text || ''))).toBe(false);
});

it('EFFORT-01 external history reads thought_level while native Lom keeps reasoning_effort', async () => {
  const { convFromCore } = await import('./history');
  const base = { id: 'effort-history', name: 'task', created_at: 1, modified_at: 1 };
  expect(convFromCore({ ...base, type: 'acp', extra: { thought_level: 'deep', reasoning_effort: 'wrong' } }).effort).toBe('deep');
  expect(convFromCore({ ...base, type: 'acp', extra: { reasoning_effort: 'high' } }).effort).toBeUndefined();
  expect(convFromCore({ ...base, type: 'aionrs', extra: { reasoning_effort: 'high', thought_level: 'wrong' } }).effort).toBe('high');
});
