import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { mapHistory } from '../runtime/history';
import { channelEnvelope, channelOf } from '../runtime/channelSource';
import { stripSettingsContext, publicationPolicy } from '@/features/settings/runtime/preferences';
import type { Conv, Msg } from '@/state/types';
import type { CoreMessage } from '@/core/types';
import { UserMessage } from './UserMessage';
vi.mock('../actions/message', () => ({ resendEditedMessage: vi.fn(), retryFailedMessage: vi.fn(), checkUnconfirmedMessage: vi.fn() }));

const conv = { id: 'c1', owner: 'pc', title: '', updated: 1, messages: [] } as unknown as Conv;
const memory = '[LOM_PERSONAL_MEMORY_V1]\n只读\n{"version":"v"}\n[/LOM_PERSONAL_MEMORY_V1]\n\n';

it('FEISHU-02 a message sent from Feishu keeps its origin after reloading history, without leaking the hidden note', () => {
  const raw = `${publicationPolicy()}\n\n${memory}${channelEnvelope('feishu')}帮我看下明天的日程`;
  expect(stripSettingsContext(raw)).toBe('帮我看下明天的日程');
  expect(channelOf(raw)).toEqual({ source: 'feishu' });
  expect(channelOf(`${publicationPolicy()}\n\n普通消息`)).toEqual({});
  expect(channelOf(`${channelEnvelope('personal')}修好测试`)).toEqual({ source: 'personal' });
  expect(stripSettingsContext(`${channelEnvelope('personal')}修好测试`)).toBe('修好测试');
  // 用户自己打出这段标记时，不在开头位置，不会被当成来源
  expect(stripSettingsContext(`说明：${channelEnvelope('wechat')}`)).toContain('LOM_CHANNEL_V1');
  const items = [{ id: 'h1', msg_id: 'r1', type: 'text', position: 'right', created_at: 5, content: { content: raw } }] as unknown as CoreMessage[];
  const [m] = mapHistory(items, conv).messages;
  expect(m).toMatchObject({ type: 'user', text: '帮我看下明天的日程', source: 'feishu' });
});

it('FEISHU-02 PA04 the chat shows 来自飞书 / 来自微信 / 由个人助理派发 on messages from those channels, which cannot be edited from here', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const show = (m: Msg) => act(async () => root.render(<UserMessage m={m} ctxId="c1" />));
  await show({ id: 'm1', type: 'user', at: 1, text: '在吗', source: 'feishu' });
  expect(host.textContent).toContain('来自飞书');
  expect(host.querySelector('[aria-label="编辑消息"]')).toBeNull();
  await show({ id: 'm2', type: 'user', at: 1, text: '在吗', source: 'wechat' });
  expect(host.textContent).toContain('来自微信');
  await show({ id: 'm4', type: 'user', at: 1, text: '修好测试', source: 'personal' });
  expect(host.textContent).toContain('由个人助理派发');
  expect(host.querySelector('[aria-label="编辑消息"]')).toBeNull();
  await show({ id: 'm3', type: 'user', at: 1, text: '在吗' });
  expect(host.textContent).not.toContain('来自');
  expect(host.querySelector('[aria-label="编辑消息"]')).not.toBeNull();
  await act(async () => root.unmount()); host.remove();
});
