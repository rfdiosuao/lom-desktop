import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { initialState } from '@/state/state';

const m = vi.hoisted(() => ({ rpc: vi.fn(), toast: vi.fn(), sendPhone: vi.fn() }));
vi.mock('../runtime/phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('@/shared/overlays/controller', async load => ({ ...await load<object>(), toast: m.toast }));
vi.mock('@/features/phones/runtime/phoneChat', async load => ({ ...await load<object>(), sendPhone: m.sendPhone }));
vi.mock('@/features/schedules/runtime/schedules', () => ({ syncSchedules: vi.fn() }));
vi.mock('@/features/phones/runtime/phoneSchedules', async load => ({ ...await load<object>(), syncPhoneSchedules: vi.fn().mockResolvedValue(undefined) }));

const caps = await import('../runtime/phoneCapabilities');
const { PhoneSkills, PhoneSoul, PhoneMemory } = await import('./PhonePages');
const { PhoneSubagents } = await import('./PhoneSubagents');
const { SchedulePage } = await import('@/features/schedules/ui/Schedule');
const { PhoneSidebar } = await import('@/app/shell/Sidebars');
const { Composer } = await import('@/features/chat/ui/Composer');
const { MENUS } = await import('@/app/overlays/menu-registry');
const { send } = await import('@/features/chat/actions/composer');
const { editSched } = await import('@/features/schedules/actions/schedule');

const MIKA = ['device.capabilities', 'model.sync', 'chat.send', 'chat.read', 'chat.list', 'chat.cancel', 'document.list', 'document.read', 'schedule.list', 'device.status', 'screen.capture'];
let host: HTMLDivElement, root: Root, n = 0;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const render = (node: React.ReactNode) => act(async () => root.render(node));
const labels = () => Array.from(host.querySelectorAll('.nav-item, [role="button"], button')).map(x => x.textContent || '');

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  Object.assign(S, initialState(true)); S.account = { id: `caps-ui-${++n}` } as typeof S.account; S.cloud = 'signed-in';
  S.agents.dev = { ...S.agents.p1, id: 'dev', kind: 'phone', real: true, status: 'online' };
  S.phoneOrder = ['dev']; S.phoneId = 'dev'; S.mode = 'phone'; S.convs = []; S.schedules = [];
  caps.setPhoneAppVersion('dev', '1.0');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const asMika = () => caps.applyCapabilities('dev', { version: 1, methods: MIKA, limits: { 'chat.send.max_text_chars': 10 } });

it('PHONE-CAPS-01 AC-1 Mika 式手机的侧栏不出现定时、技能、子代理、人格、记忆；官方手机入口不变', async () => {
  await render(<PhoneSidebar />);
  for (const name of ['定时任务', '技能', '子代理', '人格 · SOUL.md', '记忆']) expect(host.textContent, name).toContain(name); // 老手机 / 未读到清单：全部显示
  asMika();
  await render(<PhoneSidebar />);
  for (const name of ['定时任务', '技能', '子代理', '人格 · SOUL.md', '记忆']) expect(host.textContent, name).not.toContain(name);
  expect(host.textContent).toContain('会话');
});

it('PHONE-CAPS-01 AC-1 直接进入技能、子代理页时说明不支持，且不再向手机发请求', async () => {
  asMika();
  await render(<PhoneSkills />);
  expect(host.textContent).toContain('这台手机的应用暂不支持技能');
  await render(<PhoneSubagents />);
  expect(host.textContent).toContain('这台手机的应用暂不支持子代理');
  expect(m.rpc).not.toHaveBeenCalled();
});

it('PHONE-CAPS-01 AC-1 不支持编辑的手机：人格和记忆页只读并说明，不显示保存、添加、删除', async () => {
  asMika();
  S.souls.dev = '# 人格'; S.memories.dev = [{ id: 'a', text: '喜欢茶', src: 'a', at: 1 }] as never;
  await render(<PhoneSoul />);
  expect(host.textContent).toContain('这台手机的应用暂不支持编辑');
  expect((host.querySelector('textarea') as HTMLTextAreaElement).readOnly).toBe(true);
  expect(labels().join('|')).not.toContain('保存');
  await render(<PhoneMemory />);
  expect(host.textContent).toContain('喜欢茶');
  expect(host.textContent).toContain('这台手机的应用暂不支持编辑');
  expect(labels().join('|')).not.toMatch(/添加记忆|清空全部/);
  expect(host.querySelector('[aria-label="编辑"], [aria-label="删除"]')).toBeNull();
});

it('PHONE-CAPS-01 AC-1 不支持编辑定时的手机：定时页只读，新建被拦住并说明', async () => {
  asMika();
  S.route = { name: 'phone-schedule' };
  S.schedules = [{ id: 's1', name: '早报', exec: 'dev', prompt: '总结', freq: 'daily', time: '09:00', days: [1], every: 60, enabled: true, runIn: 'new', phoneTask: 't1' } as never];
  await render(<SchedulePage />);
  expect(host.textContent).toContain('早报');
  expect(host.textContent).toContain('这台手机的应用暂不支持编辑定时任务');
  expect(labels().join('|')).not.toContain('新建定时任务');
  expect(host.querySelector('[aria-label="立即运行"]')).toBeNull();
  editSched({ exec: 'dev' });
  expect(m.toast).toHaveBeenCalledWith('这台手机的应用暂不支持编辑定时任务', 'info');
  expect(S.modals).toHaveLength(0);
});

it('PHONE-CAPS-01 AC-6 手机不支持附件：添加菜单里的文件、图片、发送文件置灰并说明；官方手机不变', () => {
  S.route = { name: 'home' };
  const items = () => (MENUS.attach({ ckey: 'home' }) as { label?: string; disabled?: boolean; desc?: string }[]).filter(i => ['文件', '添加图片', '发送文件到手机'].includes(i.label || ''));
  expect(items().every(i => !i.disabled)).toBe(true);
  asMika();
  expect(items()).toHaveLength(3);
  for (const item of items()) { expect(item.disabled).toBe(true); expect(item.desc).toBe('这台手机的应用暂不支持发送附件'); }
});

it('PHONE-CAPS-01 AC-5 输入超过手机字数上限时输入框提示，发送被拦住且草稿保留', async () => {
  asMika();
  S.drafts.home = '短消息';
  await render(<Composer ckey="home" />);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => { S.drafts.home = '这是一条明显超过十个字的很长很长的消息'; });
  await render(<Composer ckey="home" />);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('最多 10 字');
  await act(async () => { await send('home'); });
  expect(m.sendPhone).not.toHaveBeenCalled();
  expect(m.toast).toHaveBeenCalledWith(expect.stringContaining('最多 10 字'), 'info');
  expect(S.drafts.home).toContain('很长很长');
});
