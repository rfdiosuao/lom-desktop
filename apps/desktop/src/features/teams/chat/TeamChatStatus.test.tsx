import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Conv, Msg, Team } from '@/state/types';

const m = vi.hoisted(() => ({ approveTask: vi.fn() }));
vi.mock('@/core/client', async original => ({ ...await original<object>(), api: vi.fn(async () => ({ items: [], has_more: false })) }));
vi.mock('@/features/chat/ui/Chat', () => ({ useStickBottom: () => ({ ref: undefined, onScroll: vi.fn() }) }));
vi.mock('@/features/chat/ui/Composer', () => ({ Composer: () => <div data-testid="composer" /> }));
vi.mock('@/features/chat/runtime/tasks', async original => ({ ...await original<object>(), approveTask: m.approveTask, openTask: vi.fn() }));
const { TeamChatView } = await import('./TeamChatView');
const { S } = await import('@/state/store');
const { initialState } = await import('@/state/state');

let root: Root, host: HTMLDivElement, team: Team;
const conv = (id: string, messages: Msg[], extra: Partial<Conv> = {}): Conv => ({ id, owner: 'pc', title: id, updated: 1, remote: true, loaded: true, messages, ...extra });
const ask: Msg = { id: 'ap', type: 'approval', at: 3, status: 'pending', command: 'npm install', callId: 'c1', confirmId: 'k1',
  confirmationOptions: [{ label: '允许一次', value: 'proceed_once', action: 'once' }, { label: '拒绝', value: 'cancel', action: 'deny' }] };

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState(false));
  S.cloud = 'signed-in'; S.account = { id: 'acc', name: 'A', email: '' }; S.conn = 'ready';
  S.agentCatalog = [{ id: 'ag_codex', name: 'Codex CLI', backend: 'codex', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' }];
  team = { id: 't1', name: '队', folder: '/w', created: 1, real: true, panes: {}, ownerAccountId: 'acc', leaderConv: 'lead', memberConvs: { r: 'mem' },
    members: [{ mid: 'l', agent: 'pc', role: '队长', leader: true }, { mid: 'r', agent: 'ag:ag_codex', role: '研究员' }] };
  S.teams = [team];
  S.convs = [
    conv('lead', [{ id: 'lu', type: 'user', at: 1, text: '开始' }, { id: 'la', type: 'assistant', at: 2, text: '正在分工', streaming: true }]),
    conv('mem', [{ id: 'mu', type: 'user', at: 1, text: '装依赖' },
      { id: 'tl', type: 'tool', at: 2, tool: '执行命令', detail: 'ls', status: 'done', timing: { startedAt: 2000, endedAt: 8000 } }, ask], { agentId: 'ag_codex', agentName: 'Codex CLI' }),
  ];
  S.running = { lead: true, mem: true };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });
const statusOf = (name: string) => [...host.querySelectorAll('.team-chat__person')].find(b => b.textContent?.includes(name))!.querySelector('[data-status]')!;

it('TEAM-CHAT-01C AC-C1 AC-C2 tool records show real duration; the confirmation names the member and answers in that member session', async () => {
  await act(async () => root.render(<TeamChatView team={team} />));
  expect(statusOf('Codex CLI').getAttribute('data-status')).toBe('waiting');
  expect(statusOf('Lom').getAttribute('data-status')).toBe('typing');
  const reply = host.querySelector('.team-chat__reply[data-member="m:r"]')!;
  expect(reply.querySelector('.team-chat__asking')!.textContent).toBe('Codex CLI 请求你确认：npm install');
  expect(reply.textContent).toContain('6 秒');
  expect(host.querySelector('.member-wait')!.textContent).toContain('Codex CLI · 等待授权');
  const allow = [...reply.querySelectorAll('button')].find(b => b.textContent === '允许一次')!;
  await act(async () => allow.click());
  expect(m.approveTask).toHaveBeenCalledWith(S.convs[1], ask, '1');
});

it('TEAM-CHAT-01C AC-C4 on disconnect the running indicators stop and the members read as pending verification', async () => {
  S.conn = 'offline';
  S.convs[1].messages.pop();
  await act(async () => root.render(<TeamChatView team={team} />));
  expect(statusOf('Lom').getAttribute('data-status')).toBe('disconnected');
  expect(statusOf('Codex CLI').getAttribute('data-status')).toBe('disconnected');
  expect(host.querySelector('.reply-pending')).toBeNull();
  expect(host.textContent).toContain('连接中断：Lom、Codex CLI 的状态待核对');
});
