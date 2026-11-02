import { invoke } from '@tauri-apps/api/core';
import type { CommanderCall } from '@/core/remoteWire';
import { authAccount, onAuthChange } from '@/features/account/runtime/authScope';
import { isTaskStopping } from '@/features/chat/runtime/cancel';
import { scopeOwnedByAccount } from '@/features/phones/runtime/phoneCommander';
import { audit } from '@/features/settings/runtime/audit';
import { captureDelegation } from '@/features/teams/runtime/delegationLifecycle';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
import { feishuStatus, captureFeishuScope, type FeishuScope } from './feishu';
import type { Result } from './sessionTools';

export interface FeishuToolApproval {
  call: CommanderCall; assistant: Conv; appId: string;
  arguments: Record<string, unknown>; current: () => boolean;
}
export interface FeishuToolHooks {
  approve?: (payload: FeishuToolApproval) => Promise<boolean>;
  fullAccess?: (assistant: Conv) => boolean;
  requiresApproval?: (assistant: Conv) => boolean;
  needUserAuth?: (account: string, assistantId: string, appId: string) => Promise<void>;
}
const tools = new Set(['feishu_search_docs', 'feishu_read_doc', 'feishu_list_chats', 'feishu_search_chats', 'feishu_read_messages', 'feishu_search_messages', 'feishu_chat_members', 'feishu_find_people', 'feishu_send_message']);
const prompted = new Set<string>();
const sends = new Map<string, { args: string; result: Promise<Result> }>();
onAuthChange(() => { prompted.clear(); sends.clear(); });
const result = (value: unknown, isError = false): Result => ({ isError, content: [{ type: 'text', text: JSON.stringify(value) }] });
const failure = (code: string) => result({ code, message: code === 'feishu.need_user_auth' ? '需要先授权飞书' : code }, true);

async function run(call: CommanderCall, hooks: FeishuToolHooks): Promise<Result> {
  const self = S.convs.find(c => c.personal && c.personalScope === call.scope);
  const account = S.account?.id, authenticated = authAccount();
  const active = self ? captureDelegation(self) : () => false;
  let appId = '';
  let connection: FeishuScope | undefined;
  let liveConnection = () => true;
  const current = () => liveConnection() && authenticated() && active() && !!self && S.cloud === 'signed-in' && !!S.running[self.id]
    && !isTaskStopping(self.id) && scopeOwnedByAccount(call.scope)
    && S.convs.includes(self) && (!connection || self.personal?.id === connection.assistantId);
  try {
    if (!call.scope.startsWith('pa-') || !account || !self || !current()) return failure('feishu.not_running');
    if (!tools.has(call.name)) return failure('feishu.invalid_args');
    const args = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
    if (!args || typeof args !== 'object' || Array.isArray(args)) return failure('feishu.invalid_args');
    const status = await feishuStatus(account, self.personal!.id);
    if (!current()) return failure('feishu.account_changed');
    appId = status.app_id || '';
    connection = { account, assistantId: self.personal!.id, appId, generation: status.generation };
    liveConnection = captureFeishuScope(connection);
    if (!appId || !current()) return failure('feishu.binding_invalid');
    if (!status.authorized) {
      const key = `${account}:${appId}`;
      if (hooks.needUserAuth && !prompted.has(key)) {
        prompted.add(key);
        try { await hooks.needUserAuth(account, self.personal!.id, appId); }
        catch (error) { prompted.delete(key); console.warn('feishu.auth_notification_failed', error instanceof Error ? error.name : 'error'); }
      }
      return current() ? failure('feishu.need_user_auth') : failure('feishu.account_changed');
    }
    prompted.delete(`${account}:${appId}`);
    if (!hooks.fullAccess?.(self) && (call.name === 'feishu_send_message' || hooks.requiresApproval?.(self))) {
      if (!hooks.approve || !await hooks.approve({ call, assistant: self, appId, arguments: args, current })) return failure('feishu.approval_required');
    }
    if (!current()) return failure('feishu.account_changed');
    const data = await invoke<unknown>('feishu_tool_execute', { ...connection, name: call.name, arguments: args, callId: `${call.scope}:${call.id}` });
    if (!current()) return failure('feishu.account_changed');
    const value = result(data);
    if (new TextEncoder().encode(value.content[0].text).length > 30_000) return failure('feishu.output_too_large');
    audit(self.id, call.id, call.name, 'completed');
    return value;
  } catch (error) {
    if (self) audit(self.id, call.id, call.name, 'failed');
    const raw = String(error);
    const code = raw.match(/feishu\.[a-z_]+/)?.[0] || 'feishu.tool_failed';
    return failure(current() ? code : 'feishu.account_changed');
  }
}

export function executeFeishuTool(call: CommanderCall, hooks: FeishuToolHooks = {}): Promise<Result> {
  if (call.name !== 'feishu_send_message') return run(call, hooks);
  const key = `${S.account?.id}:${call.scope}:${call.id}`, previous = sends.get(key);
  if (previous) return previous.args === call.arguments ? previous.result : Promise.resolve(failure('feishu.invalid_args'));
  if (sends.size >= 128) return Promise.resolve(failure('feishu.send_capacity'));
  // Retain rejected/unknown send outcomes too: replay must never send twice.
  const pending = run(call, hooks); sends.set(key, { args: call.arguments, result: pending }); return pending;
}
