import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => true }));
import { loadSshServers, probeSshServer, saveSshServers, sshGroups, storeSshSecret } from './sshServers';

beforeEach(() => { localStorage.clear(); m.invoke.mockReset(); });
const host = { id: 'id', name: '运维服务器', destination: 'ops@example.test', port: 2222 };

it('SSH-01 saves connection metadata per account and rejects argument injection', () => {
  saveSshServers('one', [host]);
  expect(loadSshServers('one')).toEqual([host]);
  expect(loadSshServers('two')).toEqual([]);
  expect(() => saveSshServers('one', [{ ...host, destination: '-oProxyCommand=bad' }])).toThrow();
  expect(loadSshServers('one')).toEqual([host]);
});

it('SSH-01 calls the native probe with the saved destination and a fixed action', async () => {
  m.invoke.mockResolvedValue('Linux');
  await expect(probeSshServer(host, true)).resolves.toBe('Linux');
  expect(m.invoke).toHaveBeenCalledWith('ssh_server_probe', { destination: 'ops@example.test', port: 2222, status: true, id: host.id, auth: null, draft: null });
});

it('SSH-01 PersonalAgent probes only a saved server and remembers the outcome for its account', async () => {
  const { S } = await import('@/state/store');
  const { executePersonalSsh } = await import('@/features/personal/runtime/sshTools');
  const { readSshCheck } = await import('./sshServers');
  S.account = { id: 'one', name: '', email: '' };
  saveSshServers('one', [host]);
  await expect(executePersonalSsh({ action: 'status', server: 'other' }, () => true)).rejects.toThrow('服务器不存在');
  expect(m.invoke).not.toHaveBeenCalled();
  m.invoke.mockRejectedValueOnce('ssh.auth：SSH 认证失败');
  await expect(executePersonalSsh({ action: 'status', server: host.name }, () => true)).rejects.toThrow('ssh.auth');
  expect(readSshCheck('one', host)).toMatchObject({ ok: false, detail: 'ssh.auth：SSH 认证失败' });
  expect(readSshCheck('two', host)).toBeUndefined();
});

it('SSH-02 reads machines saved before groups, notes and verification methods existed', () => {
  localStorage.setItem('lom.ssh-servers.v1:old', JSON.stringify([host]));
  expect(loadSshServers('old')).toEqual([host]);
  expect(sshGroups(loadSshServers('old'))).toEqual([]);
});

it('SSH-02 keeps group, note and verification method and rejects malformed values', () => {
  const full = { ...host, auth: 'key' as const, group: '生产', note: '主库' };
  saveSshServers('one', [full, { ...host, id: 'two', group: '生产' }, { ...host, id: 'three', group: '测试' }]);
  expect(loadSshServers('one')[0]).toEqual(full);
  expect(sshGroups(loadSshServers('one'))).toEqual(['生产', '测试']);
  for (const bad of [{ auth: 'token' }, { group: 'x'.repeat(31) }, { note: 'x'.repeat(51) }, { note: 5 }]) {
    expect(() => saveSshServers('one', [{ ...host, ...bad } as never])).toThrow();
  }
  expect(loadSshServers('one')[0]).toEqual(full);
});

it('SSH-02 sends credentials to the native shell only as an invoke argument for the test or the store call', async () => {
  m.invoke.mockResolvedValue(undefined);
  await probeSshServer({ ...host, auth: 'password' }, false, { secret: 'pw' });
  expect(m.invoke).toHaveBeenLastCalledWith('ssh_server_probe', { destination: 'ops@example.test', port: 2222, status: false, id: 'id', auth: 'password', draft: { secret: 'pw' } });
  await storeSshSecret('id', 'key', { secret: 'KEY', passphrase: 'phrase' });
  expect(m.invoke).toHaveBeenLastCalledWith('ssh_secret_store', { id: 'id', auth: 'key', draft: { secret: 'KEY', passphrase: 'phrase' } });
  expect(JSON.stringify({ ...localStorage })).not.toMatch(/phrase|KEY/);
});
