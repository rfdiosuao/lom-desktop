import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { DraftAttachment, Schedule } from '@/state/types';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), model: vi.fn(), save: vi.fn() }));
vi.mock('./phoneRpc', () => ({ phoneRpc: mocks.rpc }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }));
vi.mock('./phoneModel', () => ({ syncPhoneModel: mocks.model }));
vi.mock('./phoneChat', () => ({ syncPhoneHistory: vi.fn() }));
const { uploadPhoneFile, downloadPhoneFile } = await import('./phoneFiles');
const { savePhoneSchedule, phoneSchedule, changePhoneSchedule } = await import('./phoneSchedules');
beforeEach(() => { vi.resetAllMocks(); mocks.model.mockResolvedValue(undefined); });
it('R02-02 resumes a failed upload with the same transfer identity and only accepts verified completion', async () => {
  const file: DraftAttachment = { path: '/selected/test.txt', name: 'test.txt' };
  mocks.invoke.mockImplementation(async name => name === 'local_file_info' ? ['3', 'a'.repeat(64)] : btoa('abc'));
  let received = false;
  mocks.rpc.mockImplementation(async (_device, method, p) => {
    if (method === 'file.begin') return { ...p, offset: received ? '3' : '0' };
    if (method === 'file.chunk') { received = true; throw new Error('relay.reply_timeout'); }
    return { id: p.id, status: 'complete', sha256: 'a'.repeat(64) };
  });
  await expect(uploadPhoneFile('dev_a', file)).rejects.toThrow('timeout');
  expect(file.uploading).toBe(false);
  const id = file.transferId;
  expect(await uploadPhoneFile('dev_a', file)).toBe(id);
  expect(mocks.rpc.mock.calls.filter(c => c[1] === 'file.chunk')).toHaveLength(1);
  expect(mocks.rpc.mock.calls.filter(c => c[1] === 'file.begin').every(c => c[2].id === id)).toBe(true);
});
it('R02-02 never claims success before phone checksum receipt', async () => {
  mocks.invoke.mockResolvedValue(['0', 'a'.repeat(64)]);
  mocks.rpc.mockResolvedValue({ offset: '0', status: 'uploading' });
  await expect(uploadPhoneFile('dev_a', { path: '/empty', name: 'empty' })).rejects.toThrow('尚未确认');
});
it('R02-02 download is bounded and writes only after all chunks arrive', async () => {
  mocks.save.mockResolvedValue('/chosen/test.txt');
  mocks.rpc.mockResolvedValue({ data: btoa('abc'), next: '3' });
  await downloadPhoneFile('dev_a', { id: 'file-id', name: 'test.txt', size: '3', sha256: 'HASH', mime: 'text/plain', offset: '3', status: 'complete' });
  expect(mocks.invoke).toHaveBeenCalledWith('local_file_save', { path: '/chosen/test.txt', data: btoa('abc'), sha256: 'HASH' });
  mocks.invoke.mockClear(); mocks.rpc.mockResolvedValue({ data: btoa('abc'), next: '900' });
  await expect(downloadPhoneFile('dev_a', { id: 'id', name: 'test', size: '3', sha256: 'HASH', mime: '', offset: '', status: '' })).rejects.toThrow('无效');
  expect(mocks.invoke).not.toHaveBeenCalled();
});
const form = (): Schedule => ({ id: '', exec: 'dev_a', name: '巡检', prompt: '检查', freq: 'weekly', days: [0, 1], every: 60, time: '09:00', enabled: true, runIn: 'new', runs: [], last: null });
it('R02-02 schedule create retries retain the id; days map to phone calendar', async () => {
  const f = form(); mocks.rpc.mockRejectedValue(new Error('timeout'));
  await expect(savePhoneSchedule(f)).rejects.toThrow(); await expect(savePhoneSchedule(f)).rejects.toThrow();
  const [a, b] = mocks.rpc.mock.calls.map(c => c[2]);
  expect(a.id).toBe(b.id); expect(JSON.parse(a.days)).toEqual([7, 1]);
  expect(mocks.model).toHaveBeenCalledWith('dev_a');
});
it('R02-02 refuses a same-window task without a phone session', async () => {
  S.convs = []; S.activeConv = null;
  await expect(savePhoneSchedule({ ...form(), runIn: 'same' })).rejects.toThrow('先打开');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('R02-02 real records and permission state are rendered without simulated success', () => {
  const mapped = phoneSchedule('dev_a', { id: 'id', revision: 'rev', name: 'n', prompt: 'p', freq: 'daily', time: '09:00', days: '[7]', every: '60', enabled: 'true', session_id: '', next: '300', last: '200', runs: '[{"firedAt":200,"sessionId":"s","preview":"failed","ok":false}]', editable: 'true' }, { items: '', timezone: 'Asia/Taipei', exact: 'false' });
  expect(mapped.days).toEqual([0]); expect(mapped.exact).toBe(false); expect(mapped.runs[0]).toMatchObject({ ok: false, sessionId: 's' });
});
it('R02-02 run retry retains operation id when reply is unknown', async () => {
  const x = { ...form(), phoneTask: 'task', revision: 'rev' };
  mocks.rpc.mockRejectedValue(new Error('timeout'));
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow();
  await expect(changePhoneSchedule(x, 'schedule.run')).rejects.toThrow();
  expect(mocks.rpc.mock.calls[0][2].request_id).toBe(mocks.rpc.mock.calls[1][2].request_id);
});
it('PHONE-IMAGE-01 revoking scope after a chunk prevents further chunks and finish', async () => {
  mocks.invoke.mockImplementation(async name => name === 'local_file_info' ? ['6', 'a'.repeat(64)] : btoa('abc'));
  let allowed = true;
  mocks.rpc.mockImplementation(async (_device, method) => {
    if (method === 'file.begin') return { offset: '0' };
    allowed = false; return { offset: '3' };
  });
  await expect(uploadPhoneFile('dev', { path: '/a.png', name: 'a.png' }, () => { if (!allowed) throw new Error('撤销'); })).rejects.toThrow('撤销');
  expect(mocks.rpc.mock.calls.map(c => c[1])).toEqual(['file.begin', 'file.chunk']);
});

it('PHONE-IMAGE-01 a checksum receipt for a different file never counts as success', async () => {
  mocks.invoke.mockResolvedValue(['0', 'a'.repeat(64)]);
  mocks.rpc.mockImplementation(async (_device, method) => method === 'file.begin' ? { offset: '0' } : { id: 'wrong', status: 'complete', sha256: 'a'.repeat(64) });
  await expect(uploadPhoneFile('dev', { path: '/a.png', name: 'a.png' })).rejects.toThrow('尚未确认');
});
