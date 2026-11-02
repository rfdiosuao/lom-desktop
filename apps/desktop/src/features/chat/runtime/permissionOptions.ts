import type { CoreConfirmation, CorePermissionRequest } from '@/core/types';
import type { Conv, Msg } from '@/state/types';
import { normCallId } from './tools';
import { agentRow } from '@/features/settings/runtime/agents';

export type PermissionAction = 'deny' | 'once' | 'always';
type Choice = NonNullable<Msg['confirmationOptions']>[number];
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const externalActions = new Map<string, PermissionAction>([['reject', 'deny'], ['allow', 'once'], ['allow_always', 'always']]);
const embeddedActions = new Map<string, PermissionAction>([['cancel', 'deny'], ['proceed_once', 'once'], ['proceed_always', 'always']]);
const kindActions = new Map<string, PermissionAction>([['reject_once', 'deny'], ['reject_always', 'deny'], ['allow_once', 'once'], ['allow_always', 'always']]);

export function permissionIdentity(c: Conv) {
  const backend = c.agentBackend, catalogBackend = agentRow(c.agentId)?.backend;
  const backendConflict = !!(backend && catalogBackend && backend !== catalogBackend);
  const external = !!(c.agentId || c.agentName || backend);
  const engine: NonNullable<Msg['confirmationEngine']> = !external ? 'embedded' : !backend ? 'unknown' : ['claude', 'codex', 'antigravity'].includes(backend) ? 'session' : 'acp';
  return { backend, backendConflict, engine };
}

/** Recovery loses ACP option kinds. Only documented engine values are safe to classify there. */
function choices(engine: Msg['confirmationEngine'], options: unknown, nested: boolean): Choice[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap(raw => {
    const o = record(raw);
    const value = nested ? o.option_id : o.value;
    if (typeof value !== 'string' || !value) return [];
    const kind = kindActions.get(String(o.kind));
    const action = engine === 'acp' ? nested ? kind : 'choice'
      : engine === 'unknown' && !nested ? undefined : (engine === 'embedded' ? embeddedActions : externalActions).get(value);
    // Session confirm treats every unrecognized string as approval. A kind alone
    // cannot make an arbitrary reject ID safe across the available core engines.
    if (nested && kind !== action) return [];
    return action ? [{ value, action, label: String((nested ? o.name : o.label) || value) }] : [];
  });
}

export function permissionRequest(c: Conv, raw: CoreConfirmation | CorePermissionRequest | Record<string, unknown>) {
  const d = record(raw), tool = record(d.tool_call), nested = !!d.tool_call;
  const { backend, backendConflict, engine: knownEngine } = permissionIdentity(c);
  const engine = nested && knownEngine === 'embedded' ? 'unknown' : knownEngine;
  const external = engine !== 'embedded';
  const id = nested ? tool.tool_call_id : d.id;
  const callId = nested ? tool.tool_call_id : d.call_id;
  if (typeof id !== 'string' || !id || typeof callId !== 'string' || !callId) return null;
  const input = record(tool.raw_input);
  return {
    id, callId: external ? callId : normCallId(callId), engine, backend, backendConflict,
    title: String((nested ? tool.title : d.title) || ''),
    action: String(d.action || ''), description: String((nested ? input.description : d.description) || ''),
    commandType: nested ? tool.kind : d.command_type,
    questions: nested ? input.questions : d.questions,
    options: backendConflict ? [] : choices(engine, d.options, nested),
  };
}

export function permissionChoice(m: Msg, action: PermissionAction) {
  return m.confirmationOptions?.find(o => o.action === action);
}
