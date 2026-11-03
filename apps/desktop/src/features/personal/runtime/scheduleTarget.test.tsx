import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { storeAssistant } from './catalog';
import { ensureHeartbeats } from './heartbeats';
import { personalScheduleDraft, personalScheduleTarget } from './scheduleTarget';
import { saveCoreSchedule } from '@/features/schedules/runtime/schedules';
import { PersonalSchedules } from '../ui/PersonalSchedules';

vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn() }));
vi.mock('@/features/schedules/runtime/schedules', async load => ({ ...await load<object>(), saveCoreSchedule: vi.fn(async () => {}), toggleCoreSchedule: vi.fn() }));

const a = { id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a/work', conversation: 'conv' };
const expected = { conversationId: 'conv', agentConfig: { name: '小麓', workspace: '/a/work', model: { provider_id: 'cloud', model: 'pro' } } };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  // 会话自己的 workspace 与助理目录不同：执行目标一律用助理工作区
  S.convs = [{ id: 'conv', title: '', owner: 'pc', messages: [], updated: 1, modelId: 'cloud::pro', providerId: 'cloud', workspace: '/elsewhere', personal: { id: 'pa_a', name: '小麓', directory: '/a' } }];
  storeAssistant(a); vi.mocked(api).mockResolvedValue([] as never);
});

it('SCHED-TARGET-01 AC-1 助理任务的执行目标只解析一次：归属、Lom 模型、助理工作区', () => {
  expect(personalScheduleTarget(a)).toEqual(expected);
  S.convs[0].providerId = undefined;
  expect(personalScheduleTarget(a)).toEqual(expected); // 旧会话只记了 modelId 时从中取服务商
});

it('SCHED-TARGET-01 AC-2 归属不一致或没有模型时拒绝，不拼出半成品配置', () => {
  expect(() => personalScheduleTarget({ ...a, directory: '/other' })).toThrow('归属不一致');
  expect(() => personalScheduleTarget({ ...a, conversation: 'missing' })).toThrow('归属不一致');
  S.convs[0].modelId = undefined;
  expect(() => personalScheduleTarget(a)).toThrow('请先连接Lom模型');
});

it('SCHED-TARGET-01 AC-3 新建任务与默认心跳用同一份目标', async () => {
  await ensureHeartbeats(a);
  const heartbeat = vi.mocked(saveCoreSchedule).mock.calls[0][0];
  expect(heartbeat).toMatchObject({ conversationId: expected.conversationId, agentConfig: expected.agentConfig, runIn: 'same', runMode: 'default' });
  vi.mocked(saveCoreSchedule).mockClear();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<PersonalSchedules assistant={a} />));
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '新建')!.click());
    const fill = (sel: string, v: string) => {
      const el = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(sel)!;
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => { fill('.pa-form input', '晨间提醒'); fill('.pa-form textarea', '整理今天安排'); });
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '创建静默任务')!.click());
  } finally { await act(async () => root.unmount()); }
  const created = vi.mocked(saveCoreSchedule).mock.calls[0];
  expect(created[0]).toEqual(personalScheduleDraft(a, { name: '晨间提醒', prompt: '整理今天安排' }, { freq: 'daily', time: '09:00' }));
  expect(created[2]).toEqual({ personalId: 'pa_a' });
});
