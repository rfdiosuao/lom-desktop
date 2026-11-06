import { invoke, isTauri } from '@tauri-apps/api/core';
import { readJson, writeJson } from '@/features/account/runtime/localCache';

/** 验证方式：system 沿用本机 SSH 配置与 ssh-agent；旧记录没有该字段，按 system 处理。 */
export type SshAuth = 'password' | 'key' | 'system';
export interface SshServer { id: string; name: string; destination: string; port: number | null; auth?: SshAuth; group?: string; note?: string }
/** 表单里尚未保存的凭据；只经 invoke 交给原生外壳，不进入任何持久化状态。 */
export interface SshDraft { secret: string; passphrase?: string }
export const GROUP_MAX = 30;
export const NOTE_MAX = 50;
const key = (account: string) => `lom.ssh-servers.v1:${account}`;
export const isSshDestination = (destination: string) => destination.length <= 255
  && /^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?(?:[A-Za-z0-9_][A-Za-z0-9_.-]*|[A-Fa-f0-9]*:[A-Fa-f0-9:.]+)$/.test(destination);
const optionalText = (value: unknown, max: number) => value === undefined || (typeof value === 'string' && value.length <= max);
export const isSshServer = (value: unknown): value is SshServer => {
  if (!value || typeof value !== 'object') return false;
  const { id, name, destination, port, auth, group, note } = value as SshServer;
  return typeof id === 'string' && !!id && typeof name === 'string' && !!name.trim() && name.length <= 80
    && typeof destination === 'string' && isSshDestination(destination)
    && (port === null || (Number.isInteger(port) && port >= 1 && port <= 65535))
    && (auth === undefined || auth === 'password' || auth === 'key' || auth === 'system')
    && optionalText(group, GROUP_MAX) && optionalText(note, NOTE_MAX);
};
const valid = isSshServer;

export const sshErrorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function loadSshServers(account: string) {
  const data = readJson(key(account), rows => Array.isArray(rows) && rows.length <= 50 && rows.every(valid) ? rows as SshServer[] : undefined);
  if (data.status === 'ok') return data.value;
  if (data.status === 'missing') return [];
  throw new Error('服务器列表无法读取，原记录已保留。');
}

export function saveSshServers(account: string, rows: SshServer[]) {
  if (rows.length > 50 || !rows.every(valid)) throw new Error('请填写名称、有效的 SSH 别名或 user@主机，以及 1–65535 的端口。最多保存 50 台。');
  loadSshServers(account);
  if (writeJson(key(account), rows) !== 'ok') throw new Error('服务器列表保存失败，请检查本机存储。');
}

/** draft 为表单里刚填的凭据（用于保存前的测试连接）；省略时由原生外壳读取这台机器已保存的凭据。 */
export async function probeSshServer(row: SshServer, status: boolean, draft?: SshDraft) {
  if (!valid(row)) throw new Error('服务器配置无效。');
  if (!isTauri()) throw new Error('请在 Lom 桌面应用中使用 SSH。');
  return invoke<string>('ssh_server_probe', { destination: row.destination, port: row.port, status, id: row.id, auth: row.auth ?? null, draft: draft ?? null });
}

export interface SshExecResult { exit_code: number; stdout: string; stderr: string; truncated: boolean }
/** 在已保存的机器上执行命令；凭据由原生外壳按机器 id 从系统钥匙串读取。 */
export async function execSshServer(row: SshServer, command: string, timeoutSeconds?: number) {
  if (!valid(row)) throw new Error('服务器配置无效。');
  if (!isTauri()) throw new Error('请在 Lom 桌面应用中使用 SSH。');
  return invoke<SshExecResult>('ssh_server_exec', { destination: row.destination, port: row.port, id: row.id, auth: row.auth ?? null, command, timeoutSeconds: timeoutSeconds ?? null });
}

export const storeSshSecret = (id: string, auth: SshAuth, draft: SshDraft) => invoke<void>('ssh_secret_store', { id, auth, draft });
export const removeSshIdentity = (id: string) => invoke<void>('ssh_identity_remove', { id });
/** 保存的列表里出现过的分组，按首次出现的顺序去重。 */
export const sshGroups = (rows: SshServer[]) => [...new Set(rows.map(row => row.group).filter((group): group is string => !!group))];

type Check = { checkedAt: number; elapsed: number; ok: boolean; detail: string; target: string };
const checkKey = (account: string, id: string) => `${key(account)}:check:${id}`;
const targetOf = (row: SshServer) => JSON.stringify(row.auth ? [row.destination, row.port, row.auth] : [row.destination, row.port]);

export function readSshCheck(account: string, row: SshServer) {
  const result = readJson(checkKey(account, row.id), value => {
    if (!value || typeof value !== 'object') return;
    const check = value as Check;
    if (check.target === targetOf(row) && Number.isFinite(check.checkedAt) && Number.isFinite(check.elapsed)
      && typeof check.ok === 'boolean' && typeof check.detail === 'string') return check;
  });
  return result.status === 'ok' ? result.value : undefined;
}

export function clearSshCheck(account: string, id: string) {
  return writeJson(checkKey(account, id), null);
}

export async function checkSshServer(account: string, row: SshServer, status: boolean, current = () => true) {
  const started = performance.now();
  let ok = true;
  let detail: string;
  try {
    const output = await probeSshServer(row, status);
    detail = status ? output.trim() || '服务器没有返回状态。' : 'SSH 连接成功。';
  } catch (error) {
    ok = false;
    detail = sshErrorText(error);
  }
  const check = { ok, detail, checkedAt: Date.now(), elapsed: Math.round(performance.now() - started), target: targetOf(row) };
  const stillSaved = current() && loadSshServers(account).some(saved => saved.id === row.id && targetOf(saved) === check.target);
  const saved = stillSaved && writeJson(checkKey(account, row.id), { ...check, detail: ok ? '' : detail }) === 'ok';
  return { ...check, saved };
}
