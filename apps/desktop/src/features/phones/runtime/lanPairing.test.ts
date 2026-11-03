import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => true }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { lanMode, phoneGuard } from './deviceLink';
import { applyDevices, listDevices, pairingStatus, startPairing } from './devices';
import { savePhoneCache } from './phoneCache';

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); Object.assign(S, initialState());
  S.cloud = 'signed-out';
});

it('LAN-PAIR-01 activates only when the community build has no cloud session', () => {
  expect(lanMode()).toBe(true);
  expect(phoneGuard()()).toBe(true);
  S.cloud = 'signed-in';
  expect(lanMode()).toBe(false);
  expect(phoneGuard()()).toBe(false);
});

it('LAN-PAIR-01 starts and polls a local pairing session without the cloud', async () => {
  m.invoke.mockImplementation((cmd: string) => {
    if (cmd === 'lan_pair_start') return Promise.resolve({ pairingId: 'p1', qrSvg: '<svg/>', expiresAt: 1700000000 });
    if (cmd === 'lan_pair_status') return Promise.resolve({ state: 'claimed', device_name: 'Pixel', device_keys: 'keys', device_id: null });
    throw new Error(`unexpected ${cmd}`);
  });
  await expect(startPairing()).resolves.toMatchObject({ pairingId: 'p1', manualCode: '', qrSvg: '<svg/>', expiresAt: 1700000000000 });
  await expect(pairingStatus('p1')).resolves.toMatchObject({
    state: 'claimed', method: 'qr', device_keys: 'keys', device_id: null,
    device_info: { name: 'Pixel' },
  });
  expect(m.invoke.mock.calls.map(([cmd]) => cmd)).toEqual(['lan_pair_start', 'lan_pair_status']);
});

it('LAN-PAIR-01 lists paired phones and applies them to the phone sidebar', async () => {
  m.invoke.mockResolvedValue([{
    id: 'dev_lan', name: 'Pixel', model: 'Pixel 9', os: 'Android', app_version: '1.0',
    keys: 'keys', online: true, last_seen_at: 1700000000,
  }]);
  await expect(listDevices()).resolves.toMatchObject([{
    id: 'dev_lan', name: 'Pixel', online: true,
    info: { model: 'Pixel 9', os: 'Android', app_version: '1.0' },
  }]);
  applyDevices(await listDevices());
  expect(S.agents.dev_lan).toMatchObject({ real: true, kind: 'phone', name: 'Pixel', status: 'online' });
  expect(S.phoneOrder).toContain('dev_lan');
});

it('LAN-PAIR-01 keeps phone history in the local LAN cache', async () => {
  S.convs = [{ id: 'c1', owner: 'dev_lan', title: '任务', updated: 1, messages: [] } as never];
  await savePhoneCache();
  expect(localStorage.getItem('lom.phone-cache.v1:lan')).toContain('dev_lan');
});
