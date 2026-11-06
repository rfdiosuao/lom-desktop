import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModalHost } from '@/app/overlays/ModalHost';
import { closeModal, openModal } from '@/shared/overlays/controller';
import { S } from '@/state/store';
import { loadSshServers, saveSshServers, type SshServer } from '../runtime/sshServers';

const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => true }));

let host: HTMLElement, root: Root;
const onSaved = vi.fn();
const KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----';
const q = <T extends HTMLElement>(selector: string) => host.querySelector<T>(selector)!;
const field = (label: string) => q<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(`[aria-label="${label}"]:not([type=radio])`);
const radio = (text: string) => [...host.querySelectorAll('label.radios__opt')].find(l => l.textContent === text)!.querySelector('input')!;
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text)!;
const fill = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};
const open = (props: Record<string, unknown> = {}) => act(async () => { openModal('sshMachine', { account: 'a', onSaved, ...props }); });
const basics = () => act(() => { fill(field('机器名称'), '生产机'); fill(field('主机地址'), 'prod.example.test'); });

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  m.invoke.mockReset().mockResolvedValue(undefined);
  onSaved.mockReset();
  S.cloud = 'signed-in';
  S.modals.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(() => root.render(<ModalHost />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); S.modals.length = 0; });

it('SSH-02 AC1 shows the add-machine dialog with defaults and keeps Add disabled until required fields are valid', async () => {
  await open();
  expect(q('[role=dialog]').getAttribute('aria-label')).toBe('添加机器');
  expect([...host.querySelectorAll('[role=tab]')].map(tab => tab.textContent)).toEqual(['基本设置', '高级选项']);
  expect(field('用户名').value).toBe('root');
  expect(field('端口').value).toBe('22');
  expect(field('分组').value).toBe('');
  expect(field('分组').selectedOptions[0].textContent).toBe('未分组');
  expect(radio('密码').checked).toBe(true);
  expect(radio('密钥').checked).toBe(false);
  expect(button('添加').disabled).toBe(true);
  await basics();
  expect(button('添加').disabled).toBe(true);
  await act(() => fill(field('密码'), 'pw'));
  expect(button('添加').disabled).toBe(false);
  await act(() => fill(field('主机地址'), '-oProxyCommand=bad'));
  expect(button('添加').disabled).toBe(true);
  await act(() => fill(field('主机地址'), 'prod.example.test'));
  await act(() => fill(field('端口'), '70000'));
  expect(button('添加').disabled).toBe(true);
});

it('SSH-02 AC2 counts name and note characters against their limits', async () => {
  await open();
  expect(host.textContent).toContain('0 / 30');
  expect(host.textContent).toContain('0 / 50');
  await act(() => { fill(field('机器名称'), '生产机'); fill(field('备注'), '机房二楼'); });
  expect(host.textContent).toContain('3 / 30');
  expect(host.textContent).toContain('4 / 50');
  expect(field('机器名称').maxLength).toBe(30);
  expect(field('备注').maxLength).toBe(50);
});

it('SSH-02 AC3 switches between password and key inputs and masks secrets until revealed', async () => {
  await open();
  expect(field('密码').type).toBe('password');
  await act(async () => button('显示').click());
  expect(field('密码').type).toBe('text');
  await act(() => fill(field('密码'), 'secret-pw'));
  await act(async () => radio('密钥').click());
  expect(host.querySelector('input[aria-label="密码"]')).toBeNull();
  expect(field('密钥').tagName).toBe('TEXTAREA');
  expect(field('密钥').value).toBe('');
  expect(field('密钥密码').type).toBe('password');
  expect(button('上传密钥文件')).toBeTruthy();
  await act(async () => button('高级选项').click());
  expect(host.textContent).toContain('沿用本机配置');
  await act(async () => button('基本设置').click());
  expect(field('机器名称')).toBeTruthy();
});

