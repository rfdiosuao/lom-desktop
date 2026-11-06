import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
const m = vi.hoisted(() => ({ rpc: vi.fn(), model: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@/features/account/runtime/cloud', async load => ({ ...await load<typeof import('@/features/account/runtime/cloud')>(), cloud: vi.fn() }));
vi.mock('@/shared/overlays/controller', async load => ({ ...await load<typeof import('@/shared/overlays/controller')>(), toast: vi.fn(), toastError: vi.fn() }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('./phoneModel', async load => ({ ...await load<typeof import('./phoneModel')>(), ensurePhoneModel: m.model, syncPhoneModel: vi.fn() }));
vi.mock('./phoneCache', () => ({ savePhoneCache: vi.fn(async () => undefined), loadPhoneCache: vi.fn() }));
vi.mock('@/app/sound', () => ({ taskFinished: vi.fn() }));
import { send } from '@/features/chat/actions/composer';
import { applyDevices, dropPhone, type CloudDevice } from './devices';
import { phoneSupports, setPhoneAppVersion, applyCapabilities, phoneLimit } from './phoneCapabilities';
import { linkSnapshot, recordRpc } from './deviceLink';

const device = (id: string, name: string, app: string): CloudDevice => ({ id, name, keys: 'k', info: { name, model: 'M', os: 'Android', app_version: app }, paired_at: 1, last_seen_at: 2, online: true });
const chatSends = () => m.rpc.mock.calls.filter(c => c[1] === 'chat.send').map(c => c[0]);
async function sendHome(text: string) { update(s => { s.drafts.home = text; }); await send('home'); }

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  S.account = { id: 'a', name: 'A', email: '' }; S.cloud = 'signed-in'; S.mode = 'phone';
  S.phoneOrder = []; S.agents = {}; S.phoneId = ''; S.convs = []; S.running = {}; S.drafts = {}; S.attachments = {}; S.activeConv = null; S.route = { name: 'home' };
  m.model.mockResolvedValue(undefined);
  m.rpc.mockImplementation(async (_d: string, method: string) => method === 'chat.send' ? { session_id: 's1' }
    : { items: [], total: 0, next: 0, running: false, status: 'idle', error: '' });
});

it('PHONE-REPAIR-01 pairing A, chatting, unpairing it and pairing B sends to B without a restart', async () => {
  applyDevices([device('dev_a', '官方手机', '1.0')]);
  S.phoneId = 'dev_a';
  await sendHome('你好，官方手机');
  expect(chatSends()).toEqual(['dev_a']);
  const convA = S.convs[0];
  update(s => { dropPhone(s, 'dev_a'); });
  expect(S.phoneId).toBe('');
  applyDevices([device('dev_b', 'Mika 手机', '2.0')]);
  expect(S.phoneId).toBe('dev_b');
  await sendHome('你好，Mika');
  expect(chatSends()).toEqual(['dev_a', 'dev_b']);
  expect(S.convs.find(c => c.owner === 'dev_b')?.phoneSession).toBe('s1');
  expect(convA.owner).toBe('dev_a');
});

it('PHONE-REPAIR-01 unpairing clears the connection record, capability list, running state and open chat of that phone', () => {
  applyDevices([device('dev_a', '官方手机', '1.0'), device('dev_c', '备用手机', '1.0')]);
  S.phoneId = 'dev_a';
  applyCapabilities('dev_a', { version: 1, methods: ['chat.send'], limits: { 'chat.send.max_text_chars': 5 } });
  recordRpc('dev_a', true);
  S.convs = [{ id: 'phone:dev_a:s1', owner: 'dev_a', phoneSession: 's1', title: 't', updated: 1, messages: [], phonePending: { client_id: 'x', session_id: 's1', text: 'old' } }];
  S.running['phone:dev_a:s1'] = true; S.activeConv = 'phone:dev_a:s1'; S.route = { name: 'chat' };
  expect(phoneSupports('dev_a', 'chat.cancel')).toBe(false);
  update(s => { dropPhone(s, 'dev_a'); });
  expect(S.phoneId).toBe('dev_c');
  expect(linkSnapshot('dev_a').rpc).toBe('unknown');
  expect(phoneSupports('dev_a', 'chat.cancel')).toBe(true);
  expect(phoneLimit('dev_a', 'chat.send.max_text_chars')).toBeUndefined();
  expect(S.running['phone:dev_a:s1']).toBeUndefined();
  expect(S.activeConv).toBeNull(); expect(S.route).toEqual({ name: 'home' });
  expect(S.convs[0].phonePending).toBeUndefined();
});

it('PHONE-REPAIR-01 a new phone starts with its own capability list, never the previous phone\'s', () => {
  applyDevices([device('dev_a', '官方手机', '1.0')]);
  applyCapabilities('dev_a', { version: 1, methods: ['chat.send'], limits: { 'chat.send.max_text_chars': 5 } });
  update(s => { dropPhone(s, 'dev_a'); });
  applyDevices([device('dev_b', 'Mika 手机', '2.0')]);
  setPhoneAppVersion('dev_b', '2.0');
  expect(phoneSupports('dev_b', 'screen.capture')).toBe(true);
  expect(phoneLimit('dev_b', 'chat.send.max_text_chars')).toBeUndefined();
});
