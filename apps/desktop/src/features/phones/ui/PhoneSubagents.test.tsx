import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../runtime/phoneRpc', () => ({ phoneRpc: m.rpc }));
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';
import { topModal } from '@/shared/overlays/controller';
import { PhoneSubagents } from './PhoneSubagents';
import { SubModal } from './SubModal';
import { editSub } from '../actions/subagents';
import { loadPhoneSubagents } from '../runtime/phoneSubagents';
const row = { id: 'builtin', name: '内置协作者', description: '处理分配的工作', instructions: '按目标执行', model_group: 'phone-group', enabled: 'true', builtin: 'true', revision: 'r1' };
const reply = { items: JSON.stringify([row]), groups: JSON.stringify([{ id: 'phone-group', name: '手机专用模型组' }]), delegation_enabled: 'false' };
let host: HTMLDivElement, root: Root, n = 0;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.resetAllMocks(); Object.assign(S, initialState()); S.account = { id: `sub-ui-${++n}` } as typeof S.account; S.cloud = 'signed-in';
  S.agents.dev_a = { ...S.agents.p1, id: 'dev_a', kind: 'phone', real: true, status: 'online' }; S.phoneId = 'dev_a';
  m.rpc.mockResolvedValue(reply); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(element => element.textContent === label || element.getAttribute('aria-label') === label)!;
it('PHONE-01 renders acknowledged phone entries, global delegation state, and builtin delete protection', async () => {
  await act(async () => root.render(<PhoneSubagents />));
  expect(host.textContent).toContain('内置协作者'); expect(host.textContent).toContain('手机专用模型组'); expect(host.textContent).toContain('自动委派总开关已关闭');
  expect(host.textContent).toContain('不会立即运行或终止现有任务'); expect(button('内置子代理不能删除').disabled).toBe(true);
});
it('PHONE-01 shows an explicit permission failure and does not render fake agents', async () => {
  m.rpc.mockRejectedValueOnce(new Error('手机未授予管理权限')); await act(async () => root.render(<PhoneSubagents />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('手机未授予管理权限'); expect(button('新建子代理').disabled).toBe(true);
  expect(host.textContent).not.toContain('内置协作者');
});
it('PHONE-01 demo selection has no edit controls and never invokes RPC', async () => {
  S.phoneId = 'p1'; S.agents.p1.real = false; await act(async () => root.render(<PhoneSubagents />));
  expect(host.textContent).toContain('示例手机不能同步'); expect(host.querySelector('button')).toBeNull(); expect(m.rpc).not.toHaveBeenCalled();
});
it('PHONE-01 uses actual phone model groups, prevents builtin rename, and disables editing after device selection changes', async () => {
  await loadPhoneSubagents('dev_a'); editSub('builtin'); const props = topModal()!.props;
  await act(async () => root.render(<SubModal p={props} />));
  expect(host.textContent).toContain('内置，不可改名'); expect(host.querySelector('input[placeholder="例如：评论回复员"]')).toBeNull();
  expect(host.textContent).toContain('手机专用模型组'); expect(host.textContent).toContain('自动选择');
  await act(async () => update(s => { s.phoneId = 'p1'; }));
  expect(host.querySelector('fieldset')?.disabled).toBe(true); expect(button('保存到手机').disabled).toBe(true);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('所选手机已变化');
});
it('PHONE-01 refresh and mutate controls stay disabled until the phone acknowledges the request', async () => {
  await act(async () => root.render(<PhoneSubagents />)); let resolve!: (value: unknown) => void;
  m.rpc.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  await act(async () => button('停用').click());
  expect(button('停用').disabled).toBe(true); expect(button('正在同步…').disabled).toBe(true); expect(host.textContent).toContain('已启用');
  await act(async () => resolve({ ...reply, items: JSON.stringify([{ ...row, enabled: 'false', revision: 'r2' }]) }));
  expect(button('启用').disabled).toBe(false); expect(host.textContent).toContain('已停用');
});
it('PHONE-01 hides the previous account draft if an old editor survives an account change', async () => {
  await loadPhoneSubagents('dev_a'); editSub('builtin'); const props = topModal()!.props;
  await act(async () => root.render(<SubModal p={props} />)); expect(host.querySelector('textarea')?.value).toBe('按目标执行');
  await act(async () => update(s => { s.account = { id: 'changed-account' } as typeof s.account; }));
  expect(host.querySelector('textarea')).toBeNull(); expect(host.textContent).not.toContain('按目标执行'); expect(button('保存到手机').disabled).toBe(true);
});
