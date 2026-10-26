import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { PersonalAgent } from './PersonalAgent';
import '@/shared/styles/personal.css';
import { ensureConversation } from '../runtime/session';
import { addAssistant, loadAssistants } from '../runtime/catalog';
import { deleteAssistant } from '../runtime/deleteAssistant';
vi.mock('../runtime/catalog', () => ({ loadAssistants: vi.fn(), storeAssistant: vi.fn(), addAssistant: vi.fn() }));
vi.mock('../runtime/session', () => ({ ensureConversation: vi.fn(), linkWorkspace: vi.fn() }));
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

it('PA02 closes and restores tabs without deleting conversations or drafts', async () => {
  await act(async () => root.render(<PersonalAgent onClose={() => {}} onMinimize={() => {}} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭助理标签：小麓"]')!.click());
  expect(host.querySelector('[aria-label="关闭助理标签：小麓"]')).toBeNull();
  expect(host.textContent).toContain('工作助理的消息');
  expect(S.drafts['personal:a']).toBe('小麓草稿');
  expect(S.convs.find(c => c.id === 'ca')?.messages).toHaveLength(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭助理标签：工作助理"]')!.click());
  expect(host.querySelector('textarea')).toBeNull();
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '恢复助理')!.click());
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
