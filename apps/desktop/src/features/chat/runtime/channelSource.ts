/* ===== FEISHU-02：从飞书 / 微信发来的消息 =====
 * 发给核心时在正文前加一段隐藏说明（告诉助理回复会同步回该渠道），界面和历史里据此标出“来自飞书 / 来自微信”。
 * 这段说明紧挨在正文前（tasks.ts send 的拼接顺序），由 stripSettingsContext 剥掉。 */

export type ChannelSource = 'feishu' | 'wechat' | 'personal';

const NAMES: Record<ChannelSource, string> = { feishu: '飞书', wechat: '微信', personal: '个人助理' };
const ENVELOPE = /\[LOM_CHANNEL_V1\]\n\{"channel":"(feishu|wechat|personal)"\}\n/;
export const isChannel = (source: unknown): source is ChannelSource => source === 'feishu' || source === 'wechat' || source === 'personal';

export const channelName = (source: ChannelSource) => NAMES[source];

export function channelEnvelope(source: ChannelSource) {
  const name = NAMES[source];
  if (source === 'personal') return `[LOM_CHANNEL_V1]\n${JSON.stringify({ channel: source })}\n本条任务由用户的个人助理代为派发：按用户已授权的范围执行，结果会被个人助理读取。\n[/LOM_CHANNEL_V1]\n\n`;
  return `[LOM_CHANNEL_V1]\n${JSON.stringify({ channel: source })}\n本条消息来自用户的${name}私聊，你的回复会同步发回${name}：先给结论，保持简洁，可用 Markdown。\n[/LOM_CHANNEL_V1]\n\n`;
}

/** 核心保存的原文里带着渠道说明时，返回 { source } 以便展开到用户消息上 */
export function channelOf(raw: string): { source?: ChannelSource } {
  const m = ENVELOPE.exec(raw);
  return m ? { source: m[1] as ChannelSource } : {};
}
