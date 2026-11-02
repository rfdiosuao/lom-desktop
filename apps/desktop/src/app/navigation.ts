import { watchPhone } from '@/features/phones/runtime/phoneChat';
import { openTask } from '@/features/chat/runtime/tasks';
import { loadConvOptions } from '@/features/settings/runtime/agentOptions';
import { activeFolder, refreshWorkspace } from '@/features/workspace/runtime/workspace';
import { conv, team } from '@/state/selectors';
import type { AppState, NavSnap, Route } from '@/state/state';
import { S, update } from '@/state/store';
import type { Mode } from '@/state/types';

/* ===== 导航与前进后退 ===== */

const snap = (): NavSnap => ({ mode: S.mode, route: { ...S.route }, activeConv: S.activeConv, phoneId: S.phoneId, agentPick: S.agentPick });

export function navigate(patch: Partial<AppState>, push = true) {
  const folderBefore = S.route.name === 'chat' ? S.activeConv : null, rootBefore = activeFolder();
  update(s => {
    if (push) { s.back.push(snap()); if (s.back.length > 50) s.back.shift(); s.fwd = []; }
    Object.assign(s, patch);
    const opened = s.route.name === 'chat' ? s.convs.find(c => c.id === s.activeConv) : undefined;
    if (opened?.owner === 'pc' && !opened.teamId && !opened.sideOf) s.agentPick = opened.agentId || '';
    s.menu = null;
    s.openFile = null; s.workspaceBrowseRoot = '';
  });
  const c = S.route.name === 'chat' ? conv(S.activeConv) : undefined;
  if (c?.phoneSession) void watchPhone(c);
  else if (c?.remote) { void openTask(c.id); if (c.agentId && !S.agentOptions[c.id]) void loadConvOptions(c); }
  // 进出团队页时文件夹也会换（团队共享文件夹），文件面板要跟着刷新
  else if (folderBefore !== (S.route.name === 'chat' ? S.activeConv : null) || activeFolder() !== rootBefore) void refreshWorkspace();
}

export function go(route: string, id?: string) {
  if (route === 'settings') return navigate({ route: { name: 'settings' } });
  if (route.startsWith('phone-')) return navigate({ mode: 'phone', route: { name: route } });
  if (['schedule', 'skillhub', 'teams', 'team'].includes(route)) {
    return navigate({ route: { name: route, id }, mode: 'desktop', ...(route === 'team' ? { teamFocus: team(id)?.members[0]?.mid ?? S.teamFocus } : {}) });
  }
  navigate({ route: { name: route, id } as Route });
}

export function goBack() {
  if (!S.back.length) return;
  const prev = S.back[S.back.length - 1];
  update(s => { s.fwd.push(snap()); s.back.pop(); });
  navigate(prev, false);
}
export function goFwd() {
  if (!S.fwd.length) return;
  const next = S.fwd[S.fwd.length - 1];
  update(s => { s.back.push(snap()); s.fwd.pop(); });
  navigate(next, false);
}

export const openSettings = (page = 'connections') => { S.settingsPage = page; navigate({ route: { name: 'settings' } }); };

export const newTask = () => { S.focusNext = 'composer:home'; navigate({ route: { name: 'home' }, activeConv: null }); };

export function setMode(mode: Mode) {
  if (mode === S.mode && S.route.name === 'home') return;
  S.focusNext = 'composer:home';
  navigate({ mode, route: { name: 'home' }, activeConv: null, wsTab: mode === 'phone' ? 'phone' : 'preview' });
}

export const enterPhone = (id: string) => {
  S.focusNext = 'composer:home';
  navigate({ mode: 'phone', phoneId: id, route: { name: 'home' }, activeConv: null, wsTab: 'phone' });
};

export function pickPhone(id: string) {
  const c = conv(S.activeConv);
  S.phoneId = id;
  if (S.route.name === 'chat' && c && c.owner !== 'pc' && c.owner !== id) return navigate({ route: { name: 'home' }, activeConv: null });
  update(s => { s.menu = null; });
}

export function openConv(id: string) {
  const c = conv(id);
  if (!c) return;
  navigate({
    mode: c.owner === 'pc' ? 'desktop' : 'phone', phoneId: c.owner === 'pc' ? S.phoneId : c.owner, route: { name: 'chat' }, activeConv: c.id,
    ...(c.owner !== 'pc' ? { wsTab: 'phone' as const } : c.preview ? { wsTab: 'preview' as const } : {}),
  });
}

export const gotoPhonePage = (id: string, route: string) => { S.modals = []; navigate({ mode: 'phone', phoneId: id, route: { name: route } }); };
