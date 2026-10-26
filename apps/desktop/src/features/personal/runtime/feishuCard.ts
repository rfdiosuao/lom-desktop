import type { FeishuScope } from './feishu';
import type { Conv, Msg } from '@/state/types';
import { emptyReply, feishuApi, findField, followTurn, replyText, type TurnReply } from './feishuTurn';

/* ===== FEISHU-03：流式卡片回复（思路同飞书官方的智能体插件）=====
 * 1. 建一张开启 streaming_mode 的卡片实体，用它回复这条飞书消息；
 * 2. 助理边写，边把累计正文推到卡片的 answer 元素（飞书端打字机效果）；推送串行进行、序号递增、按间隔合并；
 * 3. 本轮结束：关闭流式模式，换成带用时与状态的完成卡片。
 * 卡片建不起来时退回纯文本回复；卡片发出后中途更新失败，结束时再补发一条文本，保证用户收到完整回复。 */

const ANSWER = 'answer';
const STATUS = 'status';
const plain = (text: string) => text.replace(/[*_`#>[\]()~]/g, '').replace(/\s+/g, ' ').trim();
const summary = (text: string) => ({ content: plain(text).slice(0, 120) || '处理中…' });

export function streamingCard() {
  return {
    schema: '2.0',
    config: { streaming_mode: true, summary: summary(''), streaming_config: { print_frequency_ms: { default: 50 }, print_step: { default: 2 }, print_strategy: 'fast' } },
    body: { elements: [
      { tag: 'markdown', element_id: ANSWER, content: '' },
      { tag: 'markdown', element_id: STATUS, content: statusLine(0), text_size: 'notation' },
    ] },
  };
}

export function statusLine(tools: number) {
  return tools ? `<font color='grey'>正在处理 · 已用 ${tools} 个工具…</font>` : "<font color='grey'>正在处理…</font>";
}

export function finalCard(reply: TurnReply, elapsedMs: number) {
  const text = reply.text || emptyReply(reply);
  const seconds = Math.max(1, Math.round(elapsedMs / 1000));
  const foot = [reply.failed ? '未完成' : '已完成', `用时 ${seconds} 秒`, reply.tools ? `${reply.tools} 个工具` : ''].filter(Boolean).join(' · ');
  return {
    schema: '2.0',
    config: { streaming_mode: false, summary: summary(text) },
    body: { elements: [
      { tag: 'markdown', element_id: ANSWER, content: text },
      { tag: 'markdown', element_id: STATUS, content: `<font color='grey'>${foot}</font>`, text_size: 'notation' },
    ] },
  };
}

const cardJson = (card: unknown) => ({ type: 'card_json', data: JSON.stringify(card) });

/** 跟踪一轮并以流式卡片回复；`gapMs` 是两次推送之间的最小间隔 */
export async function streamReply(scope: FeishuScope, messageId: string, c: Conv, sent: Msg, gapMs = 300, current = () => true) {
  const scopedApi: typeof feishuApi = (...args) => {
    if (!current()) return Promise.reject(new Error('feishu.binding_changed'));
    return feishuApi(...args);
  };
  if (!current()) return;
  const started = Date.now();
  let cardId: string | undefined;
  try {
    cardId = findField(await scopedApi(scope, 'POST', '/open-apis/cardkit/v1/cards', cardJson(streamingCard())), 'card_id');
    if (!cardId) throw new Error('feishu.card_missing');
    await scopedApi(scope, 'POST', `/open-apis/im/v1/messages/${messageId}/reply`, { msg_type: 'interactive', content: JSON.stringify({ type: 'card', data: { card_id: cardId } }) });
  } catch (e) {
    if (!current()) return;
    console.warn('feishu.card_create_failed', e);
    const reply = await followTurn(c, sent, undefined, current);
    if (current()) await replyText(scope, messageId, reply.text || emptyReply(reply));
    return;
  }
  const id = cardId;
  let sequence = 0, latest: TurnReply = { text: '', failed: false, tools: 0 }, shown = latest, broken = false, done = false;
  let wake = () => {};
  const same = () => latest.text === shown.text && latest.tools === shown.tools;
  // 串行推送：有新内容就推一次，两次之间至少隔 gapMs；结束后由完成卡片一次性给出全文
  const push = async () => {
    for (;;) {
      while (!done && same()) await new Promise<void>(resolve => { wake = resolve; });
      if (done || !current()) return;
      const next = latest;
      try {
        if (next.text !== shown.text) await scopedApi(scope, 'PUT', `/open-apis/cardkit/v1/cards/${id}/elements/${ANSWER}/content`, { content: next.text, sequence: ++sequence });
        else await scopedApi(scope, 'PUT', `/open-apis/cardkit/v1/cards/${id}/elements/${STATUS}/content`, { content: statusLine(next.tools), sequence: ++sequence });
        shown = next;
      } catch (e) { console.warn('feishu.card_stream_failed', e); broken = true; return; }
      await new Promise(resolve => setTimeout(resolve, gapMs));
    }
  };
  const pushing = push();
  const reply = await followTurn(c, sent, r => { latest = r; wake(); }, current);
  done = true; wake();
  await pushing;
  if (!current()) return;
  try {
    await scopedApi(scope, 'PATCH', `/open-apis/cardkit/v1/cards/${id}/settings`, { settings: JSON.stringify({ streaming_mode: false }), sequence: ++sequence });
    await scopedApi(scope, 'PUT', `/open-apis/cardkit/v1/cards/${id}`, { card: cardJson(finalCard(reply, Date.now() - started)), sequence: ++sequence });
    if (broken) throw new Error('feishu.card_stream_incomplete');
  } catch (e) {
    if (!current()) return;
    console.warn('feishu.card_finish_failed', e);
    if (broken) await replyText(scope, messageId, reply.text || emptyReply(reply));
  }
}
