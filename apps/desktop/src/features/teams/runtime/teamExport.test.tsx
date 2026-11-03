import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error Node provides WebCrypto in the test runner; app types are browser-only.
import { webcrypto } from 'node:crypto';
const m = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true), openTask: vi.fn(), refresh: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: m.isTauri }));
vi.mock('@/features/chat/runtime/tasks', () => ({ openTask: m.openTask }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ refreshPhoneChat: m.refresh }));
import { exportTeamMarkdown } from './teamExport';
import { exportTeam, renameTeam } from '../actions/teams';
import { PromptModal } from '@/app/overlays/BasicModals';
import { initialState } from '@/state/state';
import { S, update } from '@/state/store';
import type { Conv, Team } from '@/state/types';

/* TEAM-MENU-01：团队导出按成员顺序每人一节，回复方用成员名，共用会话只导出一次，读取失败的成员如实列出；团队改名在弹窗内校验。 */

const decode = (data: string) => new TextDecoder().decode(Uint8Array.from(atob(data), ch => ch.charCodeAt(0)));
let host: HTMLDivElement, root: Root, silence: ReturnType<typeof vi.spyOn>[];

/** 真实团队：Lom Leader、本机 Agent（记录读取失败）、真实手机、与 Leader 共用会话的第二位 Lom。 */
function realTeam(): Team {
  const t = S.teams[0];
  t.real = true; t.name = '内容工厂';
  t.members = [
    { mid: 'm1', agent: 'pc', role: '总编', leader: true },
    { mid: 'm2', agent: 'ag:codex', role: '编程' },
    { mid: 'm3', agent: 'p1', role: '美妆运营' },
    { mid: 'm4', agent: 'pc', role: '视觉设计' },
  ];
  t.leaderConv = 'lead'; t.memberConvs = { m2: 'codex', m3: 'phone' };
  S.convs = [
    { id: 'lead', owner: 'pc', title: '内容工厂', updated: 1, remote: true, teamId: t.id, messages: [] },
    { id: 'codex', owner: 'pc', title: 'Codex', updated: 1, remote: true, teamId: t.id, agentId: 'codex', messages: [] },
    { id: 'phone', owner: 'p1', title: '口红测评', updated: 1, teamId: t.id, phoneSession: 's1', messages: [] },
  ];
  m.openTask.mockImplementation(async (id: string) => {
    if (id === 'codex') throw new Error('核心服务没有响应');
    S.convs.find(c => c.id === id)!.messages = [
      { id: 'u', type: 'user', at: 1, text: '本周做秋冬主题' },
      { id: 't', type: 'teammate', at: 2, agent: 'Codex CLI', text: '封面做好了' },
      { id: 'a', type: 'assistant', at: 3, text: '已分工' },
    ];
  });
  m.refresh.mockImplementation(async (c: Conv) => { c.messages = [{ id: 'p', type: 'assistant', at: 1, text: '草稿已保存' }]; return true; });
  return t;
}

const EXPECTED = [
  '# 内容工厂', '',
  '## Lom · 总编', '', '**我**：本周做秋冬主题', '', '**Codex CLI**：封面做好了', '', '**Lom**：已分工', '',
  '## 本机 Agent · 编程', '', '（这位成员的记录读取失败，没有导出）', '',
  '## 手机一号 · 美妆运营', '', '**手机一号**：草稿已保存', '',
  '## Lom · 视觉设计', '', '（与「Lom · 总编」共用同一会话，记录见上文）', '',
].join('\n');

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); m.isTauri.mockReturnValue(true);
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  silence = [vi.spyOn(console, 'error').mockImplementation(() => undefined), vi.spyOn(console, 'warn').mockImplementation(() => undefined)];
  Object.assign(S, initialState(true));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); silence.forEach(s => s.mockRestore()); });

it('TEAM-MENU-01 AC-3 team export has one section per member in order, labels speakers by member and reports failing members', async () => {
  const t = realTeam();
  const result = await exportTeamMarkdown(t);
  expect(result.markdown).toBe(EXPECTED);
  expect(result.failed).toEqual(['本机 Agent · 编程']);
  expect(m.openTask.mock.calls.filter(([id]) => id === 'lead')).toEqual([['lead', { throwOnError: true, refreshWorkspace: false }]]);
  expect(m.refresh).toHaveBeenCalledWith(S.convs.find(c => c.id === 'phone'), true);
});

it('TEAM-MENU-01 AC-3 a demo team exports its sample panes without loading anything', async () => {
  const result = await exportTeamMarkdown(S.teams[0]);
  expect(result.failed).toEqual([]);
  expect(result.markdown.startsWith('# 小红书内容工厂\n\n## Lom · 总编\n\n**我**：这周做一个「秋冬换季」主题')).toBe(true);
  expect(result.markdown.match(/^## /gm)).toHaveLength(S.teams[0].members.length);
  expect(m.openTask).not.toHaveBeenCalled(); expect(m.refresh).not.toHaveBeenCalled();
});

it('TEAM-MENU-01 AC-5 team export toasts only after saving, names failing members, and stays silent on cancel', async () => {
  const t = realTeam();
  m.invoke.mockResolvedValueOnce(true);
  await exportTeam(t.id);
  const [command, args] = m.invoke.mock.calls[0];
  expect(command).toBe('local_file_save'); expect(args.name).toBe('内容工厂.md');
  expect(decode(args.data)).toBe(EXPECTED);
  expect(S.toast).toMatchObject({ text: '已导出「内容工厂.md」，但这些成员的记录读取失败、没有包含：本机 Agent · 编程', tone: 'info' });

  update(s => { s.toast = null; }); m.invoke.mockResolvedValueOnce(false);
  await exportTeam(t.id);
  expect(S.toast).toBeNull();

  m.invoke.mockRejectedValueOnce('file.save_failed');
  await exportTeam(t.id);
  expect(S.toast).toMatchObject({ tone: 'error' });
  expect(S.toast?.text).toContain('导出团队记录失败，没有生成文件');
});

it('TEAM-MENU-01 AC-5 a fully loaded team export reports plain success', async () => {
  const t = realTeam();
  t.members = t.members.filter(x => x.mid !== 'm2');
  m.invoke.mockResolvedValueOnce(true);
  await exportTeam(t.id);
  expect(S.toast).toMatchObject({ text: '已导出「内容工厂.md」', tone: 'ok' });
});

it('TEAM-MENU-01 AC-4 renaming a team trims the name and rejects an empty one inside the dialog', async () => {
  const t = S.teams[0];
  const click = async (label: string) => { await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label)!.click()); };
  renameTeam(t.id);
  act(() => update(s => { s.form.value = '   '; }));
  await act(async () => root.render(<PromptModal p={S.modals.at(-1)!.props} />));
  await click('保存');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('请输入团队名称');
  expect(S.modals.at(-1)?.id).toBe('prompt');
  expect(t.name).toBe('小红书内容工厂');
  act(() => update(s => { s.form.value = '  秋冬内容组  '; }));
  await click('保存');
  expect(t.name).toBe('秋冬内容组');
  expect(S.modals).toHaveLength(0);
});
