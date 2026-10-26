import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ cloud: vi.fn() }));
vi.mock('@/features/account/runtime/cloud', () => ({ cloud: m.cloud }));
vi.mock('@/features/phones/runtime/deviceStatus', () => ({ syncDeviceStatus: vi.fn() }));
vi.mock('@/features/phones/runtime/deviceName', () => ({ syncPhoneName: vi.fn() }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn() }));
let S: typeof import('@/state/store')['S'];
let devices: typeof import('@/features/phones/runtime/devices');
let auth: typeof import('@/features/account/runtime/authScope');
const phone = (id = 'dev_a') => ({ id, name: id, keys: 'fixture-public-key',
  info: { name: id, model: 'fixture-model', os: 'Android', app_version: '1' },
  paired_at: 1, last_seen_at: 2, online: false });
function switchAccount(id: string | null) {
  auth.beginAuthChange(); S.cloud = id ? 'signed-in' : 'signed-out'; S.account = id ? { id, name: id, email: '' } : null;
}
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear();
  ({ S } = await import('@/state/store')); auth = await import('@/features/account/runtime/authScope');
  devices = await import('@/features/phones/runtime/devices');
  switchAccount('a');
  S.teams = [{ id: 'team', name: 'team', folder: '', created: 1, panes: {}, members: [{ mid: 'pc', agent: 'pc', role: 'Leader' }] }];
  m.cloud.mockResolvedValue([]);
});
function configurePhone() {
  devices.applyDevices([phone()]);
  S.teams[0].members.push({ mid: 'phone', agent: 'dev_a', role: 'Researcher', model: 'fixture-model' });
  S.agents.dev_a.persona = 'private persona'; S.agents.dev_a.model = 'fixture-model'; S.lit.dev_a = true;
  S.customGroups.dev_a = [{ id: 'group-a', name: 'Private group' }];
}

it('D26 AC-4 temporary sign-out hides phones while preserving same-account team configuration', async () => {
  configurePhone(); switchAccount(null); await devices.syncDevices();
  expect(S.agents.dev_a).toBeUndefined(); expect(S.phoneOrder).not.toContain('dev_a');
  expect(S.teams[0].members.map(m => m.agent)).toEqual(['pc']);
  switchAccount('a'); devices.applyDevices([phone()]);
  expect(S.agents.dev_a).toMatchObject({ persona: 'private persona', model: 'fixture-model' });
  expect(S.lit.dev_a).toBe(true); expect(S.customGroups.dev_a[0].name).toBe('Private group');
  expect(S.teams[0].members).toContainEqual(expect.objectContaining({ mid: 'phone', agent: 'dev_a', role: 'Researcher' }));
});

it('D26 AC-4 account switches isolate roster metadata and team phone memberships', async () => {
  configurePhone(); switchAccount('b'); devices.applyDevices([phone('dev_b')]);
  expect(S.agents.dev_a).toBeUndefined(); expect(S.customGroups.dev_a).toBeUndefined();
  expect(S.teams[0].members.some(m => m.agent === 'dev_a')).toBe(false);
  S.teams[0].members.push({ mid: 'phone-b', agent: 'dev_b', role: 'Other role' });
  switchAccount('a'); devices.applyDevices([phone()]);
  expect(S.agents.dev_b).toBeUndefined(); expect(S.teams[0].members.some(m => m.agent === 'dev_b')).toBe(false);
  expect(S.teams[0].members.some(m => m.agent === 'dev_a')).toBe(true);
});

it('D26 AC-4 a successful empty cloud roster really removes unpaired members', async () => {
  configurePhone(); devices.applyDevices([]);
  expect(S.teams[0].members.map(m => m.agent)).toEqual(['pc']);
  switchAccount(null); await devices.syncDevices(); switchAccount('a'); devices.applyDevices([phone()]);
  expect(S.teams[0].members.map(m => m.agent)).toEqual(['pc']);
});

it('D26 AC-4 persisted phone configuration survives restart without appearing in another account', async () => {
  configurePhone(); switchAccount(null); await devices.syncDevices();
  vi.resetModules();
  ({ S } = await import('@/state/store')); auth = await import('@/features/account/runtime/authScope');
  devices = await import('@/features/phones/runtime/devices');
  switchAccount('b'); devices.applyDevices([phone('dev_b')]);
  expect(S.agents.dev_a).toBeUndefined(); expect(S.teams[0].members.some(m => m.agent === 'dev_a')).toBe(false);
  switchAccount('a'); devices.applyDevices([phone()]);
  expect(S.agents.dev_a.persona).toBe('private persona');
  expect(S.teams[0].members).toContainEqual(expect.objectContaining({ mid: 'phone', agent: 'dev_a', role: 'Researcher' }));
});

it('D26 AC-4 delayed device removal cannot apply to a newly signed-in session', async () => {
  configurePhone(); let resolve!: (value: unknown) => void;
  m.cloud.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const removing = devices.removeDevice('dev_a'); const rejected = expect(removing).rejects.toThrow('账号已切换');
  switchAccount(null); await devices.syncDevices(); switchAccount('a'); devices.applyDevices([phone()]);
  resolve({}); await rejected;
  expect(S.agents.dev_a).toBeDefined(); expect(S.teams[0].members.some(m => m.agent === 'dev_a')).toBe(true);
});

it('D26 AC-4 legacy global member references are restored only for verified device ownership', () => {
  S.teams[0].members.push({ mid: 'legacy', agent: 'dev_legacy_a', role: 'Private role' });
  devices.applyDevices([phone('dev_b')]);
  expect(S.teams[0].members.some(m => m.agent === 'dev_legacy_a')).toBe(false);
  switchAccount('legacy-owner'); devices.applyDevices([phone('dev_legacy_a')]);
  expect(S.teams[0].members.some(m => m.agent === 'dev_legacy_a')).toBe(true);
});
