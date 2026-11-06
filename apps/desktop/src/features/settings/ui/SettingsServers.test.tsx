import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ModalHost } from '@/app/overlays/ModalHost';
import { S } from '@/state/store';
import { SettingsServers } from './SettingsServers';

const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => true }));

const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!;
const fill = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};
const field = (host: HTMLElement, label: string) => host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;

it('SSH-02 adds a machine through the dialog and shows actual probe output after reopening', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  S.account = { id: 'ssh-ui-test', name: '', email: '' };
  S.cloud = 'signed-in';
  m.invoke.mockReset().mockResolvedValue(undefined);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<><SettingsServers /><ModalHost /></>));
    await act(async () => button(host, '添加机器').click());
    await act(() => { fill(field(host, '机器名称'), '测试服务器'); fill(field(host, '主机地址'), 'server.test'); });
    await act(() => fill(field(host, '密码'), 'correct horse'));
    await act(async () => button(host, '添加').click());
    expect(m.invoke).toHaveBeenCalledWith('ssh_secret_store', { id: expect.any(String), auth: 'password', draft: { secret: 'correct horse' } });
    expect(host.querySelector('[role=dialog]')).toBeNull();
    await act(() => root.render(null));
    await act(() => root.render(<><SettingsServers /><ModalHost /></>));
    expect(host.textContent).toContain('测试服务器');
    expect(host.textContent).toContain('root@server.test:22');
    expect(host.textContent).toContain('密码');
    m.invoke.mockResolvedValueOnce('Linux\nup 2 days');
    await act(async () => button(host, '查看状态').click());
    expect(m.invoke).toHaveBeenLastCalledWith('ssh_server_probe', { destination: 'root@server.test', port: 22, status: true, id: expect.any(String), auth: 'password', draft: null });
    expect(host.querySelector('[role=status]')?.textContent).toContain('up 2 days');
    expect(host.querySelector('[role=status]')?.textContent).toMatch(/SSH 探测耗时 \d+ ms/);
    expect(JSON.stringify({ ...localStorage })).not.toContain('correct horse');
  } finally { act(() => root.unmount()); host.remove(); }
});
