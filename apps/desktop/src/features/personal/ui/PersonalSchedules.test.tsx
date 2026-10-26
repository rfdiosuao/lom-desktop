vi.mock('../runtime/heartbeats', () => ({ ensureHeartbeats: vi.fn(async () => {}) }));
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { PersonalSchedules } from './PersonalSchedules';
import { toggleCoreSchedule } from '@/features/schedules/runtime/schedules';
vi.mock('@/features/schedules/runtime/schedules', () => ({ toggleCoreSchedule: vi.fn(), saveCoreSchedule: vi.fn() }));
it('PA02 shows only this assistant schedules and never enables unconnected IM delivery', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  const own = { id: 'own', name: '我的任务', conversationId: 'ca', enabled: true, remote: true } as any;
  S.schedules = [own, { ...own, id: 'other', name: '别人的任务', conversationId: 'cb' }];
  try {
    await act(async () => root.render(<PersonalSchedules assistant={{ id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'ca' }} />));
    expect(host.textContent).toContain('我的任务'); expect(host.textContent).not.toContain('别人的任务');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="我的任务自动执行"]')!.click());
    expect(toggleCoreSchedule).toHaveBeenCalledWith(own, { personalId: 'pa_a' });
    expect(host.querySelector<HTMLButtonElement>('[aria-label*="推送结果"]')!.disabled).toBe(true);
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every(x => x.disabled)).toBe(true);
  } finally { await act(async () => root.unmount()); }
});
