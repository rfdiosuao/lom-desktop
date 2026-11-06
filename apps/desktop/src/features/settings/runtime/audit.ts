import { S } from '@/state/store';

export interface AuditEntry { id: string; at: number; conversation: string; tool: string; status: string; }
/** 日志保存在本机浏览器存储（localStorage），按账号分开；超过这个条数就删掉最早的 */
export const AUDIT_LIMIT = 1000;

/** 日志内容无法读取（SET-AUDIT-01 #430）：与「存储空间不足」是两回事，界面要分别说明 */
export class AuditCorruptError extends Error {
  readonly code = 'audit.corrupt';
  constructor(public raw: string) { super('操作记录数据已损坏，无法读取（audit.corrupt）'); this.name = 'AuditCorruptError'; }
}

const key = () => `lom-audit-v1:${S.account?.id || 'local'}`;
const backupKey = () => `${key()}:corrupt`;
const trimmedKey = () => `${key()}:trimmed`;
const isEntry = (x: unknown): x is AuditEntry => !!x && typeof (x as AuditEntry).id === 'string' && typeof (x as AuditEntry).at === 'number'
  && typeof (x as AuditEntry).conversation === 'string' && typeof (x as AuditEntry).tool === 'string' && typeof (x as AuditEntry).status === 'string';

/** Metadata only: never persist arguments, command bodies, paths, results or credentials. */
export function readAudit(): AuditEntry[] {
  const raw = localStorage.getItem(key());
  if (raw === null) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new AuditCorruptError(raw); }
  if (!Array.isArray(value)) throw new AuditCorruptError(raw);
  return value.filter(isEntry).slice(-AUDIT_LIMIT);
}

/** 因超过上限而删掉的最早记录总数（清空记录时归零） */
export function auditTrimmedCount() {
  const n = Number(localStorage.getItem(trimmedKey()));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 把损坏的原文备份到另一个键并移除；备份写不进去时保留原数据，抛出错误而不是丢数据 */
export function backupAndResetAudit(raw: string) {
  try { localStorage.setItem(backupKey(), raw); } catch (e) { throw new AuditBackupError(e); }
  localStorage.removeItem(key());
  localStorage.removeItem(trimmedKey());
}
export class AuditBackupError extends Error {
  readonly code = 'audit.backup_failed';
  constructor(cause: unknown) { super('操作记录数据已损坏，且无法备份原数据（audit.backup_failed）；原数据未改动，可在审计日志窗口清空后重新记录'); this.cause = cause; }
}

const warned = new Set<string>();
/** 同一个持续存在的故障只提示一次；损坏每发生一次就是一次新事件（重建后才会再损坏），每次都提示 */
function notify(code: string, text: string, once = true) {
  if (once && warned.has(code)) return;
  warned.add(code);
  void import('@/shared/overlays/controller').then(({ toast }) => toast(text, 'info', 'error'));
}

function loadForWrite(): AuditEntry[] | null {
  try { return readAudit(); } catch (e) {
    if (!(e instanceof AuditCorruptError)) throw e;
    try {
      backupAndResetAudit(e.raw);
      notify('audit.corrupt', '操作记录数据已损坏（audit.corrupt），已备份原数据并重建，之前的记录无法显示。', false);
      return [];
    } catch (b) {
      console.warn('audit.backup_failed', b);
      notify('audit.backup_failed', (b as Error).message);
      return null;
    }
  }
}

export function audit(conversation: string, id: string, tool: string, status: string) {
  if (!S.prefs.auditLog) return;
  try {
    const items = loadForWrite();
    if (!items) return;
    const row = { id: `${conversation}:${id}`, at: Date.now(), conversation, tool: tool.slice(0, 100), status: status.slice(0, 40) };
    const prior = items.findIndex(x => x.id === row.id);
    if (prior >= 0 && items[prior].status === row.status && items[prior].tool === row.tool) return;
    if (prior >= 0) items[prior] = row; else items.push(row);
    const dropped = Math.max(0, items.length - AUDIT_LIMIT);
    localStorage.setItem(key(), JSON.stringify(items.slice(-AUDIT_LIMIT)));
    if (dropped) localStorage.setItem(trimmedKey(), String(auditTrimmedCount() + dropped));
    warned.delete('audit.write_failed'); warned.delete('audit.backup_failed');
  } catch (e) {
    console.warn('audit.write_failed', e);
    notify('audit.write_failed', '操作记录保存失败，请检查本机存储空间（audit.write_failed）');
  }
}
export function clearAudit() { localStorage.removeItem(key()); localStorage.removeItem(trimmedKey()); }
