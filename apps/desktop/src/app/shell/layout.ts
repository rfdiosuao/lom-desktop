import { refreshWorkspace } from '@/features/workspace/runtime/workspace';
import { S, update } from '@/state/store';
import { toast } from '@/shared/overlays/controller';

/* ===== 布局：三栏收起 / 展开、主题、工作区标签 ===== */

export const toggleLeft = () => update(s => { s.layout.leftCollapsed = !s.layout.leftCollapsed; });
export const toggleRight = () => update(s => { s.layout.rightCollapsed = !s.layout.rightCollapsed; });
export const resetLayout = () => { update(s => { s.layout = { left: 276, right: 380, leftCollapsed: false, rightCollapsed: false }; }); toast('面板布局已恢复默认'); };
export const showRight = () => { if (S.layout.rightCollapsed) S.layout.rightCollapsed = false; };

export const applyTheme = () => {
  const t = S.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
};
export const setTheme = (v: 'light' | 'dark' | 'system') => { update(s => { s.theme = v; }); applyTheme(); };

export const wsTab = (v: 'preview' | 'files' | 'plan' | 'changes' | 'phone') => {
  update(s => { showRight(); s.wsTab = v; });
  if (v !== 'phone') void refreshWorkspace();
};

export const watchPhone = (id: string) => update(s => { showRight(); s.phoneId = id; s.wsTab = 'phone'; s.live = true; });

export const toggleLive = () => {
  update(s => { s.live = !s.live; });
  toast(S.live ? '已显示示例画面，实时传输尚未接入' : '已隐藏示例画面', 'info');
};
