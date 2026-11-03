import { invoke, isTauri } from '@tauri-apps/api/core';
import { base64 } from '@/features/phones/runtime/phoneFiles';
import { refreshPhoneChat } from '@/features/phones/runtime/phoneChat';
import type { Conv, Msg } from '@/state/types';
import { openTask } from './tasks';

/* TEAM-MENU-01：会话 / 团队导出为 Markdown。
 * 生成文字是纯函数；保存在桌面外壳里走系统保存框（取消不算导出成功），浏览器预览走下载。 */

/** 一段对话的 Markdown 行。speaker 是回复方的称呼（团队导出时用成员名），团队成员消息用发送者自己的名字。 */
export function messageLines(messages: Msg[], speaker = '总指挥'): string[] {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.type === 'user') lines.push(`**我**：${m.text ?? ''}`, '');
    else if (m.type === 'assistant') lines.push(`**${speaker}**：${m.text ?? ''}`, '');
    else if (m.type === 'teammate') lines.push(`**${m.agent || '团队成员'}**：${m.text ?? ''}`, '');
    else if (m.type === 'tool') lines.push(`> ${m.tool} · ${m.detail ?? ''}`, '');
  }
  return lines;
}

export const conversationMarkdown = (c: Conv, speaker?: string) => [`# ${c.title}`, '', ...messageLines(c.messages, speaker)].join('\n');

/** 文件名里不能出现路径分隔符和系统保留字符；外壳只取最后一段作为建议文件名。 */
export const markdownFileName = (title: string) => `${title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || '导出记录'}.md`;

/** 导出前读完整记录：电脑任务从核心读取，手机会话完整同步一次。读取失败直接抛出，不导出半截记录。 */
export async function loadFullHistory(c: Conv) {
  if (c.phoneSession) await refreshPhoneChat(c, true);
  else if (c.remote) await openTask(c.id, { throwOnError: true, refreshWorkspace: false });
}

const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)), b => b.toString(16).padStart(2, '0')).join('');

/** 保存 Markdown。返回 true 才表示已保存；用户在系统保存框里取消返回 false；写入失败抛出。
 *  浏览器预览没有保存框：触发下载即返回 true，下一拍再回收临时地址（立即回收会让下载拿不到内容）。 */
export async function saveMarkdown(name: string, text: string): Promise<boolean> {
  const bytes = new TextEncoder().encode(text);
  if (isTauri()) return invoke<boolean>('local_file_save', { name, data: base64(bytes), sha256: await sha256(bytes) });
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
