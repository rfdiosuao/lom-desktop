import { useState } from 'react';
import { useStore } from '@/state/store';
import { loadAssistants, type PersonalAssistant } from '../runtime/catalog';
import { permissionLabels, permissionTier, requestPermissionTier, type PermissionTier } from '../runtime/permissions';
import { friendlyError } from '@/shared/lib/friendlyError';
export function PersonalPermissions({ assistant }: { assistant: PersonalAssistant }) {
  const s = useStore(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  let a = assistant;
  try { a = loadAssistants().items.find(x => x.id === assistant.id) ?? assistant; }
  catch { /* Show safe display only; the mutation validates account ownership again. */ }
  const change = async (tier: PermissionTier) => {
    setBusy(true); setError('');
    try { await requestPermissionTier(a, tier); }
    catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };
  return <section className="pa-section"><h2>助理权限</h2>
    <select className="pa-permission-select" aria-label="助理权限档位" value={a.permissionPending ?? permissionTier(a)} disabled={busy || s.cloud !== 'signed-in'} onChange={e => void change(e.target.value as PermissionTier)}>
      {(Object.keys(permissionLabels) as PermissionTier[]).map(tier => <option key={tier} value={tier}>{permissionLabels[tier]}</option>)}
    </select>
    {a.permissionPending && <p role="status">本轮结束后生效；当前：{permissionLabels[permissionTier(a)]}</p>}
    <p className="pa-muted">{permissionTier(a) === 'full' ? '完全访问已开启：此助理不再逐项询问 Lom 操作权限。系统权限和第三方首次登录仍需完成。' : '常用操作自动允许只读操作；文件写入、执行命令仍需询问。切换完全访问后直接执行，无需逐项确认。'}</p>
    {(error || a.permissionError) && <p className="pa-error" role="alert">{error || a.permissionError}</p>}
  </section>;
}
