import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';

const m = vi.hoisted(() => ({
  api: vi.fn(), toast: vi.fn(), toastError: vi.fn(), convs: [] as Conv[],
}));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
vi.mock('@/shared/overlays/controller', () => ({
  toast: m.toast, toastError: m.toastError, openMenu: vi.fn(), openModal: vi.fn(), closeModal: vi.fn(), confirm: vi.fn(), prompt: vi.fn(), topModal: () => undefined,
}));
vi.mock('@/features/teams/runtime/team', () => ({ convOfKey: (key: string) => m.convs.find(c => `conv:${c.id}` === key) }));
vi.mock('../runtime/sideChat', () => ({ openSideChat: vi.fn(), closeSideChat: vi.fn() }));
const { pickEffort } = await import('./commands');

const extConv = (): Conv => ({
  id: 'ag1', owner: 'pc', title: 'Qoder task', updated: 1, messages: [], remote: true, loaded: true, agentId: 'ag', agentName: 'Qoder',
});
const options = (current: string) => [{
  id: 'thought_level', category: 'thought_level', current_value: current, options: [{ value: 'fast' }, { value: 'deep' }],
}];

beforeEach(() => {
  vi.clearAllMocks();
  const c = extConv();
  m.convs = [c];
  S.convs = [c];
  S.agentOptions = { ag1: options('fast') };
  S.agentEffortPick = {};
  S.menu = null;
});

it('EFFORT-01 UI: without a core echo the menu keeps the old tier and the toast says unconfirmed', async () => {
  m.api.mockResolvedValueOnce({ confirmation: 'observed' });
  await pickEffort('conv:ag1', 'deep');
  expect(S.agentOptions.ag1[0].current_value).toBe('fast');
  const text = m.toast.mock.calls.map(c => String(c[0])).join(' ');
  expect(text).toContain('无法确认');
  expect(text).not.toContain('已生效');
  expect(m.toast).toHaveBeenLastCalledWith(expect.stringContaining('无法确认'), 'info');
});

it('EFFORT-01 UI: only an echoed matching tier is shown as applied', async () => {
  m.api.mockResolvedValueOnce({ confirmation: 'observed', config_options: options('deep') });
  await pickEffort('conv:ag1', 'deep');
  expect(S.agentOptions.ag1[0].current_value).toBe('deep');
  expect(m.toast).toHaveBeenLastCalledWith(expect.stringContaining('已生效'), 'brain');
});

it.each(['command_ack', undefined, 'future_confirmation'])('EFFORT-01 E3: %s plus an echo never claims observed', async confirmation => {
  m.api.mockResolvedValueOnce({ confirmation, config_options: options('deep') });
  await pickEffort('conv:ag1', 'deep');
  expect(S.agentOptions.ag1[0].current_value).toBe('fast');
  expect(m.toast).toHaveBeenLastCalledWith(expect.stringContaining('无法确认'), 'info');
  expect(m.toast.mock.calls.map(c => String(c[0])).join(' ')).not.toContain('已生效');
});

it('EFFORT-01 E3: a partial response cannot reuse a cached tier as fresh confirmation', async () => {
  S.agentOptions.ag1 = options('deep');
  m.api.mockResolvedValueOnce({ confirmation: 'observed', config_options: [
    { id: 'model', current_value: 'model-1', options: [{ value: 'model-1' }] },
  ] });
  await pickEffort('conv:ag1', 'deep');
  expect(S.agentOptions.ag1.find(o => o.id === 'thought_level')?.current_value).toBe('deep');
  expect(m.toast).toHaveBeenLastCalledWith(expect.stringContaining('无法确认'), 'info');
});
