import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { initialState } from '@/state/state';

const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', async original => ({ ...await original<typeof import('@/core/client')>(), api: mock.api }));
import { resetSnapshot } from '../runtime/snapshot';
import { WsChanges } from './WsActivity';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const row = (relative: string, operation: string) => ({ file_path: `/w/proj/${relative}`, relative_path: relative, operation });
const text = () => host.querySelector('[aria-label="真实文件状态"]')?.textContent ?? '';
const radio = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(b => b.textContent === label);

async function mount(turnBase?: unknown) {
  Object.assign(S, initialState()); S.homeDir = '/Users/me'; S.folder = '/w/proj'; resetSnapshot();
  S.convs = [{ id: 'c1', title: 't', remote: true, workspace: '/w/proj', messages: [{ id: 'u1', type: 'user', at: 1 }] } as never];
  S.activeConv = 'c1'; S.route = { name: 'chat' } as never;
  if (turnBase) S.turnBase = { c1: turnBase } as never;
  mock.api.mockReset();
  mock.api.mockImplementation(async (_m: string, path: string) => path.endsWith('/init') ? { mode: 'git-repo', branch: 'main' }
    : { staged: [], unstaged: [row('old.ts', 'modify'), row('new.ts', 'create')] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<WsChanges />));
}
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('WS-SNAPSHOT-02 #402 the page shows this turn first, using the state recorded when the message was sent', async () => {
  await mount({ msgId: 'u1', workspace: '/w/proj', at: 1, status: 'ready', files: { '/w/proj/old.ts': 'modify' } });
  expect(radio('本轮')?.getAttribute('aria-checked')).toBe('true');
  expect(text()).toContain('new.ts');
  expect(text()).not.toContain('old.ts');
  expect(text()).toContain('发送这条消息时');
});

it('WS-SNAPSHOT-02 #402 the whole difference from the baseline is one click away', async () => {
  await mount({ msgId: 'u1', workspace: '/w/proj', at: 1, status: 'ready', files: { '/w/proj/old.ts': 'modify' } });
  await act(async () => radio('全部未提交')!.click());
  expect(text()).toContain('old.ts'); expect(text()).toContain('new.ts');
  expect(text()).toContain('Git 仓库');
});

it('WS-SNAPSHOT-02 #402 without a recording for the latest message it says so and shows the whole difference', async () => {
  await mount({ msgId: 'older', workspace: '/w/proj', at: 1, status: 'ready', files: {} });
  expect(radio('本轮')).toBeUndefined();
  expect(text()).toContain('没有记录到这一轮开始时的文件状态');
  expect(text()).toContain('old.ts');
});

it('WS-SNAPSHOT-02 #402 a failed recording shows its reason instead of a made-up turn list', async () => {
  await mount({ msgId: 'u1', workspace: '/w/proj', at: 1, status: 'failed', files: {}, code: 'FILE_INTERNAL', error: '快照失败' });
  expect(radio('本轮')).toBeUndefined();
  expect(text()).toContain('FILE_INTERNAL');
  expect(text()).toContain('old.ts');
});
