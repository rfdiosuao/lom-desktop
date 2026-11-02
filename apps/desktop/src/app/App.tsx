import { cloudConfigured } from '@/features/account/runtime/serviceConfig';
import { PersonalFloating } from '@/features/personal/ui/PersonalFloating';
import { startUpdateChecks } from '@/features/updates/runtime/updater';
import { UpdateBanner } from '@/features/updates/ui/Updates';
import { syncStartupPreference } from '@/features/settings/runtime/preferences';
import { useEffect } from 'react';
import { stopRun, runKeyOf } from '@/features/chat/actions/composer';
import { applyTheme, toggleLeft, toggleRight } from './shell/layout';
import { go, newTask } from './navigation';
import { closeMenu, closeModal, openPalette, topModal } from '@/shared/overlays/controller';
import { shortcuts } from '@/features/settings/actions/settings';
import { Btn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { startCore } from './bootstrap';
import { inShell, isWindowsShell } from '@/core/platform';
import { WindowControls } from './shell/WindowControls';
import { MenuHost } from './overlays/MenuHost';
import { ModalHost } from './overlays/ModalHost';
import { SideChat } from '@/features/chat/ui/SideChat';
import { paletteItems, runPaletteItem } from './overlays/PaletteModal';
import { Toast } from '@/shared/ui/Toast';
import { S, update, useStore } from '@/state/store';
import { restoreSession } from '@/features/account/runtime/cloud';
import { Login } from '@/features/account/ui/Login';
import { Shell } from './shell/Shell';
import { useCloudInbox } from '@/features/account/ui/Notices';

/* ===== 应用根：外壳 + 弹层 + 全局快捷键 ===== */

function onKeyDown(e: KeyboardEvent) {
  if (cloudConfigured() && S.cloud !== 'signed-in') return;
  const mod = e.metaKey || e.ctrlKey;
  /* 命令面板内的方向键与回车 */
  if (topModal()?.id === 'palette') {
    const n = Math.min(paletteItems().length, 40);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); update(s => { s.paletteIdx = ((s.paletteIdx || 0) + (e.key === 'ArrowDown' ? 1 : -1) + n) % Math.max(n, 1); }); return; }
    if (e.key === 'Enter') { e.preventDefault(); runPaletteItem(S.paletteIdx || 0); return; }
  }
  if (e.key === 'Escape') {
    if (S.menu) { closeMenu(); return; }
    if (S.modals.length) { closeModal(); return; }
    const key = S.route.name === 'chat' ? S.activeConv : null;
    if (key && S.running[runKeyOf(key)]) { stopRun(key); return; }
  }
  /* 弹窗里的输入框回车：执行主按钮 */
  const t = e.target as HTMLElement | null;
  if (e.key === 'Enter' && S.modals.length && t?.matches?.('input') && !e.isComposing) {
    const primary = [...document.querySelectorAll('.modal')].pop()?.querySelector<HTMLButtonElement>('.modal__foot .btn--primary:not(:disabled)');
    if (primary) { e.preventDefault(); primary.click(); }
    return;
  }
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 'k') { e.preventDefault(); openPalette(); }
  else if (k === 'n') { e.preventDefault(); newTask(); }
  else if (k === 'b' && e.altKey) { e.preventDefault(); toggleRight(); }
  else if (k === 'b') { e.preventDefault(); toggleLeft(); }
  else if (k === '/') { e.preventDefault(); shortcuts(); }
  else if (k === ',') { e.preventDefault(); go('settings'); }
}

function ConnBanner() {
  const s = useStore();
  if (s.conn !== 'offline') return null;
  return (
    <div className="conn-banner" role="status">
      <Icon name="wifiOff" />
      <span>核心服务未连接{s.connError ? `：${s.connError}` : ''}</span>
      <Btn label="重试" variant="link" size="sm" onClick={() => void startCore()} />
    </div>
  );
}

export function App() {
  const s = useStore();
  useCloudInbox();
  useEffect(() => {
    if (s.personalPanel && (s.cloud !== 'signed-in' || s.personalPanel.account !== s.account?.id)) update(st => { st.personalPanel = null; });
  }, [s.cloud, s.account?.id]);
  useEffect(startUpdateChecks, []);
  useEffect(() => { document.documentElement.lang = s.prefs.lang === 'English' ? 'en' : 'zh-Hans'; }, [s.prefs.lang]);
  useEffect(() => {
    if (inShell()) document.documentElement.classList.add('in-shell');
    if (isWindowsShell()) document.documentElement.classList.add('is-windows');
    applyTheme();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', applyTheme);
    document.addEventListener('keydown', onKeyDown);
    void syncStartupPreference().catch(e => console.warn('startup.preference_unreadable', e));
    void startCore();
    void restoreSession();
    return () => { mq.removeEventListener('change', applyTheme); document.removeEventListener('keydown', onKeyDown); };
  }, []);
  if (cloudConfigured() && s.cloud !== 'signed-in') return <><Login />{isWindowsShell() && <WindowControls />}<ModalHost /><UpdateBanner /><Toast /></>;
  return (
    <>
      <div inert={s.modals.length > 0 ? true : undefined} style={{ height: '100%' }}><Shell /></div>
      {isWindowsShell() && <WindowControls />}
      <SideChat />
      <PersonalFloating />
      <ModalHost />
      <MenuHost />
      <Toast />
      <ConnBanner />
      <UpdateBanner />
    </>
  );
}
