import { beforeEach, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
import { finalCard, streamReply, streamingCard } from './feishuCard';

let conv: Conv, sent: Msg;
type Call = { method: string; path: string; body: Record<string, unknown> };
const calls = () => m.invoke.mock.calls.filter(c => c[0] === 'feishu_api').map(c => c[1] as Call);
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

beforeEach(() => {
  vi.clearAllMocks();
  sent = { id: 'u1', type: 'user', at: 1, text: 'q', source: 'feishu' };
  conv = { id: 'c1', owner: 'pc', title: '', updated: 1, messages: [sent] } as unknown as Conv;
  S.convs = [conv]; S.running = { c1: true };
  m.invoke.mockImplementation(async (_cmd: string, a: Call) => a.path === '/open-apis/cardkit/v1/cards' ? { ok: true, data: { code: 0, data: { card_id: 'card_1' } } } : { code: 0 });
});

const say = (text: string) => update(() => { const last = conv.messages.at(-1)!; if (last.type === 'assistant') last.text = text; else conv.messages.push({ id: 'a1', type: 'assistant', at: 2, text }); });

it('FEISHU-03 the answer streams into one card that replies to the Feishu message, then becomes a finished card', async () => {
  const done = streamReply({ account: 'owner', assistantId: 'pa_a', appId: 'cli_a', generation: 1 }, 'om_1', conv, sent, 5);
  await tick();
  say('明天'); await tick(1);
  say('明天 10 点'); await tick(1);
  update(() => conv.messages.push({ id: 't1', type: 'tool', at: 3 }));
  say('会议室已订好'); await tick(10);
  update(s => { delete s.running.c1; });
  await done;
  const all = calls();
  const created = JSON.parse(String(all[0].body.data));
  expect(all[0]).toMatchObject({ method: 'POST', path: '/open-apis/cardkit/v1/cards' });
  expect(created.config.streaming_mode).toBe(true);
  expect(all[1]).toMatchObject({ method: 'POST', path: '/open-apis/im/v1/messages/om_1/reply', body: { msg_type: 'interactive' } });
  expect(JSON.parse(String(all[1].body.content))).toEqual({ type: 'card', data: { card_id: 'card_1' } });
  const streamed = all.filter(c => c.path === '/open-apis/cardkit/v1/cards/card_1/elements/answer/content');
  expect(streamed.length).toBeGreaterThan(0);
  expect(streamed.at(-1)!.body.content).not.toBe('');
  // 序号严格递增；先关流式模式，再换成完成卡片
  const seq = all.slice(2).map(c => Number(c.body.sequence));
  expect(seq).toEqual([...seq].sort((a, b) => a - b));
  expect(new Set(seq).size).toBe(seq.length);
  const [settings, last] = all.slice(-2);
  expect(settings).toMatchObject({ method: 'PATCH', path: '/open-apis/cardkit/v1/cards/card_1/settings' });
  expect(JSON.parse(String(settings.body.settings))).toEqual({ streaming_mode: false });
  expect(last).toMatchObject({ method: 'PUT', path: '/open-apis/cardkit/v1/cards/card_1' });
  const final = JSON.parse(String((last.body.card as { data: string }).data));
  // 工具前后的两段正文合在一起
  expect(final.body.elements[0].content).toBe('明天 10 点\n\n会议室已订好');
  expect(final.body.elements[1].content).toContain('已完成');
  expect(final.body.elements[1].content).toContain('1 个工具');
  expect(all.some(c => c.body.msg_type === 'text')).toBe(false);
});

it('FEISHU-03 falls back to a plain text reply when the card cannot be created', async () => {
  m.invoke.mockImplementation(async (_cmd: string, a: Call) => { if (a.path === '/open-apis/cardkit/v1/cards') throw new Error('feishu.api_failed: no permission'); return {}; });
  const done = streamReply({ account: 'owner', assistantId: 'pa_a', appId: 'cli_a', generation: 1 }, 'om_1', conv, sent, 5);
  say('结果'); update(s => { delete s.running.c1; });
  await done;
  const text = calls().filter(c => c.body.msg_type === 'text');
  expect(text).toHaveLength(1);
  expect(JSON.parse(String(text[0].body.content))).toEqual({ text: '结果' });
});

it('FEISHU-03 if streaming breaks midway the user still gets the full answer as text', async () => {
  m.invoke.mockImplementation(async (_cmd: string, a: Call) => {
    if (a.path === '/open-apis/cardkit/v1/cards') return { data: { card_id: 'card_1' } };
    if (a.path.includes('/elements/') || a.path.endsWith('/settings') || a.path === '/open-apis/cardkit/v1/cards/card_1') throw new Error('feishu.api_failed: 300309');
    return {};
  });
  const done = streamReply({ account: 'owner', assistantId: 'pa_a', appId: 'cli_a', generation: 1 }, 'om_1', conv, sent, 5);
  await tick();
  say('完整的回答'); await tick(1);
  update(s => { delete s.running.c1; });
  await done;
  const text = calls().filter(c => c.body.msg_type === 'text');
  expect(text.map(c => JSON.parse(String(c.body.content)).text)).toEqual(['完整的回答']);
});

it('FEISHU-03 card text: summary is plain text, a failed turn says so, an empty turn still says something', () => {
  expect(streamingCard().body.elements.map(e => e.element_id)).toEqual(['answer', 'status']);
  const failed = finalCard({ text: '积分不足', failed: true, tools: 0 }, 2500);
  expect(failed.body.elements[1].content).toContain('未完成');
  expect(failed.body.elements[1].content).toContain('3 秒');
  expect(finalCard({ text: '**加粗** [链接](x)', failed: false, tools: 0 }, 0).config.summary.content).toBe('加粗 链接x');
  expect(finalCard({ text: '', failed: false, tools: 2 }, 0).body.elements[0].content).toBe('已处理完成。');
});
it('FEISHU-ISOLATE a disconnected binding stops streaming and never sends fallback text', async () => {
  let current = true;
  const done = streamReply({ account: 'owner', assistantId: 'pa_a', appId: 'cli_a', generation: 1 }, 'om_1', conv, sent, 1, () => current);
  await tick();
  const count = calls().length;
  current = false;
  update(s => { delete s.running.c1; });
  await done;
  expect(calls()).toHaveLength(count);
});
