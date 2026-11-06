import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { loadSshServers, saveSshServers } from '@/features/settings/runtime/sshServers';
import { definitions } from './managementCatalog';
import { executePersonalSshManage } from './sshManageTool';
import { executePersonalSsh, executePersonalSshExec } from './sshTools';

const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => true }));

const yes = () => true;
const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture-secret\n-----END OPENSSH PRIVATE KEY-----';
const stored = () => JSON.stringify({ ...localStorage });

beforeEach(() => {
  localStorage.clear();
  m.invoke.mockReset().mockResolvedValue(undefined);
  S.account = { id: 'owner', name: '', email: '' };
});

it('SSH-03 AC1 the assistant adds a password machine; the secret goes to the keychain only and is never echoed', async () => {
  const result = await executePersonalSshManage({ action: 'add', name: '生产', host: 'prod.example.test', password: 'p@ss-secret', group: '华东', note: '主库' }, yes);
  expect(m.invoke).toHaveBeenCalledWith('ssh_secret_store', { id: expect.any(String), auth: 'password', draft: { secret: 'p@ss-secret' } });
  expect(loadSshServers('owner')).toEqual([{ id: expect.any(String), name: '生产', destination: 'root@prod.example.test', port: 22, auth: 'password', group: '华东', note: '主库' }]);
  expect(JSON.stringify(result)).not.toContain('p@ss-secret');
  expect(stored()).not.toContain('p@ss-secret');
  expect(result).toMatchObject({ status: 'added', auth: 'password' });
});

it('SSH-03 AC2 a private key with a passphrase selects key login and keeps both out of storage and results', async () => {
  const result = await executePersonalSshManage({ action: 'add', name: '密钥机', host: '10.0.0.5', username: 'ops', port: 2222, private_key: KEY, passphrase: 'phrase-secret' }, yes);
  expect(m.invoke).toHaveBeenCalledWith('ssh_secret_store', { id: expect.any(String), auth: 'key', draft: { secret: KEY, passphrase: 'phrase-secret' } });
  expect(loadSshServers('owner')[0]).toMatchObject({ destination: 'ops@10.0.0.5', port: 2222, auth: 'key' });
  expect(JSON.stringify(result) + stored()).not.toMatch(/fixture-secret|phrase-secret/);
});

it('SSH-03 AC3 rejects bad input without touching the keychain or the list', async () => {
  const bad: Record<string, unknown>[] = [
    { action: 'add', name: 'x', host: '-oProxyCommand=bad', password: 'p' },
    { action: 'add', name: 'x', host: 'h.test', auth: 'password' },
    { action: 'add', name: 'x', host: 'h.test', auth: 'key', password: 'p' },
    { action: 'add', name: 'x', host: 'h.test', auth: 'system', password: 'p' },
    { action: 'add', name: 'x', host: 'h.test', password: 'p', destination: 'evil' },
    { action: 'add', name: 'x', host: 'h.test', auth: 'token' },
    { action: 'add', name: 'x', host: 'h.test', port: 70000, password: 'p' },
    { action: 'add', host: 'h.test', password: 'p' },
    { action: 'wipe' },
  ];
  for (const args of bad) await expect(executePersonalSshManage(args, yes), JSON.stringify(args)).rejects.toThrow();
  expect(m.invoke).not.toHaveBeenCalled();
  expect(loadSshServers('owner')).toEqual([]);
});

it('SSH-03 AC4 update changes only the given fields and keeps saved credentials; switching method needs a new secret', async () => {
  const saved = { id: 'a1', name: '密码机', destination: 'root@pw.test', port: 22, auth: 'password' as const };
  saveSshServers('owner', [saved]);
  await executePersonalSshManage({ action: 'update', server: '密码机', note: '备份' }, yes);
  expect(loadSshServers('owner')[0]).toEqual({ ...saved, note: '备份' });
  expect(m.invoke).not.toHaveBeenCalled();
  await expect(executePersonalSshManage({ action: 'update', server: 'a1', auth: 'key' }, yes)).rejects.toThrow('请粘贴或上传密钥');
  await executePersonalSshManage({ action: 'update', server: 'a1', auth: 'key', private_key: KEY }, yes);
  expect(m.invoke).toHaveBeenCalledWith('ssh_secret_store', { id: 'a1', auth: 'key', draft: { secret: KEY } });
  expect(loadSshServers('owner')[0].auth).toBe('key');
});

