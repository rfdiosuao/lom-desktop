import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { convModel, convModelLabel, rightHidden } from '@/state/selectors';
import { toggleRight } from '@/app/shell/layout';
import { MENUS } from '@/app/overlays/menu-registry';
import { Workspace } from '@/features/workspace/ui/Workspace';
import { FullModal } from '@/features/workspace/ui/FullModal';
import { MessageCard, visibleBody } from '@/features/teams/activity/MessageCard';
import type { TeamMailboxMessage } from '@/features/teams/activity/activityTypes';
import type { Conv } from '@/state/types';

vi.mock('@/features/account/runtime/cloud', async original => ({ ...await original<object>(), ensureCloudConfig: vi.fn(async () => undefined) }));

let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const signIn = () => {
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' }; S.cloudAllowed = null; S.cloudExtra = [];
  S.providers = [{ id: 'cloud', name: 'Lom 云端', enabled: true, models: ['shared', 'mini'] } as never];
  // Pro 和 Max 共用同一个物理模型：只看模型 ID 无法判断档位，必须带上会话的 lomTier
  S.cloudModels = { pro: 'shared', max: 'shared', mini: 'mini' };
};
const chatConv = (o: Partial<Conv> = {}): Conv => ({ id: 'c1', title: '已有会话', owner: 'pc', messages: [], updated: 1, remote: true, modelId: 'cloud::shared', lomTier: 'pro', ...o });

it('UI-AUDIT-02 UI-03 输入框按钮、菜单与发送共用带 lomTier 的会话模型', () => {
  signIn();
  const c = chatConv();
  S.convs = [c]; S.route = { name: 'chat' }; S.activeConv = c.id;
  expect(convModel(c)?.name).toBe('Lom Pro');
  expect(convModelLabel(c)).toBe('Lom Pro');
  const menu = MENUS.model({ ckey: `conv:${c.id}`, agent: 'pc' }) as { label?: string; checked?: boolean }[];
  expect(menu.filter(x => x.checked).map(x => x.label)).toEqual(['Lom Pro']);
});

it('UI-AUDIT-02 UI-03 失效模型保留原名并提示重新选择，不显示成「添加模型」或别的模型', () => {
  signIn(); S.cloudAllowed = ['mini'];
  expect(convModelLabel(chatConv())).toBe('Lom Pro · 需重新选择');
  expect(convModelLabel(chatConv({ lomTier: undefined, modelId: 'gone::old-model' }))).toBe('old-model · 需重新选择');
});

it('UI-AUDIT-02 UI-07 技能商店、定时任务页默认不占工作区，手动展开后记住', () => {
  S.layout = { left: 276, right: 380, leftCollapsed: false, rightCollapsed: false };
  S.route = { name: 'skillhub' };
  expect(rightHidden()).toBe(true);
  toggleRight();
  expect(rightHidden()).toBe(false);
  expect(S.layout.rightCollapsed).toBe(false);
  act(() => update(s => { s.route = { name: 'schedule' }; }));
  expect(rightHidden()).toBe(false);
  act(() => update(s => { s.route = { name: 'chat' }; }));
  expect(rightHidden()).toBe(false);
  toggleRight();
  act(() => update(s => { s.route = { name: 'skillhub' }; }));
  expect(rightHidden()).toBe(false);
  expect(S.layout.rightCollapsed).toBe(true);
});

it('UI-AUDIT-02 UI-10 没有作品时禁用全屏，全屏里也显示空态', () => {
  S.convs = [chatConv({ preview: undefined })]; S.route = { name: 'chat' }; S.activeConv = 'c1'; S.wsTab = 'preview'; S.previewHtml = '';
  act(() => root.render(<Workspace />));
  const full = host.querySelector<HTMLButtonElement>('button[aria-label^="全屏查看"]')!;
  expect(full.disabled).toBe(true);
  act(() => root.render(<FullModal />));
  expect(host.textContent).toContain('还没有可预览的作品');
  expect(host.querySelector('iframe')).toBeNull();
  act(() => update(s => { s.convs[0].preview = 'ready'; s.previewHtml = '<p>作品</p>'; }));
  act(() => root.render(<Workspace />));
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="全屏查看"]')!.disabled).toBe(false);
});

const settings = '[LOM_SETTINGS_V1]\n【Lom 用户设置】对外发布（笔记、评论、私信、邮件）前，先展示目标和完整内容，停止执行并等待用户本次确认。\n[/LOM_SETTINGS_V1]\n\n';
const userMessage = (o: Partial<TeamMailboxMessage> = {}): TeamMailboxMessage => ({
  id: 'm1', team_id: 't1', from_agent_id: 'user', to_agent_id: 'lead', msg_type: 'message', content: `${settings}帮我审查这次发布的改动`,
  summary: `${settings}帮我审查`.slice(0, 40), files: [], read: true, created_at: 1, ...o,
});

it('UI-AUDIT-02 UI-15 看板用户消息剥离已识别的内部设置包装，原始载荷另有入口', () => {
  expect(visibleBody(userMessage())).toEqual({ body: '帮我审查这次发布的改动', raw: `${settings}帮我审查这次发布的改动` });
  // 只剥离固定格式；正文里出现标记字样、或成员发出的消息都不动
  const plain = `用户写的 [LOM_SETTINGS_V1] 字样`;
  expect(visibleBody(userMessage({ content: plain, summary: null }))).toEqual({ body: plain });
  expect(visibleBody(userMessage({ from_agent_id: 'w1' })).raw).toBeUndefined();
  act(() => root.render(<MessageCard message={userMessage()} identity={{ nameOf: x => x, colorOf: () => 'var(--brand)' }} />));
  const body = host.querySelector('.act-card__body')!;
  expect(body.textContent).toBe('帮我审查这次发布的改动');
  expect(host.querySelector('[data-testid="activity-message-raw"]')).toBeNull();
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '原始内容')!.click());
  expect(host.querySelector('[data-testid="activity-message-raw"]')?.textContent).toContain('[LOM_SETTINGS_V1]');
});
