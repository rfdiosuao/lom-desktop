vi.mock('@/features/skills/runtime/conversationSkills', () => ({ conversationSkills: vi.fn(async () => ({ enabled_skills: ['fixture-personal'] })) }));
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: mock.api, getEndpoint: () => null }));
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';
import { Composer } from '@/features/chat/ui/Composer';
import { SideChat } from '@/features/chat/ui/SideChat';
import { MenuHost } from '@/app/overlays/MenuHost';
import { MENUS } from '@/app/overlays/menu-registry';
import { minimizeSideChat } from '@/features/chat/runtime/sideChat';
import { sideChatCmd } from '@/features/chat/actions/commands';

let host: HTMLDivElement, root: Root;
const entry = (key: string) => {
  const item = MENUS.attach({ ckey: key }).find(i => i !== '-' && !i.header && i.label === '侧边对话');
  if (!item || item === '-' || item.header) throw new Error('missing side chat');
  return item;
};
const openMenu = async () => { await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="添加"]')!.click()); };
const clickSide = async () => { await act(async () => [...host.querySelectorAll<HTMLButtonElement>('.menu__item')].find(x => x.textContent?.startsWith('侧边对话'))!.click()); };
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); Object.assign(S, initialState()); mock.api.mockReset();
  S.convs = [{ id: 'p', title: '当前任务', owner: 'pc', remote: true, loaded: true, modelId: 'own::m', updated: 1, messages: [] }];
  S.route = { name: 'chat' }; S.activeConv = 'p'; S.running = { p: true }; S.drafts = { 'conv:p': '尚未发送的想法' };
  S.providers = [{ id: 'own', name: 'own', platform: 'openai', base_url: '', models: ['m'], enabled: true, created_at: 1 }];
  mock.api.mockImplementation(async (method, path, body) => {
    if (method === 'POST' && path === '/api/conversations') return { id: 'side', type: body.type, model: body.model, extra: body.extra, created_at: 1, modified_at: 1 };
    throw new Error(`Unexpected request ${method} ${path}`);
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<><Composer ckey="conv:p" /><MenuHost /><SideChat /></>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('D28 AC-1: plus menu opens a real side conversation below turtle without clearing the main draft or stopping it', async () => {
  await openMenu();
  const labels = [...host.querySelectorAll('.menu__item-text>span:first-child')].map(x => x.textContent);
  expect(labels.indexOf('侧边对话')).toBe(labels.indexOf('海龟汤提问卡') + 1);
  await clickSide();
  expect(host.querySelector('.side-chat')).not.toBeNull();
  expect(S.sideChat).toMatchObject({ parent: 'p', conv: 'side' });
  expect(S.drafts['conv:p']).toBe('尚未发送的想法'); expect(S.running.p).toBe(true); expect(S.activeConv).toBe('p');
  expect(S.convs.find(c => c.id === 'side')?.sideOf).toBe('p');
  expect(mock.api.mock.calls).toHaveLength(1);
});
it('D28 AC-2: clicking again restores the minimized window with its draft and no second creation', async () => {
  await openMenu(); await clickSide();
  await act(async () => { update(s => { s.drafts['conv:side'] = '侧边草稿'; }); minimizeSideChat(true); });
  expect(host.querySelector('.side-ball')).not.toBeNull();
  await openMenu(); await clickSide();
  expect(host.querySelector('.side-chat')).not.toBeNull(); expect(S.drafts['conv:side']).toBe('侧边草稿');
  expect(mock.api.mock.calls).toHaveLength(1);
});
it('D28 AC-3: no nested, phone, or nonexistent task entry can create a side conversation', () => {
  expect(entry('home').disabled).toBe(true);
  S.convs.push({ ...S.convs[0], id: 'phone', owner: 'phone' }, { ...S.convs[0], id: 'nested', sideOf: 'p' });
  expect(entry('conv:phone').disabled).toBe(true); expect(entry('conv:nested').disabled).toBe(true);
});
it('D28 AC-3: model preflight failures are visible and keep the main draft', async () => {
  S.providers = []; await openMenu(); await clickSide();
  expect(S.toast?.text).toContain('打开侧边对话失败');
  expect(S.drafts['conv:p']).toBe('尚未发送的想法'); expect(mock.api).not.toHaveBeenCalled();
});
it('D28 AC-3: creation errors render in the side window and preserve the main task', async () => {
  mock.api.mockRejectedValueOnce(new Error('offline')); await openMenu(); await clickSide();
  expect(host.querySelector('.side-chat')?.textContent).toContain('offline');
  expect(S.drafts['conv:p']).toBe('尚未发送的想法'); expect(S.running.p).toBe(true);
});
it('D28 AC-4: slash entry still consumes its command instead of preserving it', async () => {
  S.drafts['conv:p'] = '/侧边';
  await act(async () => sideChatCmd('conv:p'));
  expect(S.drafts['conv:p']).toBe('');
});
