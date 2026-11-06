import { expect, it, vi } from 'vitest';
import type { Conv, Msg, Team, TeamChatMeta } from '@/state/types';
import { teamChatTimeline, type ChatSource } from './timeline';

const meta = (post: string, key = 'm:b'): TeamChatMeta => ({ post, chain: 'c', hop: 0, team: 't1', from: { kind: 'user' }, to: [{ key, name: 'B' }] });
const team = { id: 't1', members: [], chatPosts: [] } as unknown as Team;
const conv = (id: string, messages: Msg[], extra: Partial<Conv> = {}): Conv => ({ id, owner: 'pc', title: id, updated: 1, messages, ...extra });

it('TEAM-CHAT-01A AC-A3 a streaming reply is one item that grows in place, never a second copy', () => {
  const reply: Msg = { id: 'a1', type: 'assistant', at: 3, text: '正在', streaming: true };
  const c = conv('mem', [{ id: 'u1', type: 'user', at: 2, text: '查资料', teamChat: meta('p1') }, reply]);
  const src: ChatSource = { key: 'm:b', conv: c, assistant: false };
  const first = teamChatTimeline(team, [src]);
  reply.text = '正在整理结论'; reply.streaming = false;
  const again = teamChatTimeline(team, [src]);
  expect(first.map(i => i.kind)).toEqual(['post', 'reply']);
  expect(again.filter(i => i.kind === 'reply')).toHaveLength(1);
  const item = again[1] as Extract<typeof again[number], { kind: 'reply' }>;
  expect(item.msgs[0]).toBe(reply);
  expect(item.msgs[0].text).toBe('正在整理结论');
  expect(item.post).toBe('p1');
});

it('TEAM-CHAT-01A pane-direct messages show as direct, personal assistant private chat stays out, duplicates are ignored', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const member = conv('mem', [
    { id: 'd1', type: 'user', at: 1, text: '单独问一句' }, { id: 'a0', type: 'assistant', at: 2, text: '好' },
    { id: 'u1', type: 'user', at: 3, text: '群聊', teamChat: meta('p1') }, { id: 'a1', type: 'assistant', at: 4, text: '收到' },
    { id: 'u2', type: 'user', at: 5, text: '群聊', teamChat: meta('p1') }, { id: 'a2', type: 'assistant', at: 6, text: '重复' },
  ]);
  const pa = conv('pa', [
    { id: 'x1', type: 'user', at: 1, text: '私事' }, { id: 'x2', type: 'assistant', at: 2, text: '私事回复' },
    { id: 'y1', type: 'user', at: 7, text: '小鹿看看', teamChat: meta('p2', 'pa:pa_1') }, { id: 'y2', type: 'assistant', at: 8, text: '我来' },
  ], { personal: { id: 'pa_1', name: '小鹿', directory: '/d' } });
  const items = teamChatTimeline(team, [{ key: 'm:b', conv: member, assistant: false }, { key: 'pa:pa_1', conv: pa, assistant: true }]);
  expect(items.map(i => i.kind)).toEqual(['direct', 'reply', 'post', 'reply', 'post', 'reply']);
  const texts = items.flatMap(i => (i.kind === 'reply' ? i.msgs.map(m => m.text) : []));
  expect(texts).toEqual(['好', '收到', '我来']);
  expect(warn).toHaveBeenCalledWith('team.chat_post_duplicate', { conv: 'mem', post: 'p1' });
  warn.mockRestore();
});
