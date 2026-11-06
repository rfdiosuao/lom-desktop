import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { phoneAppText } from '@/state/selectors';
import type { Agent } from '@/state/types';
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('@/shared/overlays/controller', async load => ({ ...await load<object>(), toast: vi.fn() }));
import { Avatar } from '@/shared/ui/Agent';
import { dropPhoneProfile, phoneProfile, syncPhoneProfile } from './phoneProfile';
import { applyCapabilities } from './phoneCapabilities';
import { applyDevices, type CloudDevice } from './devices';

const png = (side = 64) => {
  const b = new Uint8Array(48);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, side, 0, 0, 0, side]);
  return b;
};
const hex = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource)), x => x.toString(16).padStart(2, '0')).join('');
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
async function phone(over: { app?: string; bytes?: Uint8Array; mime?: string; sha?: string; skipHash?: boolean } = {}) {
  const bytes = over.bytes ?? png(), sha = over.sha ?? await hex(bytes);
  return {
    profile: { app_name: over.app ?? 'Mika 麓鸣版', logo_sha256: sha, logo_mime: over.mime ?? 'image/png', logo_size: String(bytes.length), sampled_at: '1' },
    logo: { mime: over.mime ?? 'image/png', sha256: sha, size: String(bytes.length), data: b64(bytes) },
  };
}
const answer = (reply: { profile: object; logo: object }) => m.rpc.mockImplementation(async (_d: string, method: string) => {
  if (method === 'device.profile') return reply.profile;
  if (method === 'device.logo') return reply.logo;
  throw new Error(`unexpected ${method}`);
});
const dev = (id: string, version = '2.0.1'): CloudDevice => ({ id, name: '我的手机', keys: 'k', info: { name: '我的手机', model: 'Pixel', os: 'Android', app_version: version }, paired_at: 1, last_seen_at: 2, online: true });
const logos = () => m.rpc.mock.calls.filter(c => c[1] === 'device.logo').length;

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(1_000_000);
  S.account = { id: `a${Math.random()}`, name: 'A', email: '' }; S.cloud = 'signed-in'; S.phoneOrder = []; S.agents = {}; S.phoneId = '';
  applyDevices([dev('dev_m')]);
});
afterEach(() => vi.useRealTimers());

it('PHONE-PROFILE-02 AC-1 a phone that reports its app name and logo shows both, with the version from pairing', async () => {
  answer(await phone());
  await syncPhoneProfile('dev_m');
  const a = S.agents.dev_m;
  expect(a.appName).toBe('Mika 麓鸣版');
  expect(a.logo).toMatch(/^data:image\/png;base64,/);
  expect(phoneAppText(a)).toBe('Mika 麓鸣版 v2.0.1');
});

it('PHONE-PROFILE-02 AC-2 the logo is fetched once per hash, not on every refresh', async () => {
  answer(await phone());
  await syncPhoneProfile('dev_m');
  vi.setSystemTime(1_000_000 + 61_000);
  await syncPhoneProfile('dev_m');
  expect(logos()).toBe(1);
  expect(m.rpc.mock.calls.filter(c => c[1] === 'device.profile')).toHaveLength(2);
});

it('PHONE-PROFILE-02 AC-3 a phone that reports nothing shows a generic icon and an unknown app, never a guess from the model', async () => {
  m.rpc.mockRejectedValue(Object.assign(new Error('remote.method_unknown'), { code: 'remote.method_unknown' }));
  await syncPhoneProfile('dev_m');
  const a = S.agents.dev_m;
  expect(a.appName).toBeUndefined(); expect(a.logo).toBeUndefined();
  expect(phoneAppText(a)).toBe('未知应用 v2.0.1');
});

it('PHONE-PROFILE-02 AC-4 a phone whose capability list lacks device.profile is never asked', async () => {
  applyCapabilities('dev_m', { version: 1, methods: ['chat.send'] });
  await syncPhoneProfile('dev_m');
  expect(m.rpc).not.toHaveBeenCalled();
});

it.each([
  ['an SVG', () => phone({ bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'.padEnd(48, ' ')), mime: 'image/png' })],
  ['a hash the desktop cannot reproduce', async () => phone({ sha: 'a'.repeat(64) })],
  ['a wrong declared type', () => phone({ mime: 'image/jpeg' })],
  ['an image smaller than 64 px', () => phone({ bytes: png(32) })],
])('PHONE-PROFILE-02 AC-5 %s is dropped; the app name still shows and no error is raised', async (_n, make) => {
  answer(await make());
  await expect(syncPhoneProfile('dev_m')).resolves.toBeUndefined();
  expect(S.agents.dev_m.logo).toBeUndefined();
  expect(S.agents.dev_m.appName).toBe('Mika 麓鸣版');
});

it('PHONE-PROFILE-02 AC-6 control characters are stripped and the app name is capped at 40 characters', async () => {
  answer(await phone({ app: `‮Mika\u0000\n${'长'.repeat(60)}` }));
  await syncPhoneProfile('dev_m');
  expect(S.agents.dev_m.appName).toBe(`Mika${'长'.repeat(36)}`);
});

it('PHONE-PROFILE-02 AC-7 a failed read keeps the last known profile and is not treated as unsupported', async () => {
  answer(await phone());
  await syncPhoneProfile('dev_m');
  vi.setSystemTime(1_000_000 + 61_000);
  m.rpc.mockRejectedValue(new Error('remote.not_ready'));
  await syncPhoneProfile('dev_m');
  expect(S.agents.dev_m.appName).toBe('Mika 麓鸣版'); expect(S.agents.dev_m.logo).toBeDefined();
});

it('PHONE-PROFILE-02 AC-8 the app name survives a restart while the logo bytes are never written to storage', async () => {
  answer(await phone());
  await syncPhoneProfile('dev_m');
  const stored = JSON.stringify(Object.fromEntries(Object.entries(localStorage)));
  expect(stored).toContain('Mika 麓鸣版'); expect(stored).not.toContain('base64'); expect(stored).not.toContain(b64(png()).slice(0, 20));
});

it('PHONE-PROFILE-02 AC-9 unpairing clears the profile', async () => {
  answer(await phone());
  await syncPhoneProfile('dev_m');
  dropPhoneProfile('dev_m');
  expect(phoneProfile('dev_m')).toEqual({ appName: undefined, logo: undefined });
});

it('PHONE-PROFILE-02 AC-10 the avatar draws the phone logo as an image, and a phone without one keeps the generic icon', async () => {
  const host = document.createElement('div'); const root = createRoot(host);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const a: Agent = { ...S.agents.dev_m, logo: 'data:image/png;base64,AAAA' };
  await act(async () => root.render(<><Avatar agent={a} /><Avatar agent={S.agents.dev_m} /></>));
  const avatars = host.querySelectorAll('.avatar');
  expect(avatars[0].querySelector('img.avatar__image')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  expect(avatars[1].querySelector('img')).toBeNull(); expect(avatars[1].querySelector('svg')).not.toBeNull();
  await act(async () => root.unmount());
  update(() => {});
});
