import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// @ts-expect-error Node provides WebCrypto in the test runner; app types are browser-only.
import { webcrypto } from 'node:crypto';
const m = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(() => true), openTask: vi.fn(), refresh: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: m.isTauri }));
vi.mock('./tasks', () => ({ openTask: m.openTask }));
vi.mock('@/features/phones/runtime/phoneChat', () => ({ refreshPhoneChat: m.refresh }));
import { saveMarkdown } from './exportMarkdown';
import { exportConv } from '../actions/conversations';
import { initialState } from '@/state/state';
import { S } from '@/state/store';

/* TEAM-MENU-01：会话导出先读完整记录，真正保存了才提示成功；取消不提示，失败报错；浏览器预览下一拍再回收下载地址。 */

const decode = (data: string) => new TextDecoder().decode(Uint8Array.from(atob(data), ch => ch.charCodeAt(0)));
const sha256 = async (text: string) => Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (b: number) => b.toString(16).padStart(2, '0')).join('');
let silence: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks(); m.isTauri.mockReturnValue(true); m.openTask.mockResolvedValue(undefined);
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  silence = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  Object.assign(S, initialState());
  S.convs = [{ id: 'c1', owner: 'pc', title: '周报/草稿', updated: 1, remote: true, loaded: true, messages: [
    { id: 'u', type: 'user', at: 1, text: '整理周报' }, { id: 'a', type: 'assistant', at: 2, text: '已整理' },
  ] }];
});
afterEach(() => { silence.mockRestore(); vi.useRealTimers(); });

it('TEAM-MENU-01 AC-5 a saved conversation export loads the full history first and reports the saved file', async () => {
  m.invoke.mockResolvedValue(true);
  await exportConv('c1');
  expect(m.openTask).toHaveBeenCalledWith('c1', { throwOnError: true, refreshWorkspace: false });
  const [command, args] = m.invoke.mock.calls[0];
  expect(command).toBe('local_file_save');
  expect(args.name).toBe('周报_草稿.md');
  expect(decode(args.data)).toBe('# 周报/草稿\n\n**我**：整理周报\n\n**总指挥**：已整理\n');
  expect(args.sha256).toBe(await sha256(decode(args.data)));
  expect(S.toast).toMatchObject({ text: '已导出「周报_草稿.md」', tone: 'ok' });
});

it('TEAM-MENU-01 AC-5 cancelling the save dialog is not reported as an export', async () => {
  m.invoke.mockResolvedValue(false);
  await exportConv('c1');
  expect(m.invoke).toHaveBeenCalledTimes(1);
  expect(S.toast).toBeNull();
});

it('TEAM-MENU-01 AC-5 a failed save or history load reports an error and never claims success', async () => {
  m.invoke.mockRejectedValue('file.save_failed');
  await exportConv('c1');
  expect(S.toast).toMatchObject({ tone: 'error' });
  expect(S.toast?.text).toContain('导出失败，没有生成文件');

  m.invoke.mockClear(); m.openTask.mockRejectedValueOnce(new Error('核心服务没有响应'));
  await exportConv('c1');
  expect(m.invoke).not.toHaveBeenCalled();
  expect(S.toast?.text).toContain('导出失败，没有生成文件');
});

it('TEAM-MENU-01 AC-6 the browser preview downloads the file and releases the link only after a tick', async () => {
  vi.useFakeTimers();
  m.isTauri.mockReturnValue(false);
  const original = [Object.getOwnPropertyDescriptor(URL, 'createObjectURL'), Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')] as const;
  const create = vi.fn(() => 'blob:export'), revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revoke });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  await expect(saveMarkdown('周报.md', '# 周报')).resolves.toBe(true);
  expect(click).toHaveBeenCalledTimes(1);
  expect(revoke).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(revoke).toHaveBeenCalledWith('blob:export');
  expect(m.invoke).not.toHaveBeenCalled();
  click.mockRestore();
  (['createObjectURL', 'revokeObjectURL'] as const).forEach((key, i) => {
    if (original[i]) Object.defineProperty(URL, key, original[i]!); else delete (URL as unknown as Record<string, unknown>)[key];
  });
});
