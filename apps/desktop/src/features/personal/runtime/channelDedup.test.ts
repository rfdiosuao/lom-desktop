import { beforeEach, expect, it } from 'vitest';
import { clearChannelHistory, reserveChannelMessage } from './channelDedup';

beforeEach(() => clearChannelHistory());

it('REFACTOR-01-M5 AC-1 飞书与微信各自去重，同一消息 ID 互不影响', () => {
  const feishu = reserveChannelMessage('feishu', ['acc', 'pa', 'app'], 'm1', () => true)!;
  feishu.dispatched();
  expect(reserveChannelMessage('feishu', ['acc', 'pa', 'app'], 'm1', () => true)).toBeNull();
  expect(reserveChannelMessage('wechat', ['acc', 'pa'], 'm1', () => true)).not.toBeNull();
});

it('REFACTOR-01-M5 AC-2 只清指定渠道的去重记录', () => {
  reserveChannelMessage('feishu', ['acc', 'pa', 'app'], 'm1', () => true)!.dispatched();
  reserveChannelMessage('wechat', ['acc', 'pa'], 'm1', () => true)!.dispatched();
  clearChannelHistory('wechat');
  expect(reserveChannelMessage('wechat', ['acc', 'pa'], 'm1', () => true)).not.toBeNull();
  expect(reserveChannelMessage('feishu', ['acc', 'pa', 'app'], 'm1', () => true)).toBeNull();
});
