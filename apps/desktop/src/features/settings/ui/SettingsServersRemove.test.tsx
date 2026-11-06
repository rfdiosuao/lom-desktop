import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModalHost } from '@/app/overlays/ModalHost';
import { S } from '@/state/store';
import { loadSshServers, saveSshServers, type SshServer } from '../runtime/sshServers';
import { removeMachine } from '../runtime/sshMachineSave';
import { SettingsServers } from './SettingsServers';

const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => true }));

const ACCOUNT = 'ssh-remove-test';
const row: SshServer = { id: 'srv-1', name: '生产机', destination: 'root@prod.test', port: 22, auth: 'password' };
let host: HTMLElement, root: Root;
const buttons = () => [...host.querySelectorAll('button')];
const button = (text: string) => buttons().find(b => b.textContent === text)!;
const okInDialog = () => [...host.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(b => b.textContent === '移除')!;
const removed = () => m.invoke.mock.calls.filter(([cmd]) => cmd === 'ssh_identity_remove');

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  S.account = { id: ACCOUNT, name: '', email: '' };
  S.modals.length = 0;
  m.invoke.mockReset().mockResolvedValue(undefined);
  saveSshServers(ACCOUNT, [row]);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(() => root.render(<><SettingsServers /><ModalHost /></>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); S.modals.length = 0; });

it('SET-SSH-01 #426 asks for confirmation before touching the keychain and keeps everything on cancel', async () => {
  await act(async () => button('移除').click());
  expect(host.querySelector('[role=dialog]')?.textContent).toContain('钥匙串');
  expect(removed()).toHaveLength(0);
  await act(async () => button('取消').click());
  expect(removed()).toHaveLength(0);
  expect(loadSshServers(ACCOUNT)).toEqual([row]);
  expect(host.textContent).toContain('生产机');
});

it('SET-SSH-01 #426 removes the credential and the record once confirmed', async () => {
  await act(async () => button('移除').click());
  await act(async () => okInDialog().click());
  expect(removed()).toEqual([['ssh_identity_remove', { id: 'srv-1' }]]);
  expect(loadSshServers(ACCOUNT)).toEqual([]);
});

it('SET-SSH-01 #426 keeps the record and reports the error when the credential cannot be removed', async () => {
  m.invoke.mockRejectedValue(new Error('ssh.key_store：无法移除已保存的凭据。'));
  await act(async () => button('移除').click());
  await act(async () => okInDialog().click());
  expect(loadSshServers(ACCOUNT)).toEqual([row]);
  expect(host.querySelector('[role=alert]')?.textContent).toContain('ssh.key_store');
  expect(host.textContent).toContain('生产机');
});

it('SET-SSH-01 #426 never deletes the credential when the record list cannot be saved', async () => {
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  try {
    await expect(removeMachine(ACCOUNT, 'srv-1')).rejects.toThrow('服务器列表保存失败');
  } finally { spy.mockRestore(); }
  expect(removed()).toHaveLength(0);
  expect(loadSshServers(ACCOUNT)).toEqual([row]);
});
