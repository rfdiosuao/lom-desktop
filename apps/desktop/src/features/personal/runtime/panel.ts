import { cloudConfigured, CLOUD_UNAVAILABLE } from '@/features/account/runtime/serviceConfig';
import { toast } from '@/shared/overlays/controller';
import { S, update } from '@/state/store';
export interface PanelRect { x: number; y: number; w: number; h: number }
const key = (account: string) => `lom.personal.panel:${account}`;
export function fitPanel(r: PanelRect): PanelRect {
  const w = Math.max(1, Math.min(r.w, innerWidth - 32)), h = Math.max(1, Math.min(r.h, innerHeight - 32));
  return { w, h, x: Math.max(16, Math.min(r.x, innerWidth - w - 16)), y: Math.max(16, Math.min(r.y, innerHeight - h - 16)) };
}
export function openPersonalPanel() {
  if (!cloudConfigured()) { toast(CLOUD_UNAVAILABLE, 'info'); return; }
  if (S.cloud !== 'signed-in' || !S.account) return;
  let rect = S.personalPanel?.account === S.account.id ? S.personalPanel.rect : undefined;
  try { rect ??= JSON.parse(localStorage.getItem(key(S.account.id)) || 'null') || undefined; } catch { /* use the visible default */ }
  if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) rect = { x: (innerWidth - 1060) / 2, y: (innerHeight - 760) / 2, w: 1060, h: 760 };
  update(s => { s.personalPanel = { account: S.account!.id, minimized: false, rect: fitPanel(rect!) }; });
}
export function savePanelRect(rect: PanelRect) {
  const p = S.personalPanel; if (!p || p.account !== S.account?.id || S.cloud !== 'signed-in') return;
  const next = fitPanel(rect);
  try { localStorage.setItem(key(p.account), JSON.stringify(next)); } catch { /* in-memory geometry remains usable */ }
  update(s => { if (s.personalPanel === p) p.rect = next; });
}
export const closePersonalPanel = () => update(s => { s.personalPanel = null; });
export const minimizePersonalPanel = () => update(s => { if (s.personalPanel) s.personalPanel.minimized = true; });
