import type { ReactNode } from 'react';
import { S, update } from '@/state/store';
import type { MenuCtx } from '@/state/types';
import { friendlyError } from '@/shared/lib/friendlyError';

/* ===== 弹层：下拉菜单、弹窗栈、轻提示 ===== */

/** 打开菜单的元素：点它时由它自己切换开关，点其他地方才关闭菜单 */
let menuAnchor: Element | null = null;
export const getMenuAnchor = () => menuAnchor;

export const openMenu = (id: string, anchor: Element, ctx: MenuCtx = {}) => {
  const r = anchor.getBoundingClientRect();
  const key = ctx.key || id;
  if (S.menu && S.menu.id === id && S.menu.key === key) return closeMenu();
  menuAnchor = anchor;
  update(s => { s.menu = { id, ctx, key, rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width } }; });
};

export const closeMenu = () => { menuAnchor = null; if (S.menu) update(s => { s.menu = null; }); };

export const openModal = (id: string, props: Record<string, unknown> = {}) => {
  update(s => { s.menu = null; s.modals.push({ id, props }); });
};
/** 弹窗关闭前的检查（例如有没保存的草稿）：返回 false 表示先别关，由它自己处理（比如先问一句） */
const closeGuards = new Map<string, () => boolean>();
export const guardClose = (type: string, check: (() => boolean) | null) => { if (check) closeGuards.set(type, check); else closeGuards.delete(type); };
/** 关闭最上层弹窗；force === true 时跳过关闭检查（用户已确认放弃） */
export const closeModal = (force?: unknown) => {
  const top = S.modals[S.modals.length - 1];
  if (force !== true && top && closeGuards.get(top.id)?.() === false) return;
  update(s => { s.modals.pop(); });
};
export const topModal = () => S.modals[S.modals.length - 1];

export const confirm = (p: { title: string; desc?: string; okText?: string; danger?: boolean; onOk: () => void }) =>
  openModal('confirm', { okText: '确定', ...p });

export const prompt = (p: { title: string; label: string; value?: string; placeholder?: string; okText?: string; extra?: ReactNode; onOk: (v: string) => void }) => {
  S.form = { value: p.value ?? '' };
  openModal('prompt', { okText: '保存', ...p });
};

let toastTimer = 0;
export const toast = (text: string, icon = 'check', tone: 'ok' | 'info' | 'error' = icon === 'info' ? 'info' : 'ok') => {
  window.clearTimeout(toastTimer);
  update(s => { s.toast = { text, icon, tone, key: Date.now() }; });
  // 报错多停一会儿，来得及读完
  toastTimer = window.setTimeout(() => update(s => { s.toast = null; }), tone === 'error' ? 4500 : 2600);
};

/** D37：把错误显示给用户。代码里写好的中文原样显示；英文和技术细节换成通用说法，原文只留在控制台 */
export const toastError = (prefix: string, e: unknown) => {
  console.error(prefix, e);
  toast(`${prefix}：${friendlyError(e)}`, 'info', 'error');
};

/** D37：后台自动同步（启动、重连、定时刷新）出错不弹给用户——它们会自己重试，只记日志 */
export const quietError = (scope: string, e: unknown) => { console.warn(scope, e); };

/** ⌘K 命令面板 */
export const openPalette = () => { S.q.palette = ''; S.paletteIdx = 0; openModal('palette'); };