it('SSH-02 AC4 test connection really probes with the draft and reports success or a coded failure without saving', async () => {
  await open();
  expect(button('测试连接').disabled).toBe(true);
  await basics();
  await act(() => fill(field('密码'), 'pw'));
  await act(async () => button('测试连接').click());
  expect(m.invoke).toHaveBeenCalledWith('ssh_server_probe', { destination: 'root@prod.example.test', port: 22, status: false, id: expect.any(String), auth: 'password', draft: { secret: 'pw' } });
  expect(q('[role=status]').textContent).toMatch(/连接成功 · \d+ ms/);
  m.invoke.mockRejectedValueOnce('ssh.auth：SSH 认证失败，请核对用户名、密码或私钥。');
  await act(async () => button('测试连接').click());
  expect(q('[role=alert]').textContent).toContain('ssh.auth');
  expect(loadSshServers('a')).toEqual([]);
  expect(m.invoke).not.toHaveBeenCalledWith('ssh_secret_store', expect.anything());
});

it('SSH-02 AC5 adds a key machine with passphrase, group and note and keeps secrets out of storage', async () => {
  saveSshServers('a', [{ id: 'old', name: '旧机', destination: 'old.example.test', port: null, group: '办公室' }]);
  await open();
  await basics();
  await act(async () => radio('密钥').click());
  await act(() => { fill(field('密钥'), KEY); fill(field('密钥密码'), 'phrase-xyz'); fill(field('备注'), '主库'); });
  expect([...field('分组').options].map(option => option.textContent)).toEqual(['未分组', '办公室', '新建分组…']);
  await act(() => { field('分组').value = '办公室'; field('分组').dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => button('添加').click());
  expect(m.invoke).toHaveBeenCalledWith('ssh_secret_store', { id: expect.any(String), auth: 'key', draft: { secret: KEY, passphrase: 'phrase-xyz' } });
  const added = loadSshServers('a')[1];
  expect(added).toMatchObject({ name: '生产机', destination: 'root@prod.example.test', port: 22, auth: 'key', group: '办公室', note: '主库' });
  expect(JSON.stringify({ ...localStorage })).not.toMatch(/fixture|phrase-xyz/);
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[role=dialog]')).toBeNull();
});

it('SSH-02 AC6 a failed credential save keeps the dialog open with a coded error and saves nothing', async () => {
  await open();
  await basics();
  await act(() => fill(field('密码'), 'pw'));
  m.invoke.mockRejectedValueOnce('ssh.key_store：无法保存凭据。');
  await act(async () => button('添加').click());
  expect(q('[role=alert]').textContent).toContain('ssh.key_store');
  expect(loadSshServers('a')).toEqual([]);
  expect(onSaved).not.toHaveBeenCalled();
  expect(field('机器名称').value).toBe('生产机');
});

it('SSH-02 AC7 removes the just-stored credential when the machine list cannot be saved', async () => {
  const rows: SshServer[] = Array.from({ length: 50 }, (_, index) => ({ id: `id-${index}`, name: `机${index}`, destination: `h${index}.test`, port: null }));
  saveSshServers('a', rows);
  await open();
  await basics();
  await act(() => fill(field('密码'), 'pw'));
  await act(async () => button('添加').click());
  expect(q('[role=alert]').textContent).toContain('最多保存 50 台');
  expect(m.invoke).toHaveBeenCalledWith('ssh_identity_remove', { id: expect.any(String) });
  expect(loadSshServers('a')).toHaveLength(50);
});

it('SSH-02 AC8 keeps an old machine intact when edited: legacy auth, saved credentials and unknown fields survive', async () => {
  const legacy = { id: 'old', name: '旧机', destination: 'ops@old.example.test', port: 2222 };
  saveSshServers('a', [legacy]);
  await open({ editing: legacy });
  expect(q('[role=dialog]').getAttribute('aria-label')).toBe('编辑机器');
  expect(field('用户名').value).toBe('ops');
  expect(field('主机地址').value).toBe('old.example.test');
  expect(field('端口').value).toBe('2222');
  expect(host.textContent).toContain('沿用本机 SSH 配置');
  await act(() => fill(field('备注'), '备份机'));
  await act(async () => button('保存').click());
  expect(loadSshServers('a')).toEqual([{ ...legacy, note: '备份机' }]);
  expect(m.invoke).not.toHaveBeenCalled();
});

it('SSH-02 AC9 editing a saved password machine keeps its credential when the password is left blank', async () => {
  const saved: SshServer = { id: 'p1', name: '密码机', destination: 'root@pw.example.test', port: 22, auth: 'password' };
  saveSshServers('a', [saved]);
  await open({ editing: saved });
  expect(button('保存').disabled).toBe(false);
  await act(async () => button('测试连接').click());
  expect(m.invoke).toHaveBeenCalledWith('ssh_server_probe', { destination: 'root@pw.example.test', port: 22, status: false, id: 'p1', auth: 'password', draft: null });
  await act(async () => button('保存').click());
  expect(m.invoke).not.toHaveBeenCalledWith('ssh_secret_store', expect.anything());
  await open({ editing: saved });
  await act(async () => radio('密钥').click());
  expect(button('保存').disabled).toBe(true);
});

it('SSH-02 AC10 cancel closes without saving anything', async () => {
  await open();
  await basics();
  await act(async () => button('取消').click());
  expect(host.querySelector('[role=dialog]')).toBeNull();
  expect(loadSshServers('a')).toEqual([]);
  expect(m.invoke).not.toHaveBeenCalled();
  void closeModal;
});

it('SSH-02 AC11 creates a new group from the dialog and offers it to the next machine', async () => {
  await open();
  await basics();
  await act(() => fill(field('密码'), 'pw'));
  expect(host.querySelector('[aria-label="新分组名称"]')).toBeNull();
  await act(() => { field('分组').value = '\u0000new'; field('分组').dispatchEvent(new Event('change', { bubbles: true })); });
  await act(() => fill(field('新分组名称'), '  华东机房 '));
  await act(async () => button('添加').click());
  expect(loadSshServers('a')[0].group).toBe('华东机房');
  await open();
  expect([...field('分组').options].map(option => option.textContent)).toEqual(['未分组', '华东机房', '新建分组…']);
});

it('SSH-02 AC11 rejects the reserved all-groups name as a new group', async () => {
  await open();
  await basics();
  await act(() => fill(field('密码'), 'pw'));
  await act(() => { field('分组').value = '\u0000new'; field('分组').dispatchEvent(new Event('change', { bubbles: true })); });
  await act(() => fill(field('新分组名称'), '未分组'));
  expect(button('添加').disabled).toBe(true);
  await act(() => fill(field('新分组名称'), '生产'));
  expect(button('添加').disabled).toBe(false);
});

it('SET-SSH-01 #435 shows why the submit button is disabled as visible text linked by aria-describedby', async () => {
  await open();
  const submit = button('添加') as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  const hint = q<HTMLElement>(`#${submit.getAttribute('aria-describedby')}`);
  expect(hint.textContent).toBe('请填写机器名称。');
  expect(host.querySelector('.ssh-machine__problem')).toBe(hint);
  await basics();
  expect(hint.isConnected).toBe(true);
  expect(q<HTMLElement>(`#${(button('添加') as HTMLButtonElement).getAttribute('aria-describedby')}`).textContent).toBe('请填写密码。');
  await act(() => fill(field('密码'), 'pw'));
  expect((button('添加') as HTMLButtonElement).disabled).toBe(false);
  expect(host.querySelector('.ssh-machine__problem')).toBeNull();
  expect(button('添加').getAttribute('aria-describedby')).toBeNull();
});

it('SET-SSH-01 #435 uses one term for the address and keeps the ungrouped option distinct from reserved names', async () => {
  await open();
  expect(field('主机地址')).toBeTruthy();
  expect(host.textContent).not.toMatch(/Host ?地址/);
  expect(field('分组').selectedOptions[0].textContent).toBe('未分组');
  await act(() => fill(field('主机地址'), ''));
  await act(() => fill(field('机器名称'), '机'));
  expect(q('.ssh-machine__problem').textContent).toBe('请填写主机地址。');
  await act(() => { fill(field('主机地址'), 'a.test'); fill(field('密码'), 'pw'); });
  await act(() => { field('分组').value = '\u0000new'; field('分组').dispatchEvent(new Event('change', { bubbles: true })); });
  await act(() => fill(field('新分组名称'), '未分组'));
  expect(q('.ssh-machine__problem').textContent).toBe('分组名称不能是「未分组」。');
});
