import { getCurrentWindow } from '@tauri-apps/api/window';
import type { MouseEvent } from 'react';
import { toastError } from '@/shared/overlays/controller';
import { isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { prompt } from '@/shared/overlays/controller';

/* ===== 系统能力：选择文件夹 / 文件。桌面外壳里用系统对话框，浏览器开发模式下手动输入路径 ===== */

export const inShell = () => isTauri();

/** 桌面外壳运行在 Windows 上（原生标题栏已隐藏，需要应用绘制窗口按钮）。 */
export const isWindowsShell = () => inShell() && /Windows/i.test(navigator.userAgent);

export function pickFolder(): Promise<string | null> {
  if (inShell()) return open({ directory: true, multiple: false }).then(p => (typeof p === 'string' ? p : null));
  return new Promise(resolve => {
    prompt({ title: '选择工作文件夹', label: '文件夹的完整路径', placeholder: '/Users/你/Projects/新项目', okText: '使用这个文件夹', onOk: v => resolve(v || null) });
  });
}

export function pickFiles(images = false): Promise<string[]> {
  if (inShell()) {
    return open({ multiple: true, directory: false, ...(images ? { filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] } : {}) })
      .then(p => (Array.isArray(p) ? p : typeof p === 'string' ? [p] : []));
  }
  return new Promise(resolve => {
    prompt({ title: images ? '添加图片' : '上传文件', label: '文件的完整路径', placeholder: '/Users/你/Desktop/需求说明.pdf', okText: '添加', onOk: v => resolve(v ? [v] : []) });
  });
}

export function dragWindow(e: MouseEvent<HTMLElement>) {
  if (!inShell() || e.button !== 0 || (e.target as Element).closest('button,input,textarea,select,a,[role="button"]')) return;
  e.preventDefault();
  const win = getCurrentWindow();
  // 双击标题栏等同于系统标题栏的双击：最大化 / 还原
  if (e.detail >= 2) {
    void win.toggleMaximize().catch(error => toastError('切换窗口大小失败', error));
    return;
  }
  void win.startDragging().catch(error => toastError('拖动窗口失败', error));
}
