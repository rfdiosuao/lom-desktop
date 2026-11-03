import { authAccount } from '@/features/account/runtime/authScope';
import { readDocument, saveDocument } from '@/features/personal/runtime/memory';
import { lockPersonalConfiguration } from '@/features/personal/runtime/configurationLock';
import type { PersonalAssistant } from '@/features/personal/runtime/catalog';
import { S } from '@/state/store';
import type { Profile } from './profiles';
const start = '<!-- LOM_PROFESSIONAL_PROFILE_START -->';
const end = '<!-- LOM_PROFESSIONAL_PROFILE_END -->';
export function withPersonalProfile(text: string, profile: Profile | null) {
  const a = text.indexOf(start), b = text.indexOf(end);
  if ((a < 0) !== (b < 0) || (a >= 0 && (b < a || text.indexOf(start, a + start.length) >= 0 || text.indexOf(end, b + end.length) >= 0))) throw new Error('智能体配置段不完整，请在助理文档中检查后再应用');
  if (profile && (`${profile.name}\n${profile.rules}`.includes(start) || `${profile.name}\n${profile.rules}`.includes(end))) throw new Error('工作规则包含保留标记');
  const block = profile ? `${start}\n## ${profile.name}\n${profile.rules}\n这些规则不改变已授予的工具、权限或审批要求。\n${end}` : '';
  if (a < 0) return block ? `${text}${text.endsWith('\n') ? '' : '\n'}${block}` : text;
  return `${text.slice(0, a)}${block}${text.slice(b + end.length)}`;
}
export async function applyPersonalProfile(a: PersonalAssistant, before: string, profile: Profile | null) {
  const current = authAccount();
  if (a.conversation && S.running[a.conversation]) throw new Error('助理正在执行任务，请结束后应用配置');
  const release = lockPersonalConfiguration(a.conversation || `profile:${a.id}`);
  try {
    if (profile && (!profile.name.trim() || !profile.rules.trim() || profile.rules.length > 12000)) throw new Error('请填写有效的名称与工作规则');
    const text = withPersonalProfile(before, profile);
    if (new TextEncoder().encode(text).length > 16 * 1024) throw new Error('应用后工作规则超过助理文档上限，请精简后重试');
    await saveDocument(a, 'AGENTS.md', before, text);
    if (!current()) throw new Error('账号已切换，应用结果待核对');
    if (await readDocument(a, 'AGENTS.md') !== text) throw new Error('写入结果未确认，请重新读取');
    return text;
  } finally { release(); }
}
