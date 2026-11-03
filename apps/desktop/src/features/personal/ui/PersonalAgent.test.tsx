import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { PersonalAgent } from './PersonalAgent';
import '@/shared/styles/personal.css';
import { ensureConversation, linkWorkspace } from '../runtime/session';
import { addAssistant, loadAssistants } from '../runtime/catalog';
import { deleteAssistant } from '../runtime/deleteAssistant';
import { pickFolder } from '@/core/platform';
vi.mock('../runtime/catalog', () => ({ loadAssistants: vi.fn(), storeAssistant: vi.fn(), addAssistant: vi.fn(), assistantNameError: (name: string) => (name.trim() ? undefined : '助理名称须为1至40个字符') }));
vi.mock('../runtime/session', () => ({ ensureConversation: vi.fn(), linkWorkspace: vi.fn() }));
vi.mock('@/core/platform', async load => ({ ...await load<typeof import('@/core/platform')>(), pickFolder: vi.fn() }));
vi.mock('../runtime/deleteAssistant', () => ({ deleteAssistant: vi.fn(async () => {}) }));
vi.mock('./PersonalDocuments', () => ({ PersonalDocuments: ({ assistant }: any) => <div>文档：{assistant.name}</div> }));
vi.mock('./PersonalSchedules', () => ({ PersonalSchedules: ({ assistant }: any) => <div>任务：{assistant.name}</div> }));
vi.mock('@/features/chat/ui/Composer', () => ({ Composer: ({ ckey }: any) => <textarea aria-label="复用输入框" value={S.drafts[ckey] || ''} readOnly /> }));
vi.mock('@/features/chat/ui/MessageList', () => ({ MessageList: ({ msgs }: any) => <div>{msgs.map((m: any) => m.text).join(' ')}</div> }));
let host: HTMLDivElement, root: Root;
const assistants = [{ id: 'a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'ca' }, { id: 'b', name: '工作助理', directory: '/b', workspace: '/b', conversation: 'cb' }];
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  S.cloud = 'signed-in'; S.account = { id: 'account', name: 'test', email: '' }; S.conn = 'ready';
  S.convs = assistants.map(a => ({ id: a.conversation, owner: 'pc', title: a.name, updated: 1, messages: [{ id: a.id, type: 'assistant' as const, text: a.name + '的消息', at: 1 }], loaded: true, remote: true }));
  S.drafts['personal:a'] = '小麓草稿'; S.drafts['personal:b'] = '工作草稿';
  vi.mocked(loadAssistants).mockReturnValue({ items: assistants, selected: 'a' });
  vi.mocked(ensureConversation).mockImplementation(async a => a.conversation!);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('PA02 switches assistants without mixing conversations or input drafts', async () => {
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  expect(host.textContent).toContain('小麓的消息');
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('小麓草稿');
  const b = [...host.querySelectorAll('button')].find(x => x.textContent === '工作助理')!;
  await act(async () => b.click());
  expect(host.textContent).not.toContain('小麓的消息'); expect(host.textContent).toContain('工作助理的消息');
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('工作草稿');
  expect(S.drafts['personal:a']).toBe('小麓草稿');
});
it('PA02 plus opens the existing assistant-name dialog and unavailable channels never claim connected', async () => {
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent?.includes('新建助理'))!.click());
  expect(S.modals.at(-1)?.id).toBe('prompt'); expect(S.modals.at(-1)?.props.title).toBe('新建个人助理');
  expect(host.textContent).not.toContain('已连接');
  expect([...host.querySelectorAll('button')].find(x => x.textContent === '通话')?.disabled).toBe(true);
});
it('PA02 clears the old account UI when the account changes', async () => {
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  vi.mocked(loadAssistants).mockReturnValue({ items: [] });
  await act(async () => update(s => { s.account = { id: 'new-account', name: '', email: '' }; }));
  expect(host.textContent).not.toContain('小麓的消息'); expect(host.querySelector('textarea')).toBeNull();
});
it('PA02 embedded assistant never navigates the main chat or closes the native application', async () => {
  S.activeConv = 'main-chat'; S.route = { name: 'chat' }; S.folder = '/main';
  const close = vi.fn();
  await act(async () => root.render(<PersonalAgent onClose={close} onMinimize={() => {}} />));
  expect(S.activeConv).toBe('main-chat'); expect(S.folder).toBe('/main');
  expect(host.querySelector('[aria-label="置顶"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭个人助理"]')!.click());
  expect(close).toHaveBeenCalledOnce(); expect(S.drafts['personal:a']).toBe('小麓草稿');
});
it('PA02 refuses cached conversation actions after a failed ownership check', async () => {
  vi.mocked(ensureConversation).mockRejectedValue(new Error('助理会话归属不一致'));
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  expect(host.querySelector('textarea')).toBeNull(); expect(host.textContent).not.toContain('小麓的消息'); expect(host.textContent).not.toContain('任务：小麓');
  expect(S.drafts['personal:a']).toBe('小麓草稿');
});

