import { stripSettingsContext } from '@/features/settings/runtime/preferences';
import type { Msg } from '@/state/types';

export interface PhoneBlock { id: string; kind: string; title: string; text: string; status: string; command?: string; }
export interface PhoneRow { id: string; role: string; text: string; at: number; blocks?: PhoneBlock[]; attachments?: string[]; }

/** The phone's ordered blocks are authoritative; `text` is only their aggregate fallback. */
export function phoneMessages(row: PhoneRow, owner: string, fallbackTime: number, session?: string): Msg[] {
  if (row.role !== 'user' && row.role !== 'assistant') return [];
  const base = { at: row.at || fallbackTime, agent: row.role === 'assistant' ? owner : undefined };
  const id = `phone:${row.id}`;
  if (row.role === 'user') return [{ ...base, id, type: 'user', text: stripSettingsContext(row.text), attachments: row.attachments?.map((name, index) => ({ name, ic: 'file', phoneFile: session ? { device: owner, session, message: row.id, index } : undefined })) }];
  const messages: Msg[] = [];
  const hasText = row.blocks?.some(b => b.kind === 'text' && b.text.length > 0);
  for (const block of row.blocks || []) {
    const blockId = `${id}:block:${block.id}`;
    if (block.kind === 'text' && block.text) messages.push({ ...base, id: blockId, type: 'assistant', text: block.text });
    if (block.kind !== 'tool_use') continue;
    const running = ['RUNNING', 'PENDING', 'STREAMING'].includes(block.status);
    const detail = running ? '执行中' : ({ SUCCESS: '已完成', FAILED: '执行失败', CANCELLED: '已取消', TIMEOUT: '已超时' }[block.status] || '状态未知');
    messages.push({ ...base, id: blockId, type: 'tool', tool: block.title || '调用工具',
      command: block.command, detail,
      output: block.text || (running ? '等待工具输出…' : '没有工具输出'),
      status: running ? 'running' : block.status === 'SUCCESS' ? 'done' : ['FAILED', 'TIMEOUT'].includes(block.status) ? 'error' : 'pending' });
  }
  // Old phones / plain-text turns may not provide ordered text blocks. Never duplicate the aggregate.
  if (!hasText && row.text) messages.push({ ...base, id, type: 'assistant', text: row.text });
  if (row.attachments?.length && session) {
    let target = messages.find(m => m.type === 'assistant');
    if (!target) { target = { ...base, id, type: 'assistant', text: '' }; messages.push(target); }
    target.attachments = row.attachments.map((name, index) => ({ name, ic: 'file', phoneFile: { device: owner, session, message: row.id, index } }));
  }
  return messages;
}
