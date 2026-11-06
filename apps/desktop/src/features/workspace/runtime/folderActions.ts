import { toast, toastError } from '@/shared/overlays/controller';
import { openFolderInSystem } from './workspace';

/* WS-ENTRY-01：顶栏与文件页共用的「工作文件夹」动作。打开的是文件夹本身，不是在父目录里选中它 */

export function openWorkspaceFolder(dir: string) {
  if (!dir) return Promise.resolve();
  return openFolderInSystem(dir).catch(e => toastError('打开工作区失败', e));
}

export async function copyWorkspacePath(dir: string) {
  if (!dir) return;
  try {
    if (!navigator.clipboard) throw new Error('当前环境不支持复制到剪贴板');
    await navigator.clipboard.writeText(dir);
    toast('已复制路径');
  } catch (e) {
    toastError('复制路径失败', e);
  }
}
