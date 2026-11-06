import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';

const m = vi.hoisted(() => ({ invoke: vi.fn(), cloud: vi.fn(), toast: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@/features/account/runtime/cloud', async load => ({ ...await load<object>(), cloud: m.cloud }));
vi.mock('@/shared/overlays/controller', async load => ({ ...await load<object>(), toast: m.toast }));

const caps = await import('./phoneCapabilities');
const { ensurePhoneCapabilities } = await import('./phoneCapabilitiesSync');
const { phoneRpc } = await import('./phoneRpc');
const { screenError } = await import('./phoneScreen');

/** 手机的回复：方法名 → 成功的 payload，或抛 Error（message 就是回给桌面的错误码） */
let reply: (method: string) => unknown;
let asked: string[];
const MIKA = ['device.capabilities', 'model.sync', 'chat.send', 'chat.read', 'chat.list', 'chat.cancel', 'document.list', 'document.read', 'schedule.list', 'device.status', 'screen.capture', 'screen.tree', 'screen.control', 'file.begin'];
const unknown = () => { throw new Error('remote.method_unknown'); };

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  S.cloud = 'signed-in'; S.account = { id: `caps-${Math.random()}`, name: '', email: '' };
  S.schedules = []; S.souls = {}; S.memories = {};
  S.agents.dev = { id: 'dev', kind: 'phone', name: '手机', persona: '', status: 'online', real: true, lastSeen: Date.now() };
  asked = [];
  let last = '';
  m.invoke.mockImplementation(async (cmd: string, args: { id?: string; text?: string }) => {
    if (cmd === 'remote_seal') { last = JSON.parse(args.text!).method; asked.push(last); return { id: args.id }; }
    if (cmd === 'remote_open') {
      try { return JSON.stringify({ status: 'ok', payload: JSON.stringify(reply(last)) }); }
      catch (e) { return JSON.stringify({ status: 'error', error: (e as Error).message }); }
    }
    return undefined;
  });
  m.cloud.mockImplementation(async (_m: string, _p: string, body: { id: string }) => ({ id: body.id }));
  reply = () => ({});
});

it('PHONE-CAPS-01 AC-1 Mika 式手机：技能、子代理、定时编辑、文档编辑、附件被隐藏或置灰，看屏幕保留', async () => {
  caps.setPhoneAppVersion('dev', '1.0');
  reply = method => method === 'device.capabilities' ? { version: 1, methods: MIKA, limits: { 'chat.send.max_text_chars': 4000, 'file.max_bytes': 104857600 } } : unknown();
  await ensurePhoneCapabilities('dev');
  expect(asked).toEqual(['device.capabilities']);
  for (const f of ['skills', 'subagents', 'scheduleEdit', 'documentEdit', 'attachments'] as const) expect(caps.phoneFeature('dev', f), f).toBe(false);
  expect(caps.phoneFeature('dev', 'screen')).toBe(true);
  for (const e of ['schedule', 'skills', 'subagents', 'soul', 'memory'] as const) expect(caps.phoneEntryVisible('dev', e), e).toBe(false);
  expect(caps.phoneSupports('dev', 'chat.send')).toBe(true);
  expect(caps.phoneLimit('dev', 'file.max_bytes')).toBe(104857600);
  expect(m.toast).not.toHaveBeenCalled(); // 清单读到就直接生效，不弹提示
});

it('PHONE-CAPS-01 AC-1b 手机上已有只读内容时，对应入口保留为只读视图', async () => {
  caps.setPhoneAppVersion('dev', '1.0');
  reply = method => method === 'device.capabilities' ? { version: 1, methods: MIKA } : unknown();
  await ensurePhoneCapabilities('dev');
  S.schedules = [{ id: 's1', exec: 'dev' } as (typeof S.schedules)[number]]; S.souls = { dev: '# 人格' }; S.memories = { dev: [{ id: 'a', text: 'x', src: 'a', at: 1 }] as never };
  expect(caps.phoneEntryVisible('dev', 'schedule')).toBe(true);
  expect(caps.phoneEntryVisible('dev', 'soul')).toBe(true);
  expect(caps.phoneEntryVisible('dev', 'memory')).toBe(true);
  expect(caps.phoneEntryVisible('dev', 'skills')).toBe(false);
});

it('PHONE-CAPS-01 AC-2 官方手机（不实现该方法）：入口不变，也不弹提示', async () => {
  caps.setPhoneAppVersion('dev', '2.0');
  reply = unknown;
  await ensurePhoneCapabilities('dev');
  for (const f of ['skills', 'subagents', 'scheduleEdit', 'documentEdit', 'attachments', 'screen'] as const) expect(caps.phoneFeature('dev', f), f).toBe(true);
  for (const e of ['schedule', 'skills', 'subagents', 'soul', 'memory'] as const) expect(caps.phoneEntryVisible('dev', e), e).toBe(true);
  expect(caps.phoneSendBlock('dev', 'x'.repeat(100000), [{}])).toBeUndefined();
  expect(m.toast).not.toHaveBeenCalled();
  await ensurePhoneCapabilities('dev');
  expect(asked).toEqual(['device.capabilities']); // 已确认是老手机，不再重复问
});

it('PHONE-CAPS-01 AC-2b 读取失败（不是不支持）不当作全部不支持，按老手机处理并稍后再问', async () => {
  vi.useFakeTimers();
  try {
    caps.setPhoneAppVersion('dev', '1.0');
    reply = () => { throw new Error('remote.not_ready'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await ensurePhoneCapabilities('dev');
    expect(warn).toHaveBeenCalled();
    expect(caps.phoneFeature('dev', 'skills')).toBe(true);
    await ensurePhoneCapabilities('dev');
    expect(asked).toHaveLength(1); // 间隔内不重复问
    vi.advanceTimersByTime(61_000);
    reply = () => ({ version: 1, methods: MIKA });
    await ensurePhoneCapabilities('dev');
    expect(asked).toHaveLength(2);
    expect(caps.phoneFeature('dev', 'skills')).toBe(false);
    warn.mockRestore();
  } finally { vi.useRealTimers(); }
});

it('PHONE-CAPS-01 AC-2c 格式不对的清单当作读取失败，不猜', async () => {
  caps.setPhoneAppVersion('dev', '1.0');
  reply = () => ({ version: 1, methods: 'chat.send' });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  await ensurePhoneCapabilities('dev');
  expect(caps.phoneFeature('dev', 'skills')).toBe(true);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

it('PHONE-CAPS-01 AC-3 运行中回 remote.method_unknown 会被缓存并生效，只提示一次', async () => {
  caps.setPhoneAppVersion('dev', '2.0');
  reply = unknown;
  await expect(phoneRpc('dev', 'skills.list', {})).rejects.toThrow('remote.method_unknown');
  expect(caps.phoneSupports('dev', 'skills.list')).toBe(false);
  expect(caps.phoneFeature('dev', 'skills')).toBe(true); // 技能只有一个方法不支持，整块还在
  for (const method of ['skills.read', 'skills.install', 'skills.toggle', 'skills.delete']) await expect(phoneRpc('dev', method, {})).rejects.toThrow();
  expect(caps.phoneFeature('dev', 'skills')).toBe(false);
  expect(caps.phoneEntryVisible('dev', 'skills')).toBe(false);
  expect(m.toast).toHaveBeenCalledTimes(1);
  expect(m.toast).toHaveBeenCalledWith('这台手机的应用暂不支持技能', 'info');
  expect(JSON.parse(localStorage.getItem('lom.phone.capabilities.v1')!).dev.un).toContain('skills.install');
});

it('PHONE-CAPS-01 AC-3b 其他错误码不会被记成不支持', async () => {
  caps.setPhoneAppVersion('dev', '2.0');
  reply = () => { throw new Error('skills.invalid_id'); };
  await expect(phoneRpc('dev', 'skills.toggle', {})).rejects.toThrow('skills.invalid_id');
  expect(caps.phoneSupports('dev', 'skills.toggle')).toBe(true);
  expect(m.toast).not.toHaveBeenCalled();
});

it('PHONE-CAPS-01 AC-4 手机应用版本变化后清空缓存并重新读取，同版本不变', async () => {
  caps.setPhoneAppVersion('dev', '1.0');
  reply = method => method === 'device.capabilities' ? { version: 1, methods: MIKA } : unknown();
  await ensurePhoneCapabilities('dev');
  await expect(phoneRpc('dev', 'chat.pin', {})).rejects.toThrow();
  expect(caps.phoneFeature('dev', 'skills')).toBe(false);
  caps.setPhoneAppVersion('dev', '1.0');
  expect(caps.phoneFeature('dev', 'skills')).toBe(false); // 同版本：保留
  caps.setPhoneAppVersion('dev', '1.1');
  expect(caps.phoneFeature('dev', 'skills')).toBe(true);
  expect(caps.phoneSupports('dev', 'chat.pin')).toBe(true);
  expect(caps.capabilitiesPending('dev')).toBe(true);
  reply = () => ({ version: 1, methods: [...MIKA, 'skills.list', 'skills.read'] });
  await ensurePhoneCapabilities('dev');
  expect(caps.phoneFeature('dev', 'skills')).toBe(true);
});

it('PHONE-CAPS-01 AC-5 超过手机声明的字数上限就阻止发送并说明；没声明上限则不限制', async () => {
  caps.setPhoneAppVersion('dev', '1.0');
  expect(caps.phoneSendBlock('dev', 'x'.repeat(5000))).toBeUndefined();
  reply = method => method === 'device.capabilities' ? { version: 1, methods: MIKA, limits: { 'chat.send.max_text_chars': 4000, 'future.unknown': 7 } } : unknown();
  await ensurePhoneCapabilities('dev');
  expect(caps.phoneSendBlock('dev', 'x'.repeat(4000))).toBeUndefined();
  expect(caps.phoneSendBlock('dev', 'x'.repeat(4001))).toContain('最多 4000 字');
  expect(caps.phoneSendBlock('dev', 'x'.repeat(3999), [], 2)).toContain('4001 字'); // 发布规则也算在内
});

it('PHONE-CAPS-01 AC-6 手机不支持附件时带附件发送被拦住，提示发送附件不可用', async () => {
  caps.setPhoneAppVersion('dev', '1.0');
  reply = method => method === 'device.capabilities' ? { version: 1, methods: MIKA } : unknown();
  await ensurePhoneCapabilities('dev');
  expect(caps.phoneSendBlock('dev', 'hi', [{ name: 'a.png' }])).toBe('这台手机的应用暂不支持发送附件');
  expect(caps.phoneSendBlock('dev', 'hi')).toBeUndefined();
});

it('PHONE-CAPS-01 AC-7 屏幕权限未开的提示指向手机上的授权，不再固定指向系统无障碍设置', () => {
  const text = screenError(new Error('screen.permission_required'));
  expect(text).toContain('请在手机上授权屏幕查看/操作');
  expect(text).not.toContain('无障碍');
  expect(screenError(new Error('remote.method_unknown'))).toBe('这台手机的应用暂不支持查看屏幕');
});

it('PHONE-CAPS-01 AC-8 解除配对后该设备的能力记录被清除', async () => {
  caps.setPhoneAppVersion('dev', '1.0');
  reply = method => method === 'device.capabilities' ? { version: 1, methods: MIKA } : unknown();
  await ensurePhoneCapabilities('dev');
  caps.dropPhoneCapabilities('dev');
  expect(caps.phoneFeature('dev', 'skills')).toBe(true);
});
