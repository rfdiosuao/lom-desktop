import { invoke } from '@tauri-apps/api/core';
import { authAccount } from '@/features/account/runtime/authScope';
import { approvePermission } from '@/features/chat/runtime/permissions';
import { confirm } from '@/shared/overlays/controller';
import { S, update, watchStore } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
import { feishuStatus, sameFeishuScope, captureFeishuScope, type FeishuScope } from './feishu';

interface Pending {
  account: string; assistantId: string; appId: string; generation: number; nonce: string; current: () => boolean;
  decide: (allow: boolean) => Promise<boolean>; finish: (allowed: boolean) => void;
  used: boolean; outcome?: string; expires: number; timer: ReturnType<typeof setTimeout>;
}
const pending = new Map<string, Pending>();
const lastUser = (c: Conv) => c.messages.findLast(m => m.type === 'user');
const nonce = () => crypto.randomUUID().replaceAll('-', '');
const sanitize = (s: string) => s
  .replace(/(?:sk-|oc_sk_)[A-Za-z0-9_-]+/g, '[已隐藏密钥]')
  .replace(/((?:Bearer|Basic)\s+)\S+/gi, '$1[已隐藏]')
  .replace(/(["']?[\w-]*(?:api[_-]?key|access[_-]?token|password|secret|device[_-]?code)[\w-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[已隐藏]')
  .replace(/([?&](?:code|token|key|secret)=)[^&\s]+/gi, '$1[已隐藏]');
function finishNotice(p: Pending) {
  if (S.cloud === 'signed-in' && S.account?.id === p.account) void invoke('feishu_notice_finish', { account: p.account, assistantId: p.assistantId, appId: p.appId, generation: p.generation, nonce: p.nonce, outcome: p.outcome || 'resolved' }).catch(() => console.warn('feishu.approval_card_update_failed'));
}
function discard(p: Pending, allowed = false, outcome = 'resolved') {
  clearTimeout(p.timer); pending.delete(p.nonce); p.outcome = outcome; p.finish(allowed); finishNotice(p);
}
watchStore(() => {
  for (const p of [...pending.values()]) if (!p.used && (!p.current() || Date.now() >= p.expires)) discard(p);
});
async function decide(p: Pending, allow: boolean) {
  if (p.used || Date.now() >= p.expires || !p.current()) { discard(p); return; }
  p.used = true;
  try { const allowed = await p.decide(allow); discard(p, allowed, allowed ? 'allowed' : allow ? 'failed' : 'denied'); }
  catch { discard(p); } // Unknown submission is not automatically retried or approved.
}
/** Only an exact nonce-bearing command; bare yes/no is never treated as consent. */
export function consumeFeishuApprovalText(text: string, source: FeishuScope) {
  const match = /^(允许|同意|拒绝) ([a-f0-9]{32})$/.exec(text.trim());
  if (!match) return false;
  const p = pending.get(match[2]);
  if (p && matches(p, source)) void decide(p, match[1] !== '拒绝');
  return true; // Unknown/expired approval syntax must not enter the model as a fresh instruction.
}
const matches = (p: Pending, source: FeishuScope) => sameFeishuScope(p, { account: source.account, assistant_id: source.assistantId, app_id: source.appId, generation: source.generation });
export function consumeFeishuApprovalAction(source: FeishuScope, token: string, choice: string) {
  const p = pending.get(token);
  if (!p || !matches(p, source) || !['once', 'deny'].includes(choice)) return;
  void decide(p, choice === 'once');
}
async function create(c: Conv, summary: string, extraGuard: () => boolean, apply: (allow: boolean) => Promise<boolean>, desktop: boolean) {
  const auth = authAccount(), account = S.account?.id, assistantId = c.personal?.id, turn = lastUser(c);
  if (!account || !assistantId || !auth() || !S.running[c.id] || pending.size >= 128) return false;
  const status = await feishuStatus(account, assistantId), appId = status.app_id;
  const connection = captureFeishuScope({ account, assistantId, appId: appId || '', generation: status.generation });
  const current = () => { try { return auth() && connection() && extraGuard() && S.convs.includes(c) && !!S.running[c.id] && lastUser(c) === turn && !!appId && c.personal?.id === assistantId; } catch { return false; } };
  if (!appId || !current()) return false;
  return new Promise<boolean>(resolve => {
    const id = nonce();
    const p: Pending = { account, assistantId, appId, generation: status.generation, nonce: id, current, decide: apply, finish: resolve, used: false, expires: Date.now() + 30 * 60_000, timer: setTimeout(() => { discard(p, false, 'expired'); }, 30 * 60_000) };
    pending.set(id, p);
    if (turn?.source === 'feishu') {
      void invoke('feishu_owner_notice', { account, assistantId, appId, generation: status.generation, nonce: id, summary: sanitize(`${c.personal!.name}：${summary}`) })
        .then(() => { if (p.outcome) finishNotice(p); })
        .catch(() => { if (!desktop) discard(p); }); // Core confirmation remains available on desktop.
    }
    if (desktop) {
      confirm({ title: '批准助理的飞书操作', desc: summary, okText: '允许一次', onOk: () => { void decide(p, true); } });
      const modal = S.modals.at(-1)!;
      const stop = watchStore(() => {
        if (!pending.has(id)) { stop(); return; }
        if (!S.modals.includes(modal)) queueMicrotask(() => { if (!p.used && pending.has(id)) discard(p); stop(); });
      });
      const finish = p.finish;
      p.finish = allowed => { stop(); update(s => { const i = s.modals.indexOf(modal); if (i >= 0) s.modals.splice(i, 1); }); finish(allowed); };
    }
  });
}
export function requestPersonalToolApproval(c: Conv, summary: string, current: () => boolean) {
  return create(c, summary, current, async allow => allow, true);
}
/** A core approval already has its desktop UI; mirror only a Feishu-triggered turn. */
export async function mirrorFeishuConfirmation(c: Conv, m: Msg) {
  if (!c.personal || lastUser(c)?.source !== 'feishu' || m.status !== 'pending') return;
  await create(c, m.command || '助理申请执行操作，请在桌面核对完整参数。', () => c.messages.includes(m) && m.status === 'pending', async allow => {
    await approvePermission(c, m, allow ? 'once' : 'deny');
    return m.status === 'approved';
  }, false);
}
