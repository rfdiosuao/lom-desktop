import { useState } from 'react';
import { t, tf } from '@/shared/i18n/index';
import { AUDIT_LIMIT, AuditCorruptError, auditTrimmedCount, backupAndResetAudit, clearAudit, readAudit, type AuditEntry } from '../runtime/audit';
import { confirm, toastError } from '@/shared/overlays/controller';
import { Btn } from '@/shared/ui/Button';
import { IconTile, ListRow } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';

/** 操作审计日志：数据在本机浏览器存储里；损坏时给出错误码，并提供备份并重建 */
export function AuditModal() {
  const [version, refresh] = useState(0);
  let entries: AuditEntry[] = [], error: unknown = null;
  try { entries = readAudit().reverse(); } catch (e) { error = e; }
  const trimmed = auditTrimmedCount();
  const rebuild = (raw: string) => { try { backupAndResetAudit(raw); } catch (e) { toastError(t('重建失败'), e); } refresh(version + 1); };
  return <Modal title="操作审计日志" size="lg"
    desc={tf('当前账号在本机收到的工具记录，保存在本机浏览器存储（localStorage），清除网站数据会丢失；最多保留最近 {limit} 条，超出后删除最早的。只记录工具类型、时间和结果；完整内容请查看原会话。不是防篡改审计。', { limit: AUDIT_LIMIT })}
    foot={<><Btn label="刷新" onClick={() => refresh(version + 1)} /><Btn label="清空记录" variant="danger-ghost" onClick={() => confirm({ title: t('清空本机操作记录？'), onOk: () => { clearAudit(); refresh(version + 1); } })} /></>}>
    {trimmed > 0 && !error && <p className="muted">{tf('因超出 {limit} 条上限，已删除最早的 {n} 条记录。', { limit: AUDIT_LIMIT, n: trimmed })}</p>}
    {error
      ? <div role="alert"><p>{error instanceof Error ? error.message : String(error)}</p>
        {error instanceof AuditCorruptError && <><p className="muted">{t('可以备份损坏的原数据并重新开始记录，原数据保存在同一浏览器存储的备份项里。')}</p><Btn label="备份并重建" variant="secondary" onClick={() => rebuild((error as AuditCorruptError).raw)} /></>}</div>
      : <div className="list">{entries.length ? entries.map(row => <ListRow key={row.id} lead={<IconTile ic="terminal" />} title={row.tool} sub={`${new Date(row.at).toLocaleString()} · ${row.status}`} meta={row.conversation} />) : <p className="muted">{t('暂无操作记录。开启记录后，新的工具调用会显示在这里。')}</p>}</div>}
  </Modal>;
}
