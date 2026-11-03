import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { trackPendingSend } from '../runtime/cancel';
import { resetOperations } from '../runtime/turnLedger';
import { Message } from './Message';
import type { Msg } from '@/state/types';
const core = vi.hoisted(() => ({ api: vi.fn(), stopping: false }));
vi.mock('../runtime/cancel', async importOriginal => ({ ...await importOriginal<object>(), isTaskStopping: () => core.stopping }));
vi.mock('@/core/client', async importOriginal => ({ ...await importOriginal<object>(), api: core.api }));
const error: Msg = { id: 'e', type: 'system', at: 1, text: '上下文过大', recovery: 'compact' };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  core.stopping = false; core.api.mockReset(); core.api.mockResolvedValue({ turn_id: 'compact-turn' });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  update(s => { s.running = {}; s.convs = [{ id: 'p', owner: 'pc', remote: true, title: '小鹿', updated: 1, messages: [error], personal: { id: 'pa', name: '小鹿', directory: '/pa' } }]; s.drafts['conv:p'] = '未发送草稿'; });
});
afterEach(async () => { resetOperations(); await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => root.render(<Message m={error} ctxId="conv:p" />));
it('PA-CONTEXT-01 AC-2 Personal Agent recovery submits exact compact without resending or clearing history/draft', async () => {
  await render();
  const button = host.querySelector<HTMLButtonElement>('button')!;
  expect(button?.textContent).toContain('压缩上下文');
  await act(async () => button.click());
  expect(core.api).toHaveBeenCalledExactlyOnceWith('POST', '/api/conversations/p/messages', { content: '/compact', files: [] });
  expect(S.convs[0].messages[0]).toBe(error);
  expect(S.drafts['conv:p']).toBe('未发送草稿');
  expect(S.running.p).toBe(true);
});
it.each(['running', 'pending', 'stopping'] as const)('PA-CONTEXT-01 AC-3 compression is disabled during %s', async busy => {
  if (busy === 'running') S.running.p = true;
  else if (busy === 'stopping') core.stopping = true;
  else trackPendingSend('p', Promise.resolve());
  await render();
  const button = host.querySelector<HTMLButtonElement>('button')!;
  expect(button?.disabled).toBe(true);
  await act(async () => button.click());
  expect(core.api).not.toHaveBeenCalled();
});
it.each(['local', 'phone', 'external', 'side'] as const)('PA-CONTEXT-01 AC-4 hides Lom recovery for %s conversations', async kind => {
  const c = S.convs[0];
  if (kind === 'local') c.remote = false;
  if (kind === 'phone') { c.owner = 'dev_phone'; c.phoneSession = 'phone-session'; }
  if (kind === 'external') c.agentId = 'external';
  if (kind === 'side') c.sideOf = 'parent';
  await render();
  expect(host.querySelector('button')).toBeNull();
});
it('PA-CONTEXT-01 AC-4 failed compression reports failure and leaves the existing history available', async () => {
  core.api.mockRejectedValue(new Error('压缩服务不可用'));
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
  expect(S.running.p).toBeUndefined();
  expect(S.convs[0].messages[0]).toBe(error);
  expect(S.toast?.text).toContain('压缩失败');
});