it('PA02 rejects a stale assistant-creation confirmation after reauthentication', async () => {
  const { beginAuthChange } = await import('@/features/account/runtime/authScope');
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent?.includes('新建助理'))!.click());
  const confirm = S.modals.at(-1)!.props.onOk as (name: string) => void;
  beginAuthChange(); await act(async () => confirm('过期操作'));
  expect(addAssistant).not.toHaveBeenCalled();
});
it('PA-AVATAR new assistant creation forwards the visually selected mascot', async () => {
  vi.mocked(addAssistant).mockResolvedValueOnce({ id: 'new', name: '阅读助理', directory: '/new', workspace: '/new', avatar: '02' });
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent?.includes('新建助理'))!.click());
  const p = S.modals.at(-1)!.props;
  const pickerHost = document.createElement('div'), picker = createRoot(pickerHost);
  try {
    await act(async () => picker.render(p.extra as any));
    await act(async () => pickerHost.querySelector<HTMLInputElement>('input[value="02"]')!.click());
    await act(async () => (p.onOk as (name: string) => void)('阅读助理'));
    expect(addAssistant).toHaveBeenCalledWith('阅读助理', '02');
  } finally { await act(async () => picker.unmount()); }
});

it('PA-AVATAR-01 opens the avatar changer from the assistant header for the selected assistant', async () => {
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="更换小麓的头像"]')!.click());
  const modal = S.modals.at(-1)!;
  expect(modal.id).toBe('personalAvatar'); expect(modal.props.assistantId).toBe('a'); expect(modal.props.account).toBe('account');
});

it('PA-TAB-01 AC-1 标签上的 × 确认后删除助理，选中相邻标签并清掉它的草稿；没有恢复助理', async () => {
  const three = [...assistants, { id: 'c', name: '阅读助理', directory: '/c', workspace: '/c', conversation: 'cc' }];
  vi.mocked(loadAssistants).mockReturnValue({ items: three, selected: 'b' });
  S.convs.push({ id: 'cc', owner: 'pc', title: '阅读助理', updated: 1, messages: [{ id: 'c', type: 'assistant' as const, text: '阅读助理的消息', at: 1 }], loaded: true, remote: true });
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '恢复助理')).toBe(false);
  expect(host.querySelector('[aria-label^="关闭助理标签"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="删除助理：工作助理"]')!.click());
  const modal = S.modals.at(-1)!;
  expect(modal.props.title).toBe('删除助理「工作助理」？');
  for (const part of ['定时任务', '飞书', '归档的任务', '可以找回', '文档保留']) expect(String(modal.props.desc)).toContain(part);
  expect(deleteAssistant).not.toHaveBeenCalled();
  vi.mocked(loadAssistants).mockReturnValue({ items: [three[0], three[2]], selected: 'a' });
  await act(async () => { (modal.props.onOk as () => void)(); });
  expect(deleteAssistant).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  await vi.waitFor(() => expect(host.textContent).toContain('阅读助理的消息'));
  expect(host.querySelector('.pa-assistants .is-active')?.textContent).toBe('阅读助理');
  expect(S.drafts['personal:b']).toBeUndefined(); expect(S.drafts['personal:a']).toBe('小麓草稿');
});
it('PA-TAB-01 AC-2 正在执行任务的助理，标签上的 × 不可用并说明原因', async () => {
  S.running = { cb: true };
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  const x = host.querySelector<HTMLButtonElement>('[aria-label="删除助理：工作助理"]')!;
  expect(x.disabled).toBe(true); expect(x.title).toContain('正在执行任务');
  expect(host.querySelector<HTMLButtonElement>('[aria-label="删除助理：小麓"]')!.disabled).toBe(false);
  S.running = {};
});
it('PA-TAB-01 AC-3 会话还在打开时再次选中当前助理（点标签或外部入口），会话照常打开', async () => {
  let open!: (id: string) => void;
  vi.mocked(ensureConversation).mockImplementationOnce(() => new Promise<string>(r => { open = r; }));
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  expect(host.textContent).toContain('正在读取助理会话');
  await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent === '小麓')!.click());
  await act(async () => update(st => { st.personalPanel = { account: 'account', minimized: false, focus: { id: 'a', at: 1 } }; }));
  await act(async () => open('ca'));
  expect(host.textContent).not.toContain('正在读取助理会话');
  expect(host.textContent).toContain('小麓的消息');
  expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('小麓草稿');
});

