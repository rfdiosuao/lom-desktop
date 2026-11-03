vi.mock('../runtime/heartbeats', () => ({ ensureHeartbeats: vi.fn(async () => {}) }));
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { PersonalSchedules } from './PersonalSchedules';
import { toggleCoreSchedule } from '@/features/schedules/runtime/schedules';
vi.mock('@/features/schedules/runtime/schedules', () => ({ toggleCoreSchedule: vi.fn(), saveCoreSchedule: vi.fn() }));
it('PA02 / UI-AUDIT-02 UI-05 shows only this assistant schedules and explains delivery once instead of fake push controls', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  const own = { id: 'own', name: '我的任务', conversationId: 'ca', enabled: true, remote: true } as any;
  S.schedules = [own, { ...own, id: 'other', name: '别人的任务', conversationId: 'cb' }];
  try {
    await act(async () => root.render(<PersonalSchedules assistant={{ id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'ca' }} />));
    expect(host.textContent).toContain('我的任务'); expect(host.textContent).not.toContain('别人的任务');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="我的任务自动执行"]')!.click());
    expect(toggleCoreSchedule).toHaveBeenCalledWith(own, { personalId: 'pa_a' });
    expect(host.querySelector('[aria-label*="推送"]')).toBeNull();
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(host.querySelector('[data-testid="pa-delivery-note"]')?.textContent).toContain('定时任务结果推送暂不支持');
  } finally { await act(async () => root.unmount()); }
});
