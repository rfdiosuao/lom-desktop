import { invoke } from '@tauri-apps/api/core';
import { api, getEndpoint } from '@/core/client';
import { S } from '@/state/store';

/* ===== Lom 的记忆（电脑任务）=====
 * Lom 的引擎（aionrs）自带按工作文件夹分开的记忆：<配置目录>/projects/<文件夹名>/memory/，MEMORY.md 是索引，
 * 每条记忆一个 .md 文件。每次开任务都会读（aionrs aion-memory/src/paths.rs auto_memory_dir）。
 * 文件夹名的规则照搬它的 sanitize_path：每个不是 ASCII 字母数字的字符换成 -，超过 200 个字符时它会加哈希，这里不支持。 */

const MAX_SANITIZED = 200;
const isMissing = (e: unknown) => !!e && typeof e === 'object' && ('status' in e && e.status === 404 || 'code' in e && ['NOT_FOUND', 'FILE_NOT_FOUND', 'HTTP_404'].includes(String(e.code)));

export function memoryDir(workspace: string): string | null {
  const home = S.homeDir || getEndpoint()?.homeDir || '';
  if (!home || !workspace) return null;
  const name = Array.from(workspace).map(ch => (/^[A-Za-z0-9]$/.test(ch) ? ch : '-')).join('');
  if (name.length > MAX_SANITIZED) return null;
  // macOS：dirs::config_dir() = ~/Library/Application Support（aion-config app_config_dir）
  return `${home}/Library/Application Support/aionrs/projects/${name}/memory`;
}

export interface MemoryFile { name: string; path: string }

export async function listMemory(dir: string, workspace: string): Promise<MemoryFile[]> {
  const prepared = await invoke<string>('prepare_memory_directory', { workspace });
  if (prepared !== dir) throw new Error('记忆目录与核心配置不一致');
  try {
    const entries = await api<{ name: string; full_path: string; is_dir: boolean }[]>('POST', '/api/fs/dir', { dir, root: dir });
    return entries.filter(e => !e.is_dir && e.name.endsWith('.md'))
      .sort((a, b) => (a.name === 'MEMORY.md' ? -1 : b.name === 'MEMORY.md' ? 1 : a.name.localeCompare(b.name)))
      .map(e => ({ name: e.name, path: e.full_path }));
  } catch (e) {
    if (isMissing(e)) return [];
    throw e;
  }
}

export const readMemory = (path: string, dir: string) => api<string>('POST', '/api/fs/read', { path, workspace: dir });
export const writeMemory = (path: string, data: string, dir: string) => api('POST', '/api/fs/write', { path, data, workspace: dir });

/** 新增一条记忆：写成单独的文件，并在 MEMORY.md 索引里加一行（Lom 下次开任务就会读到）。
 * 同一个记忆目录的新增排队执行：索引是读出来再整份写回，两条同时写会互相覆盖 */
const indexQueue = new Map<string, Promise<unknown>>();
export function addMemory(dir: string, title: string, body: string, workspace: string): Promise<string> {
  const run = (indexQueue.get(dir) || Promise.resolve()).catch(() => undefined).then(() => addMemoryNow(dir, title, body, workspace));
  indexQueue.set(dir, run);
  void run.finally(() => { if (indexQueue.get(dir) === run) indexQueue.delete(dir); }).catch(() => undefined);
  return run;
}
async function addMemoryNow(dir: string, title: string, body: string, workspace: string) {
  const prepared = await invoke<string>('prepare_memory_directory', { workspace });
  if (prepared !== dir) throw new Error('记忆目录与核心配置不一致，已停止写入');
  const slug = `${Date.now().toString(36)}-${title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 30) || 'note'}.md`;
  const file = `${dir}/${slug}`;
  await writeMemory(file, `---\nname: ${title}\ndescription: ${title}\ntype: user\n---\n\n${body.trim()}\n`, dir);
  const index = await readMemory(`${dir}/MEMORY.md`, dir).catch(e => { if (isMissing(e)) return '# Memory Index\n'; throw e; });
  await writeMemory(`${dir}/MEMORY.md`, `${index.replace(/\s*$/, '')}\n- [${title}](${slug}) — ${body.trim().split('\n')[0].slice(0, 80)}\n`, dir);
  return file;
}
