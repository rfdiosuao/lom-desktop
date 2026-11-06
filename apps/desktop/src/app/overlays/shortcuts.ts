import { isMacPlatform, shortcutKeys } from '@/core/platform';

/* ===== 快捷键说明的唯一数据源：快捷键弹窗和设置页都从这里取，按平台显示 ⌘/⌥ 或 Ctrl/Alt ===== */

/** 弹窗里的逐行说明：[按键（空格分隔，每个键一个标签）, 作用] */
export function shortcutRows(): [string, string][] {
  const { mod, alt } = shortcutKeys();
  return [[`${mod} K`, '搜索 / 命令面板'], [`${mod} N`, '新的任务'], [`${mod} B`, '收起 / 展开侧栏'], [`${mod} ${alt} B`, '收起 / 展开工作区'], ['Enter', '发送'], ['Shift Enter', '换行'], ['Esc', '停止 / 关闭弹窗'], ['@', '提及手机或文件'], ['/', '快捷命令']];
}

/** 设置页「快捷键」行的一句话摘要：macOS 紧贴写法（⌘K），其他平台用空格分开（Ctrl K） */
export function shortcutSummary(): string {
  const { mod, alt } = shortcutKeys();
  const sep = isMacPlatform() ? '' : ' ';
  return `${mod}${sep}K 搜索 · ${mod}${sep}N 新任务 · ${mod}${sep}B 侧栏 · ${mod}${sep}${alt}${sep}B 工作区`;
}