it('PA-DELETE the selected assistant can be deleted after confirming, but not while it is running', async () => {
  S.running = { ca: true };
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  const button = () => [...host.querySelectorAll('button')].find(x => x.textContent?.includes('删除这位助理'))!;
  expect(button().disabled).toBe(true);
  await act(async () => { S.running = {}; update(); });
  expect(button().disabled).toBe(false);
  await act(async () => button().click());
  const modal = S.modals.at(-1)!;
  expect(modal.props.title).toBe('删除助理「小麓」？');
  expect(String(modal.props.desc)).toContain('可以找回');
  expect(deleteAssistant).not.toHaveBeenCalled();
  vi.mocked(loadAssistants).mockReturnValue({ items: [assistants[1]], selected: 'b' });
  await act(async () => { (modal.props.onOk as () => void)(); });
  expect(deleteAssistant).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  await vi.waitFor(() => expect(host.textContent).not.toContain('小麓的消息'));
});
it('UI-AUDIT-03 AC-1 没有助理时只显示空状态：没有重复头部、假输入框和渠道行', async () => {
  vi.mocked(loadAssistants).mockReturnValue({ items: [] });
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  expect(host.textContent).not.toContain('Personal Agent');
  expect(host.querySelector('.pa-chathead')).toBeNull(); expect(host.querySelector('.pa-composer')).toBeNull();
  expect(host.textContent).not.toContain('创建助理后可连接');
  expect(host.querySelector('.pa-inspector')?.textContent).toContain('新建助理后，可以在这里连接飞书');
});
it('UI-AUDIT-03 AC-5 / AC-9 头部只显示助理名，文件夹按钮显示文件夹名并提示完整路径；删除用危险按钮样式', async () => {
  vi.mocked(loadAssistants).mockReturnValue({ items: [{ ...assistants[0], workspace: '/Users/me/Documents/报告' }, assistants[1]], selected: 'a' });
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  expect(host.querySelector('.pa-chathead strong')?.textContent).toBe('小麓');
  const folder = host.querySelector<HTMLButtonElement>('.pa-workspace')!;
  expect(folder.textContent).toBe('报告'); expect(folder.title).toBe('工作文件夹：/Users/me/Documents/报告'); expect(folder.disabled).toBe(false);
  expect([...host.querySelectorAll('button')].find(x => x.textContent === '删除这位助理')?.classList.contains('btn--danger-ghost')).toBe(true);
  await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent === '工作助理')!.click());
  expect(host.querySelector('.pa-workspace')?.textContent).toBe('助理目录');
});
it('UI-AUDIT-03 AC-5 点击头部文件夹按钮，选中的目录关联到当前助理；取消选择不关联', async () => {
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  vi.mocked(pickFolder).mockResolvedValueOnce(null);
  await act(async () => host.querySelector<HTMLButtonElement>('.pa-workspace')!.click());
  await vi.waitFor(() => expect(pickFolder).toHaveBeenCalledOnce());
  expect(linkWorkspace).not.toHaveBeenCalled();
  vi.mocked(pickFolder).mockResolvedValueOnce('/Users/me/Projects/季度报告');
  await act(async () => host.querySelector<HTMLButtonElement>('.pa-workspace')!.click());
  await vi.waitFor(() => expect(linkWorkspace).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'a' }), '/Users/me/Projects/季度报告'));
});
