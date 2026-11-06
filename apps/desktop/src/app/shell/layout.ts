import { refreshPreview, refreshWorkspace, treeIsCurrent } from '@/features/workspace/runtime/workspace';
import { S, update } from '@/state/store';
import { workspaceOptional } from '@/state/selectors';
import { toast } from '@/shared/overlays/controller';

/* ===== 布局：三栏收起 / 展开、主题、工作区标签 ===== */

export const toggleLeft = () => update(s => { s.layout.leftCollapsed = !s.layout.leftCollapsed; });
export const toggleRight = () => update(s => { if (workspaceOptional(s.route.name)) s.layout.rightOnPages = !s.layout.rightOnPages; else s.layout.rightCollapsed = !s.layout.rightCollapsed; });
export const resetLayout = () => { update(s => { s.layout = { left: 276, right: 520, leftCollapsed: false, rightCollapsed: false }; }); toast('面板布局已恢复默认'); };
export const showRight = () => { if (workspaceOptional()) S.layout.rightOnPages = true; else if (S.layout.rightCollapsed) S.layout.rightCollapsed = false; };

export const applyTheme = () => {
  const t = S.theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
};
export const setTheme = (v: 'light' | 'dark' | 'system') => { update(s => { s.theme = v; }); applyTheme(); };

export const wsTab = (v: 'preview' | 'files' | 'plan' | 'changes' | 'phone') => {
  update(s => { showRight(); s.wsTab = v; });
  // 文件树已经是当前工作目录的，就不重扫；预览页仍然刷新预览（WS-TREE-01 #408）
  if (v === 'phone') return;
  if (!treeIsCurrent()) void refreshWorkspace(); else if (v === 'preview') void refreshPreview();
};

export const watchPhone = (id: string) => update(s => { showRight(); s.phoneId = id; s.wsTab = 'phone'; s.live = true; });

export const toggleLive = () => {
  update(s => { s.live = !s.live; });
  toast(S.live ? '已显示示例画面，实时传输尚未接入' : '已隐藏示例画面', 'info');
};
