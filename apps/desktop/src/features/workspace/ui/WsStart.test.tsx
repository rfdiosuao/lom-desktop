import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { S, update } from '@/state/store';
import { Workspace } from './Workspace';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
  S.route = { name: 'home' };
  S.wsTab = 'preview';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Workspace />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const card = (title: string) => [...host.querySelectorAll<HTMLButtonElement>('.ws-start__card')].find(b => b.textContent?.includes(title));

it('WIN-TITLEBAR-01 an empty preview offers cards for the views that exist', () => {
  const titles = [...host.querySelectorAll('.ws-start__card b')].map(n => n.textContent);
  expect(titles).toEqual(['打开工作区文件', '查看计划', '查看变更', '打开手机']);
});

it('WIN-TITLEBAR-01 a start card opens its workspace view', async () => {
  await act(async () => card('打开工作区文件')?.click());
  expect(S.wsTab).toBe('files');
  expect(host.querySelector('.ws-start')).toBeNull();
});

it('WIN-TITLEBAR-01 the collapse button stays in the workspace header', () => {
  expect(host.querySelector('.workspace__head [aria-label="收起工作区"]')).not.toBeNull();
});

it('WS-ENTRY-01 #410 the entry cards are plain buttons inside a labelled group', () => {
  const group = host.querySelector('.ws-start')!;
  expect(group.getAttribute('role')).toBe('group');
  expect(group.getAttribute('aria-label')).toBeTruthy();
  expect(host.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  expect(host.querySelectorAll('.ws-start__card')).toHaveLength(4);
  expect([...host.querySelectorAll('.ws-start__card')].every(b => b.tagName === 'BUTTON' && !b.hasAttribute('role'))).toBe(true);
});

it('WS-ENTRY-01 #410 without a task the plan and change cards say there is no task', () => {
  const desc = (title: string) => card(title)?.querySelector('small')?.textContent;
  expect(desc('查看计划')).toBe('当前没有任务');
  expect(desc('查看变更')).toBe('当前没有任务');
  expect(desc('打开工作区文件')).not.toContain('任务');
});

it('WS-ENTRY-01 #410 with an open task the cards describe the task', async () => {
  await act(async () => { update(s => { s.convs = [{ id: 'c1', title: 't', messages: [] } as never]; s.activeConv = 'c1'; s.route = { name: 'chat' } as never; }); });
  const desc = (title: string) => card(title)?.querySelector('small')?.textContent;
  expect(desc('查看计划')).toBe('任务的执行步骤');
  expect(desc('查看变更')).toBe('本轮文件改了什么');
});

it('WS-ENTRY-01 #410 the view switch is a single tablist with no duplicate select', () => {
  expect(host.querySelectorAll('[role="tablist"]')).toHaveLength(1);
  expect(host.querySelector('select')).toBeNull();
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(5);
});
