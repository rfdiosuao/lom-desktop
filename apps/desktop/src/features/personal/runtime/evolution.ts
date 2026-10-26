import { invoke, isTauri } from '@tauri-apps/api/core';
import { api } from '@/core/client';
import type { CoreProvider } from '@/core/types';
import { authAccount, onAuthChange } from '@/features/account/runtime/authScope';
import { LOM_PROVIDER_NAME } from '@/features/account/runtime/builtin';
import { S, update } from '@/state/store';
import type { Conv } from '@/state/types';
import { uid } from '@/shared/lib/util';
import { loadAssistants } from './catalog';
const seen = new Set<string>();
const queues = new Map<string, Promise<void>>();
onAuthChange(() => { seen.clear(); queues.clear(); });

/** Only an authoritative completed turn invokes this; no hidden chat turn or tool use. */
export function evolvePersonalTurn(c: Conv, turn: string): Promise<void> {
  if (!isTauri() || !c.personal || !turn || S.cloud !== 'signed-in') return Promise.resolve();
  const current = authAccount(), owner = S.account?.id;
  const key = `${owner}:${c.id}`, event = `${key}:${turn}`;
  if (seen.has(event)) return queues.get(key) ?? Promise.resolve();
  seen.add(event);
  // Capture this turn before a subsequent send changes the in-memory transcript.
  const userIndex = c.messages.findLastIndex(m => m.type === 'user');
  const user = c.messages[userIndex];
  const reply = c.messages.slice(userIndex + 1).filter(m => m.type === 'assistant').map(m => m.text || '').join('\n');
  // 定时任务的提示词不是用户说的话，不从中学偏好
  if (!user?.text?.trim() || user.source === 'schedule' || !reply.trim()) return Promise.resolve();
  const request = { user: user.text, reply, evidence: `${turn}:${user.remoteId || user.id}`, model: c.modelId?.startsWith(`${c.providerId}::`) ? c.modelId.slice(`${c.providerId}::`.length) : undefined, provider: c.providerId };
  const pending = (queues.get(key) ?? Promise.resolve()).then(async () => {
    if (!current()) return;
    try {
      const a = loadAssistants().items.find(a => a.id === c.personal?.id && a.directory === c.personal?.directory && a.conversation === c.id);
      if (!a || c.agentId || !request.model || !request.provider) throw new Error('助理或模型尚未就绪');
      const providers = await api<(CoreProvider & { api_key: string })[]>('GET', '/api/providers');
      try {
        if (!current()) return;
        const p = providers.find(p => p.id === request.provider && p.name === LOM_PROVIDER_NAME && p.enabled && p.api_key && p.models.includes(request.model!));
        if (!p) throw new Error('Lom账号模型尚未连接');
        const proposals = await invoke<string>('personal_reflect', { user: request.user, reply: request.reply, model: request.model, baseUrl: p.base_url, apiKey: p.api_key });
        if (!current()) return;
        const result = await invoke<{ adopted: number; version: number; correction: boolean }>('personal_apply_learning', {
          request: { account: owner, id: a.id, name: a.name, directory: a.directory, turn: `${c.id}:${turn}`, user: request.user, reply: request.reply, evidence: request.evidence, proposals },
        });
        if (current() && result.adopted && result.correction) update(() => c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: `记住了：已更新偏好与工作方法（版本 ${result.version}）。`, ic: 'check' }));
      } finally { providers.forEach(p => { p.api_key = ''; }); }
    } catch (error) {
      // The successful main reply is preserved. Do not replay potentially billed extraction.
      // 没有可靠可学的（提炼结果或证据不合格）是常态，不在对话里提示；连接、额度、存储问题才提示。
      if (quiet(error)) { console.warn('personal.learning_skipped', error); return; }
      if (current()) update(() => c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: `本轮自动学习未完成，原回复已保留。${learningError(error)}`, ic: 'info' }));
    }
  });
  queues.set(key, pending);
  void pending.finally(() => { if (queues.get(key) === pending) queues.delete(key); });
  return pending;
}

export async function waitPersonalLearning(c: Conv) {
  if (c.personal) await queues.get(`${S.account?.id}:${c.id}`);
}

const quiet = (error: unknown) => /learning_schema|learning_evidence/.test(error instanceof Error ? error.message : String(error));

function learningError(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  if (code.includes('learning_schema') || code.includes('learning_evidence')) return '提炼结果或来源证据不符合要求，未采用。';
  if (code.includes('learning_size')) return '本轮内容超过学习长度限制，未截断处理。';
  if (code.includes('learning_model') || code.includes('模型')) return '请检查账号模型连接或额度。';
  return '请检查记忆目录、文件冲突和连接状态。';
}
