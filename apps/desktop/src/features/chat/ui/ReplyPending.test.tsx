import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
import { ReplyPending } from './ReplyPending';

let host: HTMLDivElement, root: Root, c: Conv;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  c = { id: 'codex', owner: 'pc', agentId: 'codex', agentName: 'Codex CLI', title: 'hello', updated: 1,
    messages: [{ id: 'u', type: 'user', at: 1, text: 'hello' }] };
  S.convs = [c]; S.agentCatalog = [];
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => { root.render(<ReplyPending c={c} />); });
it('D07 waiting uses the selected agent identity and has no message action buttons', async () => {
  await render();
  expect(host.querySelector('.msg__name')?.textContent).toBe('Codex CLI');
  expect(host.textContent).not.toContain('电脑主控');
  expect(host.querySelector('[role="status"]')).not.toBeNull();
  expect(host.querySelectorAll('.typing i')).toHaveLength(3);
  expect(host.querySelector('button')).toBeNull();
});
it.each<Partial<Msg>>([
  { type: 'assistant', streaming: true }, { type: 'thinking', status: 'running' },
  { type: 'tool', status: 'running' }, { type: 'approval', status: 'pending' },
  { type: 'question', status: 'pending' }, { type: 'question', status: 'submitting' }, { type: 'approval', status: 'submitting' },
])('UI-AUDIT-05 (D07) visible active $type hides the waiting animation but keeps the row and its announcement unchanged', async activity => {
  c.messages.push({ id: 'a', at: 2, type: 'assistant', ...activity });
  await render();
  expect(host.querySelectorAll('.reply-pending')).toHaveLength(1);
  expect(host.querySelector('.reply-pending__live')).toBeNull();
  expect(host.querySelector('.typing')).toBeNull();
  expect(host.querySelector('[role="status"]')!.textContent).toBe(activity.type === 'assistant' ? '正在继续处理…' : '正在等待回复…');
  expect(host.querySelector('.msg__name')).toBeNull();
});
it('UI-AUDIT-05 the status row has no fixed label, so its text is what gets announced', async () => {
  await render();
  const status = host.querySelector('[role="status"]')!;
  expect(status.hasAttribute('aria-label')).toBe(false);
  expect(host.querySelector('.reply-pending')!.hasAttribute('aria-label')).toBe(false);
  expect(status.textContent).toBe('正在等待回复…');
});
it('UI-AUDIT-05 (D31) an external agent identity shown at its first thinking is not repeated by the waiting row', async () => {
  c.messages.push({ id: 'th', type: 'thinking', at: 2, text: '想好了' });
  await render();
  expect(host.querySelector('.msg__name')).toBeNull();
  expect(host.querySelector('[role="status"]')!.textContent).toBe('正在等待回复…');
});
it('D07 a continued reply does not repeat identity, but the next user turn does', async () => {
  c.messages.push({ id: 'a', type: 'assistant', at: 2, text: 'checking' });
  await render(); expect(host.querySelector('.msg__name')).toBeNull();
  c.messages.push({ id: 'u2', type: 'user', at: 3, text: 'again' });
  await render(); expect(host.querySelector('.msg__name')?.textContent).toBe('Codex CLI');
});