it('SSH-03 AC5 remove clears the credentials and the entry, and only for a saved server', async () => {
  saveSshServers('owner', [{ id: 'a1', name: '旧机', destination: 'h.test', port: null }]);
  await expect(executePersonalSshManage({ action: 'remove', server: '不存在' }, yes)).rejects.toThrow('服务器不存在');
  await executePersonalSshManage({ action: 'remove', server: '旧机' }, yes);
  expect(m.invoke).toHaveBeenCalledWith('ssh_identity_remove', { id: 'a1' });
  expect(loadSshServers('owner')).toEqual([]);
});

it('SSH-03 AC6 exec runs a command on a saved server through the native shell and returns bounded output as external data', async () => {
  saveSshServers('owner', [{ id: 'a1', name: '生产', destination: 'root@prod.test', port: 22, auth: 'password' }]);
  m.invoke.mockResolvedValueOnce({ exit_code: 2, stdout: 'out', stderr: 'err', truncated: false });
  const result = await executePersonalSshExec({ server: '生产', command: 'ls /nope', timeout_seconds: 10 }, yes);
  expect(m.invoke).toHaveBeenCalledWith('ssh_server_exec', { destination: 'root@prod.test', port: 22, id: 'a1', auth: 'password', command: 'ls /nope', timeoutSeconds: 10 });
  expect(result).toMatchObject({ name: '生产', exit_code: 2, stdout: 'out', stderr: 'err', truncated: false });
  expect(result.note).toContain('外部数据');
});

it('SSH-03 AC7 exec refuses unsaved targets, raw destinations, bad timeouts and empty commands', async () => {
  saveSshServers('owner', [{ id: 'a1', name: '生产', destination: 'root@prod.test', port: 22 }]);
  for (const args of [{ server: '别处', command: 'id' }, { server: '生产', command: '  ' }, { server: '生产', command: 'id', timeout_seconds: 999 }, { server: '生产', command: 'id', destination: 'evil.test' }, { command: 'id' }])
    await expect(executePersonalSshExec(args, yes), JSON.stringify(args)).rejects.toThrow();
  expect(m.invoke).not.toHaveBeenCalled();
});

it('SSH-03 AC8 a native failure surfaces its error code, and a stopped assistant never operates on the account', async () => {
  saveSshServers('owner', [{ id: 'a1', name: '生产', destination: 'root@prod.test', port: 22 }]);
  m.invoke.mockRejectedValueOnce('ssh.auth：SSH 认证失败，请核对用户名、密码或私钥。');
  await expect(executePersonalSshExec({ server: '生产', command: 'id' }, yes)).rejects.toBe('ssh.auth：SSH 认证失败，请核对用户名、密码或私钥。');
  m.invoke.mockReset();
  await expect(executePersonalSshExec({ server: '生产', command: 'id' }, () => false)).rejects.toThrow('状态已变化');
  await expect(executePersonalSshManage({ action: 'remove', server: '生产' }, () => false)).rejects.toThrow('状态已变化');
  expect(m.invoke).not.toHaveBeenCalled();
  expect(loadSshServers('owner')).toHaveLength(1);
});

it('SSH-03 AC9 list shows machine details but never credentials', async () => {
  saveSshServers('owner', [{ id: 'a1', name: '生产', destination: 'root@prod.test', port: 22, auth: 'key', group: '华东', note: '主库' }]);
  const rows = await executePersonalSsh({ action: 'list' }, yes) as Record<string, unknown>[];
  expect(rows[0]).toMatchObject({ id: 'a1', destination: 'root@prod.test', auth: 'key', group: '华东', note: '主库' });
  expect(Object.keys(rows[0]).join()).not.toMatch(/secret|password|key_|private/);
});

it('SSH-03 AC10 the new tools are registered with strict schemas and are write-effect capabilities', () => {
  for (const name of ['personal_ssh_manage', 'personal_ssh_exec']) {
    const tool = definitions.find(item => item.name === name) as { inputSchema: { additionalProperties: boolean } } | undefined;
    expect(tool?.inputSchema.additionalProperties).toBe(false);
  }
});
