import { S } from '@/state/store';

export interface AuditEntry { id: string; at: number; conversation: string; tool: string; status: string; }
const key = () => `lom-audit-v1:${S.account?.id || 'local'}`;
/** Metadata only: never persist arguments, command bodies, paths, results or credentials. */
export function readAudit(): AuditEntry[] {
  const value: unknown = JSON.parse(localStorage.getItem(key()) || '[]');
  if (!Array.isArray(value)) throw new Error('操作记录格式错误');
  return value.filter((x): x is AuditEntry => !!x && typeof x.id === 'string' && typeof x.at === 'number'
    && typeof x.conversation === 'string' && typeof x.tool === 'string' && typeof x.status === 'string').slice(-1000);
}
let warned = false;
export function audit(conversation: string, id: string, tool: string, status: string) {
  if (!S.prefs.auditLog) return;
  try {
    const items = readAudit();
    const row = { id: `${conversation}:${id}`, at: Date.now(), conversation, tool: tool.slice(0, 100), status: status.slice(0, 40) };
    const prior = items.findIndex(x => x.id === row.id);
    if (prior >= 0 && items[prior].status === row.status && items[prior].tool === row.tool) return;
    if (prior >= 0) items[prior] = row; else items.push(row);
    localStorage.setItem(key(), JSON.stringify(items.slice(-1000)));
    warned = false;
  } catch {
    if (!warned) { warned = true; void import('@/shared/overlays/controller').then(({ toast }) => toast('操作记录保存失败，请检查本机存储空间', 'info')); }
  }
}
export function clearAudit() { localStorage.removeItem(key()); }
