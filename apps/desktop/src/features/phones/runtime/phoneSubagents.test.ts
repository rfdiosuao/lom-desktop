import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import type { PhoneSubAgent, SubAgentWrite } from '@/core/remoteWire';
import { changePhoneSubagent, loadPhoneSubagents, phoneSubagents, savePhoneSubagent } from './phoneSubagents';
const device = 'dev_a'; let n = 0;
const item = (extra: Partial<PhoneSubAgent> = {}): PhoneSubAgent => ({ id: 'writer', name: '写作', description: '写文章', instructions: '整理资料写文章', model_group: 'group-phone', enabled: 'true', builtin: 'false', revision: 'r1', ...extra });
const reply = (items = [item()], delegation = 'false') => ({ items: JSON.stringify(items), groups: JSON.stringify([{ id: 'group-phone', name: '手机模型' }]), delegation_enabled: delegation });
const write = (extra: Partial<SubAgentWrite> = {}): SubAgentWrite => {
  const { builtin: _builtin, ...value } = item(); return { ...value, ...extra };
};
beforeEach(() => {
  vi.resetAllMocks(); Object.assign(S, initialState());
  S.account = { id: `phone-sub-${++n}` } as typeof S.account; S.cloud = 'signed-in';
  S.agents[device] = { ...S.agents.p1, id: device, kind: 'phone', real: true, status: 'online' }; S.phoneId = device;
  m.rpc.mockResolvedValue(reply());
});
it('PHONE-01 reads real items and phone model groups, retaining the global delegation switch', async () => {
  await loadPhoneSubagents(device);
  expect(m.rpc).toHaveBeenCalledWith(device, 'subagent.list', {});
  expect(phoneSubagents(device)).toMatchObject({ loaded: true, busy: false, items: [item()], groups: [{ id: 'group-phone', name: '手机模型' }], delegationEnabled: false });
});
it('PHONE-01 does not optimistically mutate a toggle, and transmits the exact current revision', async () => {
  await loadPhoneSubagents(device); let resolve!: (value: unknown) => void;
  m.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const request = { id: 'writer', enabled: 'false', revision: 'r1' };
  const pending = changePhoneSubagent(device, 'toggle', request);
  expect(phoneSubagents(device).items[0].enabled).toBe('true');
  expect(phoneSubagents(device).busy).toBe(true);
  expect(m.rpc).toHaveBeenLastCalledWith(device, 'subagent.toggle', request);
  resolve(reply([item({ enabled: 'false', revision: 'r2' })])); await pending;
  expect(phoneSubagents(device).items[0]).toMatchObject({ enabled: 'false', revision: 'r2' });
});
it('PHONE-01 keeps known data and failure text after a rejected write so retry remains possible', async () => {
  await loadPhoneSubagents(device); m.rpc.mockRejectedValueOnce(new Error('手机未授权'));
  await expect(savePhoneSubagent(device, write({ name: '改名' }))).rejects.toThrow('手机未授权');
  expect(phoneSubagents(device)).toMatchObject({ items: [item()], busy: false, error: '手机未授权' });
  m.rpc.mockResolvedValueOnce(reply([item({ name: '改名', revision: 'r2' })]));
  await savePhoneSubagent(device, write({ name: '改名' }));
  expect(phoneSubagents(device).items[0].name).toBe('改名');
});
it('PHONE-01 creates with an empty revision and automatic phone model selection', async () => {
  await loadPhoneSubagents(device); const input = write({ id: 'new-id', revision: '', model_group: '' });
  m.rpc.mockResolvedValueOnce(reply([item(), item({ ...input, revision: 'r-new' })]));
  await savePhoneSubagent(device, input);
  expect(m.rpc).toHaveBeenLastCalledWith(device, 'subagent.save', input);
  expect(phoneSubagents(device).items).toHaveLength(2);
});
it('PHONE-01 rejects stale revisions, builtin rename/delete and unavailable phone groups before sending', async () => {
  m.rpc.mockResolvedValueOnce(reply([item({ builtin: 'true' })])); await loadPhoneSubagents(device); m.rpc.mockClear();
  expect(() => savePhoneSubagent(device, write({ revision: 'old' }))).toThrow('版本已变化');
  expect(() => savePhoneSubagent(device, write({ name: 'renamed' }))).toThrow('不能改名');
  expect(() => savePhoneSubagent(device, write({ model_group: 'cloud-model' }))).toThrow('分组已不存在');
  expect(() => changePhoneSubagent(device, 'delete', { id: 'writer', enabled: 'true', revision: 'r1' })).toThrow('不能删除');
  expect(m.rpc).not.toHaveBeenCalled();
});
it('PHONE-01 only removes an item once the phone acknowledges deletion', async () => {
  await loadPhoneSubagents(device); let resolve!: (value: unknown) => void;
  m.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = changePhoneSubagent(device, 'delete', { id: 'writer', enabled: 'true', revision: 'r1' });
  expect(phoneSubagents(device).items).toHaveLength(1);
  resolve(reply([])); await pending; expect(phoneSubagents(device).items).toEqual([]);
});
it('PHONE-01 refuses offline/demo/unsigned phones without RPC', async () => {
  S.agents[device].status = 'offline'; await expect(loadPhoneSubagents(device)).rejects.toThrow('离线');
  S.agents[device].status = 'online'; S.agents[device].real = false; await expect(loadPhoneSubagents(device)).rejects.toThrow('真实配对手机');
  S.cloud = 'signed-out'; await expect(loadPhoneSubagents(device)).rejects.toThrow('登录'); expect(m.rpc).not.toHaveBeenCalled();
});
it('PHONE-01 invalidates pending replies even after signing back into the same account', async () => {
  let resolve!: (value: unknown) => void;
  m.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; })); const pending = loadPhoneSubagents(device);
  beginAuthChange(); resolve(reply()); await expect(pending).rejects.toThrow('账号或设备已变化');
  expect(phoneSubagents(device).loaded).toBe(false); expect(phoneSubagents(device).items).toEqual([]);
});
it('PHONE-01 device switching retains reply only in the originally addressed device cache', async () => {
  let resolve!: (value: unknown) => void; m.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = loadPhoneSubagents(device); S.phoneId = 'other-phone'; resolve(reply()); await pending;
  expect(phoneSubagents('other-phone').items).toEqual([]); expect(phoneSubagents(device).items).toEqual([item()]);
});
it.each([reply([item({ enabled: 'yes' })]), reply([item({ revision: '' })]), reply([item(), item()]), { ...reply(), items: '{}' }, reply([item()], '1')])('PHONE-01 rejects malformed response without replacing known data', async invalid => {
  await loadPhoneSubagents(device); m.rpc.mockResolvedValueOnce(invalid);
  await expect(loadPhoneSubagents(device)).rejects.toThrow();
  expect(phoneSubagents(device).items).toEqual([item()]); expect(phoneSubagents(device).busy).toBe(false);
});
it('PHONE-01 blocks simultaneous requests instead of applying out-of-order snapshots', async () => {
  let resolve!: (value: unknown) => void; m.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const first = loadPhoneSubagents(device); await expect(loadPhoneSubagents(device)).rejects.toThrow('等待当前操作');
  expect(m.rpc).toHaveBeenCalledTimes(1); resolve(reply()); await first;
});
it('PHONE-01 preserves unknown persistence outcome and never retries a write automatically', async () => {
  await loadPhoneSubagents(device); m.rpc.mockRejectedValueOnce(Object.assign(new Error('subagent.persist_failed'), { code: 'subagent.persist_failed' }));
  await expect(savePhoneSubagent(device, write())).rejects.toThrow('保存结果未确认');
  expect(m.rpc).toHaveBeenCalledTimes(2); expect(phoneSubagents(device).items).toEqual([item()]);
  expect(phoneSubagents(device).error).toContain('刷新手机状态');
});
it('PHONE-01 explains old phone versions and revoked authorization in Chinese', async () => {
  m.rpc.mockRejectedValueOnce(new Error('remote.method_unknown')); await expect(loadPhoneSubagents(device)).rejects.toThrow('更新手机 App');
  m.rpc.mockRejectedValueOnce(new Error('remote.revoked')); await expect(loadPhoneSubagents(device)).rejects.toThrow('重新授权');
});
