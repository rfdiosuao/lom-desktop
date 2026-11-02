import { api, getEndpoint } from '@/core/client';
import { acpExtra, type AgentRow } from './agents';
import { EXCLUDED_AUTO_SKILLS } from './agentRules';
import { cachedOptions, effortOption } from './agentOptions';
import { perm } from '@/state/selectors';
import { S } from '@/state/store';
import type { CoreConversation } from '@/core/types';

/** 新任务页预选的档位：只认该 CLI 自己报过、且当前选项里仍存在的值。 */
function pickedEffort(a: AgentRow) {
  const value = S.agentEffortPick[a.id];
  if (!value) return undefined;
  const opt = effortOption(cachedOptions(a.id));
  return opt?.options?.some(o => o.value === value) ? value : undefined;
}

/** Warm only the selected Codex conversation; never send a prompt or change its model. */
export function agentTaskExtra(a: AgentRow, folder: string) {
  const effort = pickedEffort(a);
  return { ...acpExtra(a), ...(folder ? { workspace: folder } : {}),
    session_mode: perm(S.permission).coreMode === 'yolo' ? 'yolo' : 'default',
    exclude_auto_inject_skills: EXCLUDED_AUTO_SKILLS,
    ...(effort ? { thought_level: effort } : {}),
    ...(S.agentModelPick[a.id] ? { current_model_id: S.agentModelPick[a.id] } : {}) };
}

interface Prepared {
  key: string; endpoint: ReturnType<typeof getEndpoint>; account?: string;
  created: Promise<CoreConversation | null>; claimed: boolean; disposed: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
let prepared: Prepared | undefined;
const sameScope = (p: Prepared) => p.endpoint === getEndpoint() && p.account === S.account?.id;

function dispose(p: Prepared) {
  if (p.claimed || p.disposed) return;
  p.disposed = true;
  clearTimeout(p.timer);
  if (prepared === p) prepared = undefined;
  void p.created.then(async c => {
    // Never issue a stale request against another account/core. An abandoned probe stays hidden.
    if (c && sameScope(p)) await api('DELETE', `/api/conversations/${c.id}`);
  }).catch(() => console.warn('agent.warmup_cleanup_failed'));
}

/** Called on composer focus. The returned disposer retires only this preparation. */
export function prepareAgentTask(a: AgentRow, folder: string): () => void {
  if (a.backend !== 'codex' || !getEndpoint()) return () => {};
  const extra = agentTaskExtra(a, folder), key = JSON.stringify(extra);
  if (prepared) dispose(prepared);
  const p: Prepared = { key, endpoint: getEndpoint(), account: S.account?.id,
    created: Promise.resolve(null), claimed: false, disposed: false };
  prepared = p;
  p.created = api<CoreConversation>('POST', '/api/conversations', {
    type: 'acp', name: 'lom-probe', extra: { ...extra, lom_probe: true },
  }).catch(() => { console.warn('agent.warmup_create_failed'); return null; });
  void p.created.then(async c => {
    if (c && !p.disposed && !p.claimed && sameScope(p)) {
      // Existing core ensure is single-flight. Sending never waits for model-list polling.
      await api('POST', `/api/conversations/${c.id}/runtime/ensure`, {});
    }
  }).catch(() => console.warn('agent.warmup_runtime_failed')); // Normal send can retry startup.
  p.timer = setTimeout(() => dispose(p), 60_000);
  return () => dispose(p);
}

/** Claim before awaiting so navigation/StrictMode cleanup cannot delete a real task. */
export async function takePreparedTask(extra: Record<string, unknown>, title: string): Promise<CoreConversation | null> {
  const p = prepared;
  if (!p) return null;
  if (!sameScope(p) || p.key !== JSON.stringify(extra)) { dispose(p); return null; }
  p.claimed = true;
  clearTimeout(p.timer);
  prepared = undefined;
  const c = await p.created;
  if (!c) return null;
  if (!sameScope(p)) throw new Error('账号或核心已切换，请重新发送');
  try {
    await api('PATCH', `/api/conversations/${c.id}`, { name: title, name_source: 'auto', extra: { lom_probe: false } });
    if (!sameScope(p)) throw new Error('账号或核心已切换，请重新发送');
    return { ...c, name: title, extra: { ...c.extra, lom_probe: false } };
  } catch (e) {
    p.claimed = false;
    dispose(p);
    throw e;
  }
}
