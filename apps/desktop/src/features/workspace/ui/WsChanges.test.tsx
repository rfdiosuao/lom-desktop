import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { update } from '@/state/store';
import type { Msg } from '@/state/types';
import { WsChanges } from './WsActivity';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const msg = (id: string, type: Msg['type'], extra: Partial<Msg> = {}): Msg => ({ id, type, at: 1, ...extra });

async function show(messages: Msg[]) {
  await act(async () => update(s => {
    s.convs = [{ id: 'c1', title: 't', messages } as never];
    s.activeConv = 'c1';
    s.route = { name: 'chat' } as never;
  }));
}

beforeEach(async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<WsChanges />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('WS-CHANGES-01 #402 the list says it is this turn and inferred from tool calls', async () => {
  await show([
    msg('u1', 'user'), msg('f1', 'files', { changes: [{ path: 'old.ts', add: 5, del: 0 }] }),
    msg('u2', 'user'), msg('f2', 'files', { changes: [{ path: 'new.ts', add: 2, del: 1 }] }),
  ]);
  const text = host.textContent ?? '';
  expect(text).toContain('本轮');
  expect(text).toContain('根据工具调用推断');
  expect(text).toContain('new.ts');
  expect(text).not.toContain('old.ts');
});

it('WS-CHANGES-01 #402 an empty turn says so instead of showing earlier turns', async () => {
  await show([msg('u1', 'user'), msg('f1', 'files', { changes: [{ path: 'old.ts', add: 5, del: 0 }] }), msg('u2', 'user')]);
  expect(host.textContent).toContain('本轮还没有文件变更');
  expect(host.textContent).not.toContain('old.ts');
});
