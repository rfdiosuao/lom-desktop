import { invoke, isTauri } from '@tauri-apps/api/core';
export interface Document { name: string; kind: 'text' | 'image'; content: string }
export const MAX_BYTES = 5 * 1024 * 1024;
export function textDocument(name: string, content: string): Document {
  if (new TextEncoder().encode(content).length > MAX_BYTES) throw new Error('文件超过 5 MB 限制');
  return { name, kind: 'text', content };
}
export async function openDocument(): Promise<Document | null> {
  if (!isTauri()) throw new Error('系统文件对话框需要运行桌面版；网页模式可以直接编辑示例');
  return invoke<Document | null>('open_document');
}
export async function saveDocument(content: string): Promise<boolean> {
  textDocument('document.md', content);
  if (!isTauri()) {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'document.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); return true;
  }
  return invoke<boolean>('save_document', { content });
}
