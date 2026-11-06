import type { TeamChatMeta } from '@/state/types';

/* ===== TEAM-CHAT-01 群聊信封 =====
 * 群聊发言投给成员或个人助理时，正文前加一段隐藏信封。核心把它当普通正文保存，
 * 桌面读历史和实时事件时据此把这条用户消息关联回群聊发言；界面只显示正文。
 * 信封里只有标识、名字、角色，不放路径、权限或模型；出现这类字段视为损坏。 */

const OPEN = '[LOM_TEAM_CHAT_V1]', CLOSE = '[/LOM_TEAM_CHAT_V1]';
const PATTERN = /\[LOM_TEAM_CHAT_V1\]\n(\{[^\n]*\})\n/;
const FORBIDDEN = ['cwd', 'agent', 'access', 'model'];
const ID = /^[\w:.-]{1,120}$/;
export const MAX_HOP = 8;

const names = (meta: TeamChatMeta) => meta.to.map(r => (r.role ? `${r.name}（${r.role}）` : r.name)).join('、');

/** 拼在正文前的隐藏块：给模型的说明只讲来源和接收者，不带群聊历史（§9-③） */
export function teamChatEnvelope(meta: TeamChatMeta, sender: string) {
  const how = meta.from.kind === 'personal' || meta.to.some(r => r.key.startsWith('pa:'))
    ? '需要团队成员协作时用 personal_team_send 或团队工具；正文里写 @ 不会送达任何人。'
    : '需要其他成员协作时用团队工具；正文里写 @ 不会送达任何人。';
  return `${OPEN}\n${JSON.stringify(meta)}\n这是 Lom 团队群聊里的一条发言。发送者：${sender}；本次接收者：${names(meta)}。只处理与你相关的部分。${how}\n${CLOSE}\n\n`;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && ID.test(v);
const label = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

function hasForbidden(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasForbidden);
  return record(v) && Object.entries(v).some(([k, x]) => FORBIDDEN.includes(k) || hasForbidden(x));
}

function valid(v: unknown): v is TeamChatMeta {
  if (!record(v) || hasForbidden(v)) return false;
  const from = v.from, to = v.to;
  const sender = record(from) && (from.kind === 'user' ? Object.keys(from).length === 1 : from.kind === 'personal' && id(from.id) && (from.name === undefined || label(from.name, 80)));
  return id(v.post) && id(v.chain) && id(v.team) && Number.isInteger(v.hop) && (v.hop as number) >= 0 && (v.hop as number) <= MAX_HOP && sender
    && Array.isArray(to) && to.length > 0 && to.length <= 16
    && to.every(r => record(r) && id(r.key) && label(r.name, 80) && (r.role === undefined || label(r.role, 80)));
}

/** 从核心保存的原文里取出群聊关联；没有信封返回 undefined，信封损坏记日志并当普通消息处理 */
export function teamChatOf(raw: string): TeamChatMeta | undefined {
  const m = PATTERN.exec(raw);
  if (!m) return undefined;
  try {
    const meta: unknown = JSON.parse(m[1]);
    if (valid(meta)) return meta;
  } catch { /* 下面统一记日志 */ }
  console.warn('team.chat_envelope_invalid');
  return undefined;
}
