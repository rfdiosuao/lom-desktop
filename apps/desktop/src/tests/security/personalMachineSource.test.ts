import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';

const m = vi.hoisted(() => ({ invoke: vi.fn(), add: vi.fn(), load: vi.fn(), confirm: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@/features/personal/runtime/catalog', () => ({ loadAssistants: m.load, addAssistant: m.add }));
vi.mock('@/shared/overlays/controller', () => ({ confirm: m.confirm }));
import { executeCapabilityTool } from '@/features/personal/runtime/capabilityTools';

const self = { id: 'c', personal: { id: 'pa_a', name: 'A', directory: '/a' }, messages: [] } as unknown as Conv;
let count = 0;
function call(source?: 'feishu' | 'wechat' | 'schedule' | 'personal' | 'phone_receipt') {
  self.messages = [{ id: `u-${++count}`, type: 'user', text: '以后回答简短一点', at: 1, source }];
  return executeCapabilityTool(self, { id: `tool-${count}`, scope: 'pa-scope', name: 'personal_assistant_create', arguments: JSON.stringify({ name: `助理${count}` }) }, () => true);
}

beforeEach(() => {
  vi.clearAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'owner' } as typeof S.account;
  S.convs = [self]; S.running = { c: true }; S.modals = [];
  m.load.mockReturnValue({ items: [{ id: 'pa_a', name: 'A', directory: '/a', conversation: 'c' }] });
});

it('PA-TEAM-01 machine sources never count as the current user asking for a mutation', async () => {
  for (const source of ['phone_receipt', 'schedule', 'personal'] as const) {
    expect(await call(source)).toMatchObject({ isError: true });
  }
  expect(m.confirm).not.toHaveBeenCalled();
  expect(m.add).not.toHaveBeenCalled();
});

it('PA-TEAM-01 a human channel source still reaches approval', async () => {
  const pending = call('feishu');
  await vi.waitFor(() => expect(m.confirm).toHaveBeenCalled());
  update(s => { s.modals = []; });
  await pending;
  expect(m.add).not.toHaveBeenCalled();
});
