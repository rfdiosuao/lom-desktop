import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import { Message } from './Message';
import type { Msg } from '@/state/types';
const message: Msg = { id: 'reply', type: 'assistant', text: '手机回复', at: 1 };
let host: HTMLDivElement, root: Root;
const render = async (m: Msg = message, ctxId = 'phone-chat') => {
  await act(async () => root.render(<Message m={m} ctxId={ctxId} />));
  return host.innerHTML;
};
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
beforeEach(() => {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  S.agents.dev_identity_test = { id: 'dev_identity_test', kind: 'phone', name: 'REDMI K80 Ultra', status: 'online', persona: '', real: true };
  S.convs = [{ id: 'phone-chat', owner: 'dev_identity_test', phoneSession: 'native-session', title: '你好', updated: 1, messages: [] }];
});
it('R02 cached phone reply without agent uses its conversation phone name and icon', async () => {
  const html = await render();
  expect(html).toContain('REDMI K80 Ultra'); expect(html).toContain('avatar--phone');
  expect(html).not.toContain('电脑主控');
});
it('R02 new phone reply retains its explicit sender', async () => {
  const html = await render({ ...message, agent: 'dev_identity_test' });
  expect(html).toContain('REDMI K80 Ultra'); expect(html).not.toContain('电脑主控');
});
it('R02 missing device metadata never labels a phone reply as computer', async () => {
  delete S.agents.dev_identity_test;
  const html = await render(); expect(html).toContain('手机 Agent'); expect(html).toContain('avatar--phone');
  expect(html).not.toContain('电脑主控');
});
it('R02 explicit computer delegation retains its own identity', async () => {
  const html = await render({ ...message, agent: 'pc' });
  expect(html).toContain('电脑主控'); expect(html).toContain('avatar--computer');
});
it('R02 real phone reply does not invent a demo model badge', async () => {
  S.agents.dev_identity_test.model = 'lom-mini';
  expect(await render()).not.toContain('badge');
});
it('R02 phone tool is collapsed initially and preserves expansion while output refreshes', async () => {
  const tool: Msg = { id: 'phone:m:block:tool', type: 'tool', at: 1, tool: '检查应用', detail: '执行中', output: 'first output', status: 'running' };
  await render(tool);
  const button = () => host.querySelector<HTMLButtonElement>('.tool__row')!;
  expect(button().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).not.toContain('first output');
  await act(async () => button().click());
  expect(button().getAttribute('aria-expanded')).toBe('true');
  expect(host.textContent).toContain('first output');
  await render({ ...tool, output: 'final output', status: 'done' });
  expect(button().getAttribute('aria-expanded')).toBe('true');
  expect(host.textContent).toContain('final output');
  await act(async () => button().click());
  expect(button().getAttribute('aria-expanded')).toBe('false');
  expect(host.textContent).not.toContain('final output');
});
it('SIDE-03 side chat approval never offers allow actions', async () => {
  S.convs = [{ id: 'side-ui', owner: 'pc', title: '侧聊', updated: 1, messages: [], sideOf: 'p', remote: true, agentId: 'ag', agentBackend: 'qwen' }];
  const approval: Msg = { id: 'ap', type: 'approval', at: 1, status: 'pending', command: 'Write file', confirmId: 'c1', callId: 'c1', confirmationEngine: 'acp',
    confirmationOptions: [{ value: 'allow', action: 'once', label: 'Allow' }, { value: 'reject', action: 'deny', label: 'Reject' }] };
  const html = await render(approval, 'conv:side-ui');
  expect(html).toContain('侧边聊天只读');
  expect(html).not.toContain('允许一次');
  expect(html).not.toContain('总是允许');
});
