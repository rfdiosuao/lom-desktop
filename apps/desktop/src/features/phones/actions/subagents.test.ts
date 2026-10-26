import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../runtime/phoneRpc', () => ({ phoneRpc: m.rpc }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import { closeModal, openModal, topModal } from '@/shared/overlays/controller';
import { loadPhoneSubagents, phoneSubagents } from '../runtime/phoneSubagents';
import { deleteSub, editSub, saveSub, toggleSub } from './subagents';
const row = { id: 'writer', name: '写作', description: '写文章', instructions: '整理资料', model_group: '', enabled: 'true', builtin: 'false', revision: 'r1' };
const reply = (revision = 'r1') => ({ items: JSON.stringify([{ ...row, revision }]), groups: '[]', delegation_enabled: 'true' });
let n = 0;
beforeEach(async () => {
  vi.resetAllMocks(); Object.assign(S, initialState()); S.account = { id: `sub-action-${++n}` } as typeof S.account; S.cloud = 'signed-in';
  S.agents.dev_a = { ...S.agents.p1, id: 'dev_a', kind: 'phone', real: true, status: 'online' }; S.phoneId = 'dev_a';
  m.rpc.mockResolvedValue(reply()); await loadPhoneSubagents('dev_a'); m.rpc.mockClear();
});
it('PHONE-01 opens the actual phone config with a captured revision, while new agents get a stable local ID', () => {
  editSub('writer'); expect(S.form).toEqual(row); expect(topModal()?.props).toMatchObject({ phoneId: 'dev_a', revision: 'r1' });
  closeModal(); editSub(); expect(S.form.id).toBeTruthy(); expect(S.form.revision).toBe(''); expect(S.form.model_group).toBe('');
});
it('PHONE-01 refuses to save the old device draft after a device or account switch', async () => {
  editSub('writer'); S.phoneId = 'dev_b'; await saveSub(); expect(m.rpc).not.toHaveBeenCalled(); expect(S.form.name).toBe('写作');
  S.phoneId = 'dev_a'; beginAuthChange(); await saveSub(); expect(m.rpc).not.toHaveBeenCalled(); expect(topModal()?.id).toBe('sub');
});
it('PHONE-01 retains draft and modal when the phone rejects permission, and closes only on acknowledged save', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  editSub('writer'); S.form.description = '修改后的草稿'; m.rpc.mockRejectedValueOnce(new Error('权限不足'));
  await saveSub(); expect(topModal()?.id).toBe('sub'); expect(S.form.description).toBe('修改后的草稿'); expect(phoneSubagents('dev_a').items[0].description).toBe('写文章');
  m.rpc.mockResolvedValueOnce(reply('r2')); await saveSub(); expect(topModal()).toBeUndefined();
  expect(m.rpc).toHaveBeenLastCalledWith('dev_a', 'subagent.save', expect.objectContaining({ id: 'writer', revision: 'r1', description: '修改后的草稿' }));
  vi.restoreAllMocks();
});
it('PHONE-01 does not close another modal or overwrite a later draft when a save finishes late', async () => {
  editSub('writer'); let resolve!: (value: unknown) => void; m.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = saveSub(); closeModal(); openModal('other'); S.form = { text: 'another draft' };
  resolve(reply('r2')); await pending; expect(topModal()?.id).toBe('other'); expect(S.form).toEqual({ text: 'another draft' });
});
it('PHONE-01 retains edits made while a save is pending rather than silently closing them', async () => {
  editSub('writer'); let resolve!: (value: unknown) => void; m.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const pending = saveSub(); S.form.description = 'later edit'; resolve(reply('r2')); await pending;
  expect(topModal()?.id).toBe('sub'); expect(S.form.description).toBe('later edit');
});
it('PHONE-01 toggle failure does not flip the current phone item', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); m.rpc.mockRejectedValueOnce(new Error('offline'));
  await toggleSub('writer'); expect(phoneSubagents('dev_a').items[0].enabled).toBe('true');
  expect(m.rpc).toHaveBeenLastCalledWith('dev_a', 'subagent.toggle', { id: 'writer', revision: 'r1', enabled: 'false' }); vi.restoreAllMocks();
});
it('PHONE-01 delete confirmation cannot target a newly selected phone', () => {
  deleteSub('writer'); const confirmed = topModal()?.props.onOk as () => void; expect(confirmed).toBeTypeOf('function');
  S.phoneId = 'dev_b'; confirmed(); expect(m.rpc).not.toHaveBeenCalled();
});
it('PHONE-01 handles revision changes between delete confirmation and acceptance without an unhandled rejection', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  deleteSub('writer'); const confirmed = topModal()?.props.onOk as () => void;
  m.rpc.mockResolvedValueOnce(reply('r2')); await loadPhoneSubagents('dev_a'); m.rpc.mockClear();
  confirmed(); await Promise.resolve(); expect(m.rpc).not.toHaveBeenCalled(); expect(S.toast?.text).toContain('版本已变化'); vi.restoreAllMocks();
});
it('PHONE-01 cannot save unrelated shared form contents over an existing editor', async () => {
  editSub('writer'); S.form = { ...S.form, id: 'other-agent' }; await saveSub();
  expect(m.rpc).not.toHaveBeenCalled(); expect(topModal()?.id).toBe('sub'); expect(S.toast?.text).toContain('草稿已变化');
});
