import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { freqText, scheduleDetail } from '@/state/selectors';
import { describeCron } from '@/shared/lib/cronText';
import { PromptModal } from '@/app/overlays/BasicModals';
import { prompt } from '@/shared/overlays/controller';
import { PersonalDocuments } from './PersonalDocuments';
import { assistantNameError } from '../runtime/catalog';
import { listDiary } from '../runtime/memory';
import type { Schedule } from '@/state/types';

vi.mock('../runtime/memory', async load => ({ ...await load<typeof import('../runtime/memory')>(), readDocument: vi.fn(async () => 'original'), listDiary: vi.fn(async () => []), saveDocument: vi.fn() }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn() }));

let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); S.modals = []; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

const click = (label: string) => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === label)!.click());
const assistant = { id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'ca' };
const heartbeat = (o: Partial<Schedule> = {}): Schedule => ({ id: 'hb', name: '月度进化评估', exec: 'pc', prompt: '', freq: 'custom', cron: '0 9 1 * *', timezone: 'Asia/Shanghai', time: '', days: [], every: 60, runIn: 'same', enabled: true, last: null, runs: [], remote: true, conversationId: 'ca', ...o });

it('UI-AUDIT-02 UI-06 常见 cron 显示为自然语言，原始 cron 与下次执行放在详情，解释不了标注需核对', () => {
  expect(describeCron('0 9 1 * *')).toBe('每月 1 日 09:00');
  expect(describeCron('0 22 * * *')).toBe('每天 22:00');
  expect(describeCron('0 3 * * SUN')).toBe('每周日 03:00');
  expect(describeCron('30 8 1,15 * *')).toBe('每月 1、15 日 08:30');
  expect(describeCron('*/15 * * * *')).toBe('每 15 分钟');
  expect(describeCron('0 9 * * 1')).toBeNull(); // 纯数字星期在核心里按 Quartz 计，有歧义
  expect(describeCron('0 9 L * *')).toBeNull();
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: 'UTC' } as Intl.ResolvedDateTimeFormatOptions);
  expect(freqText(heartbeat())).toBe('每月 1 日 09:00（北京时间）');
  expect(freqText(heartbeat({ cron: '0 9 L * *' }))).toBe('0 9 L * * · Asia/Shanghai（需核对）');
  const next = new Date(2026, 10, 1, 9, 0).getTime();
  expect(scheduleDetail(heartbeat({ nextRun: next }))).toBe('cron 0 9 1 * * · Asia/Shanghai · 下次 11月1日 09:00');
});

it('UI-AUDIT-02 UI-11 助理名称在弹窗内校验，不关闭弹窗也不丢头像等草稿', async () => {
  expect(assistantNameError('  ')).toBe('助理名称须为1至40个字符');
  expect(assistantNameError('小麓')).toBeUndefined();
  const onOk = vi.fn();
  prompt({ title: '新建个人助理', label: '助理名称', okText: '创建助理', validate: assistantNameError, onOk });
  await act(async () => root.render(<PromptModal p={S.modals.at(-1)!.props} />));
  await click('创建助理');
  expect(onOk).not.toHaveBeenCalled();
  expect(S.modals.at(-1)?.id).toBe('prompt');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('助理名称须为1至40个字符');
  expect(document.activeElement).toBe(host.querySelector('input'));
  act(() => update(s => { s.form.value = '工作助理'; }));
  await click('创建助理');
  expect(onOk).toHaveBeenCalledWith('工作助理');
  expect(S.modals).toHaveLength(0);
});

it('UI-AUDIT-02 UI-12 文档编辑可以取消；有草稿时明确选择放弃或继续编辑', async () => {
  await act(async () => root.render(<PersonalDocuments assistant={assistant} />));
  await act(async () => host.querySelector<HTMLButtonElement>('.pa-document')!.click());
  await click('编辑');
  await click('取消');
  expect(host.querySelector('textarea')).toBeNull();
  await click('编辑');
  const area = host.querySelector<HTMLTextAreaElement>('textarea')!;
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => { set.call(area, '草稿'); area.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('取消');
  const ask = S.modals.at(-1)!;
  expect(ask.props).toMatchObject({ okText: '放弃修改', cancelText: '继续编辑' });
  expect(host.querySelector('textarea')?.value).toBe('草稿'); // 选择前不丢草稿
  await act(async () => { S.modals.pop(); (ask.props.onOk as () => void)(); });
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.querySelector('.pa-editor')?.textContent).toContain('original');
});

it('UI-AUDIT-02 UI-13 同一助理面板在任务结束后和手动刷新时重新读取日记', async () => {
  vi.mocked(listDiary).mockResolvedValue(['memory/2026-10-28.md']);
  await act(async () => root.render(<PersonalDocuments assistant={assistant} />));
  expect(host.textContent).toContain('2026-10-28');
  vi.mocked(listDiary).mockResolvedValue(['memory/2026-10-29.md', 'memory/2026-10-28.md']);
  await act(async () => update(s => { s.running.ca = true; }));
  await act(async () => update(s => { delete s.running.ca; }));
  expect(host.textContent).toContain('2026-10-29');
  vi.mocked(listDiary).mockRejectedValueOnce(new Error('读取失败'));
  await click('刷新');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('读取日记失败');
  await click('重试');
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain('2026-10-29');
});

