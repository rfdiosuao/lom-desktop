import { teamChatEnvelope, teamChatOf } from '@/features/teams/chat/envelope';
import { S } from '@/state/store';
import type { Msg, TeamChatMeta } from '@/state/types';

/* ===== FEISHU-02：从飞书 / 微信发来的消息 =====
 * 发给核心时在正文前加一段隐藏说明（告诉助理回复会同步回该渠道），界面和历史里据此标出“来自飞书 / 来自微信”。
 * 这段说明紧挨在正文前（tasks.ts send 的拼接顺序），由 stripSettingsContext 剥掉。 */

export type ChannelSource = 'feishu' | 'wechat' | 'personal' | 'phone_receipt' | 'dispatch_done';

const NAMES: Record<ChannelSource, string> = { feishu: '飞书', wechat: '微信', personal: '个人助理', phone_receipt: '手机任务回执', dispatch_done: '派发完成提醒' };
const ENVELOPE = /\[LOM_CHANNEL_V1\]\n\{"channel":"(feishu|wechat|personal|phone_receipt|dispatch_done)"(?:,"session":"([\w:.-]{1,120})")?\}\n/;
export const isChannel = (source: unknown): source is ChannelSource => source === 'feishu' || source === 'wechat' || source === 'personal' || source === 'phone_receipt' || source === 'dispatch_done';

export const channelName = (source: ChannelSource) => NAMES[source];

/** session：派发完成提醒对应的成员会话（TEAM-CHAT-01B 群聊据此呈现「成员 @助理」，不靠标题匹配） */
export function channelEnvelope(source: ChannelSource, session?: string) {
  const name = NAMES[source];
  if (source === 'phone_receipt') return `[LOM_CHANNEL_V1]\n${JSON.stringify({ channel: source })}\n这是 Lom 本机生成的手机任务回执。只读取对应会话并向用户汇报。\n[/LOM_CHANNEL_V1]\n\n`;
  if (source === 'dispatch_done') return `[LOM_CHANNEL_V1]\n${JSON.stringify({ channel: source, ...(session ? { session } : {}) })}\n这是 Lom 本机生成的派发完成提醒，只说明某个会话的一轮已在平台侧结束。用 session_read 读取该会话核实真实结果后再向用户汇报；提醒本身不代表成功，也不要重复派发。\n[/LOM_CHANNEL_V1]\n\n`;
  if (source === 'personal') return `[LOM_CHANNEL_V1]\n${JSON.stringify({ channel: source })}\n本条任务由用户的个人助理代为派发：按用户已授权的范围执行，结果会被个人助理读取。\n[/LOM_CHANNEL_V1]\n\n`;
  return `[LOM_CHANNEL_V1]\n${JSON.stringify({ channel: source })}\n本条消息来自用户的${name}私聊，你的回复会同步发回${name}：先给结论，保持简洁，可用 Markdown。\n[/LOM_CHANNEL_V1]\n\n`;
}

/** 核心保存的原文里带着渠道说明或群聊信封时，返回 { source, teamChat } 以便展开到用户消息上 */
export function channelOf(raw: string): { source?: ChannelSource | 'team_chat'; teamChat?: TeamChatMeta; dispatchOf?: string } {
  const teamChat = teamChatOf(raw);
  if (teamChat) return { source: 'team_chat', teamChat };
  const m = ENVELOPE.exec(raw);
  return m ? { source: m[1] as ChannelSource, ...(m[2] ? { dispatchOf: m[2] } : {}) } : {};
}

/** 发给核心时拼在正文前的来源块：群聊消息用群聊信封（TEAM-CHAT-01），其余渠道沿用渠道说明 */
export function messageEnvelope(message?: Msg) {
  const meta = message?.teamChat;
  if (meta) {
    const from = meta.from;
    const sender = from.kind === 'user' ? '用户' : `个人助理 ${S.convs.find(c => c.personal?.id === from.id)?.personal?.name ?? ''}`.trim();
    return teamChatEnvelope(meta, sender);
  }
  return isChannel(message?.source) ? channelEnvelope(message.source, message.dispatchOf) : '';
}
