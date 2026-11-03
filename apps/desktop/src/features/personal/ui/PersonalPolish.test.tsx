vi.mock('../runtime/heartbeats', () => ({ ensureHeartbeats: vi.fn(async () => {}) }));
vi.mock('@/features/schedules/runtime/schedules', () => ({ toggleCoreSchedule: vi.fn(), saveCoreSchedule: vi.fn() }));
vi.mock('../runtime/memory', async load => ({ ...await load<typeof import('../runtime/memory')>(), readDocument: vi.fn(async () => 'original'), listDiary: vi.fn(async () => []), saveDocument: vi.fn() }));
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Schedule } from '@/state/types';
import { listDiary } from '../runtime/memory';
import { PersonalDocuments } from './PersonalDocuments';
import { PersonalSchedules } from './PersonalSchedules';

let host: HTMLDivElement, root: Root;
const assistant = { id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'ca' };
// 用本机时区：与本机不同的时区会在频率后附加时区名（UI-AUDIT-02 UI-06），这里只验证行内组合，不依赖运行环境时区
const task = (o: Partial<Schedule>): Schedule => ({ id: 't', name: '每日复盘与学习', exec: 'pc', prompt: '', freq: 'daily', cron: '0 22 * * *', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, time: '22:00', days: [], every: 60, runIn: 'same', enabled: true, last: null, runs: [], remote: true, conversationId: 'ca', ...o });
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('UI-AUDIT-03 AC-6 定时任务一行显示频率与下次执行，cron 原文只在提示里；暂停的任务标明已暂停', async () => {
  S.schedules = [task({ nextRun: new Date(2026, 9, 30, 22, 0).getTime() }), task({ id: 'p', name: '月度进化评估', enabled: false })];
  await act(async () => root.render(<PersonalSchedules assistant={assistant} />));
  const [daily, paused] = [...host.querySelectorAll('.pa-task')];
  expect(daily.textContent).toContain('每天 22:00 · 下次 10月30日 22:00');
  expect(daily.textContent).not.toContain('cron');
  expect(daily.querySelector('small')?.getAttribute('title')).toContain('cron 0 22 * * *');
  expect(paused.textContent).toContain('已暂停');
  expect(host.querySelector('[aria-label="每日复盘与学习自动执行"]')).toBeTruthy();
  // 说明在列表之后，仍说明推送暂不支持
  expect(host.querySelector('.pa-task ~ [data-testid="pa-delivery-note"]')?.textContent).toContain('定时任务结果推送暂不支持');
});

it('UI-AUDIT-03 AC-7 文档未修改时「保存」不可点，修改后可点', async () => {
  await act(async () => root.render(<PersonalDocuments assistant={assistant} />));
  await act(async () => host.querySelector<HTMLButtonElement>('.pa-document')!.click());
  await act(async () => button('编辑').click());
  expect(button('保存').disabled).toBe(true);
  const area = host.querySelector('textarea')!, set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { set.call(area, 'changed'); area.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(button('保存').disabled).toBe(false);
});

it('UI-AUDIT-03 AC-8 日记行只显示日期和星期，不重复文件路径和相同副标题', async () => {
  vi.mocked(listDiary).mockResolvedValue(['memory/2026-10-29.md', 'memory/2026-10-28.md']);
  await act(async () => root.render(<PersonalDocuments assistant={assistant} />));
  const rows = [...host.querySelectorAll('.pa-document')].slice(-2).map(x => x.textContent);
  expect(rows).toEqual(['2026-10-29周四', '2026-10-28周三']);
  expect(host.textContent).not.toContain('memory/');
  expect(host.textContent).not.toContain('查看当日记录');
});
