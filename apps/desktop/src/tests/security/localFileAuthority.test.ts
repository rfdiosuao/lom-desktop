import { beforeEach, expect, it, vi } from 'vitest';
import { uploadPhoneFile, downloadPhoneFile } from '@/features/phones/runtime/phoneFiles';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/features/phones/runtime/phoneRpc', () => ({ phoneRpc: mocks.rpc }));
beforeEach(() => vi.resetAllMocks());
it('LOCAL-FILE-01 upload chunks use a native ticket and release it on failure', async () => {
  mocks.invoke.mockImplementation(async name => name === 'local_file_info' ? ['3', 'digest', 'ticket-123'] : btoa('abc'));
  mocks.rpc.mockImplementation(async (_device, method) => {
    if (method === 'file.begin') return { offset: '0' };
    throw new Error('offline');
  });
  await expect(uploadPhoneFile('dev_a', { path: '/requested/file', name: 'file' })).rejects.toThrow('offline');
  expect(mocks.invoke).toHaveBeenCalledWith('local_file_chunk', { ticket: 'ticket-123', offset: 0 });
  expect(mocks.invoke).toHaveBeenCalledWith('local_file_release', { ticket: 'ticket-123' });
});
it('LOCAL-FILE-01 missing native grant blocks phone upload', async () => {
  mocks.invoke.mockResolvedValue(['3', 'digest']);
  await expect(uploadPhoneFile('dev_a', { path: '/unauthorized', name: 'file' })).rejects.toThrow('grant_missing');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('LOCAL-FILE-01 native save cancellation never reports saved', async () => {
  mocks.invoke.mockResolvedValue(false); mocks.rpc.mockResolvedValue({ data: btoa('abc'), next: '3' });
  expect(await downloadPhoneFile('dev_a', { id: 'f', name: 'file', size: '3', sha256: 'hash', mime: '', offset: '', status: '' })).toBe(false);
});
