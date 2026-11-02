import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: vi.fn() }));
import { S, update } from '@/state/store';
import { api } from '@/core/client';
import { addAssistant, loadAssistants, storeAssistant } from './catalog';
import { requestPermissionTier, permissionTier, applyPersonalPermission } from './permissions';
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), api: vi.fn(async () => ({})) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => '/assistant') }));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); S.account = { id: 'a', name: 'A', email: '' }; S.cloud = 'signed-in'; S.running = {}; S.convs = []; vi.mocked(api).mockImplementation(async (method) => (method === 'GET' ? { runtime: { has_task: true, is_processing: false } } : {}) as never); });
it('PA-PERM-01 defaults new and legacy unspecified profiles to routine, preserves explicit ask', async () => {
  const a = await addAssistant('A'); expect(permissionTier(a)).toBe('routine');
  a.permission = 'ask'; storeAssistant(a); expect(permissionTier(loadAssistants().items[0])).toBe('ask');
  delete a.permission; storeAssistant(a); expect(permissionTier(loadAssistants().items[0])).toBe('routine');
});
it('PA-PERM-01 defers changes while running and applies only after idle', async () => {
  const a = await addAssistant('A'); a.conversation = 'c'; storeAssistant(a); S.running.c = true as never;
  await requestPermissionTier(a, 'ask'); expect(permissionTier(loadAssistants().items[0])).toBe('routine'); expect(api).not.toHaveBeenCalled();
  update(s => { delete s.running.c; });
  await vi.waitFor(() => expect(permissionTier(loadAssistants().items[0])).toBe('ask'));
  expect(api).toHaveBeenCalledWith('PUT', '/api/conversations/c/config-options/mode', { value: 'default' });
});
it('PA-PERM-01 preserves applied tier when core rejects mode update', async () => {
  const a = await addAssistant('A'); a.conversation = 'c'; storeAssistant(a);
  vi.mocked(api).mockRejectedValueOnce(new Error('offline'));
  await expect(requestPermissionTier(a, 'full')).rejects.toThrow('personal.permission_apply_failed');
  expect(permissionTier(loadAssistants().items[0])).toBe('routine');
});
it('PA-PERM-01 rejects another account profile and account changes during apply', async () => {
  const a = await addAssistant('A'); a.conversation = 'c'; storeAssistant(a);
  vi.mocked(api).mockImplementationOnce(async () => { S.account!.id = 'b'; return {} as never; });
  await expect(requestPermissionTier(a, 'full')).rejects.toThrow('账号已切换');
  S.account!.id = 'a'; expect(permissionTier(loadAssistants().items[0])).toBe('routine');
  S.account!.id = 'b'; await expect(applyPersonalPermission(a)).rejects.toThrow('账号');
});
it('PA-PERM-01 only auto-allows owned structured read requests and honors ask and deny', async () => {
  const { personalAutoAllow, requiresApproval } = await import('./permissions');
  const a = await addAssistant('A'); a.conversation = 'c'; storeAssistant(a);
  const c = { id: 'c', owner: 'pc', title: 'A', updated: 1, messages: [], personal: { id: a.id, name: a.name, directory: a.directory } } as const;
  S.convs = [c as any]; S.prefs.allowInstall = 'ask';
  expect(personalAutoAllow(c as any, 'embedded', 'info')).toBe(true);
  for (const category of ['write', 'delete', 'execute', 'purchase', 'unknown']) expect(personalAutoAllow(c as any, 'embedded', category)).toBe(false);
  expect(personalAutoAllow(c as any, 'acp', 'info')).toBe(false);
  expect(requiresApproval(a)).toBe(false);
  await requestPermissionTier(a, 'ask'); expect(personalAutoAllow(c as any, 'embedded', 'info')).toBe(false); expect(requiresApproval(a)).toBe(true);
  await requestPermissionTier(a, 'full'); S.prefs.allowInstall = 'deny'; expect(personalAutoAllow(c as any, 'embedded', 'info')).toBe(true);
  S.prefs.allowInstall = 'ask'; S.account!.id = 'b'; expect(personalAutoAllow(c as any, 'embedded', 'info')).toBe(false);
});
it('PA-PERM-01 restores a persisted deferred change only when the assistant is idle', async () => {
  const a = await addAssistant('A'); a.conversation = 'c'; a.permissionPending = 'ask'; storeAssistant(a); S.running.c = true as never;
  await applyPersonalPermission(a); expect(permissionTier(loadAssistants().items[0])).toBe('routine');
  update(s => { delete s.running.c; }); await vi.waitFor(() => expect(permissionTier(loadAssistants().items[0])).toBe('ask'));
});
it('PA-PERM-01 persists a deferred failure without retrying on every state update', async () => {
  const a = await addAssistant('A'); a.conversation = 'c'; storeAssistant(a); S.running.c = true as never;
  await requestPermissionTier(a, 'ask'); vi.mocked(api).mockRejectedValueOnce(new Error('offline'));
  update(s => { delete s.running.c; }); await vi.waitFor(() => expect(loadAssistants().items[0].permissionError).toContain('personal.permission_apply_failed'));
  update(); update(); expect(api).toHaveBeenCalledTimes(1); expect(permissionTier(loadAssistants().items[0])).toBe('routine');
});
it('PA-PERM-01 unknown persisted tier cannot silently grant automatic reads', async () => {
  const a = await addAssistant('A'); a.permission = 'untrusted' as never;
  expect(permissionTier(a)).toBe('ask');
});
it('PA-PERM-01 clears remembered approvals before applying a changed tier', async () => {
  const a = await addAssistant('A'); a.conversation = 'c'; storeAssistant(a);
  await requestPermissionTier(a, 'ask');
  expect(vi.mocked(api).mock.calls.map(([method, path]) => [method, path])).toEqual([
    ['GET', '/api/conversations/c'], ['POST', '/api/conversations/c/runtime/restart'], ['PUT', '/api/conversations/c/config-options/mode'],
  ]);
});
it('PA-PERM-01 does not restart a runtime that core reports as processing', async () => {
  const a = await addAssistant('A'); a.conversation = 'c'; storeAssistant(a);
  vi.mocked(api).mockResolvedValueOnce({ runtime: { has_task: true, is_processing: true } } as never);
  await requestPermissionTier(a, 'ask');
  expect(api).toHaveBeenCalledTimes(1); expect(loadAssistants().items[0].permissionPending).toBe('ask');
});
it('PA-PERM-01 explicit full access applies yolo and allows each embedded request without a prompt', async () => {
  const { personalAutoAllow, personalFullAccess } = await import('./permissions');
  const a = await addAssistant('A'); a.conversation = 'c'; storeAssistant(a);
  const c = { id: 'c', remote: true, owner: 'pc', title: 'A', updated: 1, messages: [], personal: { id: a.id, name: a.name, directory: a.directory } } as any;
  S.convs = [c]; await requestPermissionTier(a, 'full');
  expect(api).toHaveBeenCalledWith('PUT', '/api/conversations/c/config-options/mode', { value: 'yolo' });
  expect(personalFullAccess(c)).toBe(true);
  for (const category of ['info','write','delete','execute','purchase']) expect(personalAutoAllow(c,'embedded',category)).toBe(true);
  await requestPermissionTier(a,'ask'); expect(personalFullAccess(c)).toBe(false);
});
it('PA-PERM-01 keeps full access on every send and omits the old publication confirmation prompt', async () => {
  const { ensureTaskPermissions, publicationPolicy } = await import('@/features/settings/runtime/preferences');
  const a = await addAssistant('A'); a.conversation = 'c'; storeAssistant(a);
  const c = { id:'c',remote:true,owner:'pc',title:'A',updated:1,messages:[],personal:{id:a.id,name:a.name,directory:a.directory} } as any;
  S.convs=[c]; await requestPermissionTier(a,'full'); vi.mocked(api).mockClear();
  await ensureTaskPermissions(c);
  expect(api).toHaveBeenCalledWith('PUT','/api/conversations/c/config-options/mode',{value:'yolo'});
  expect(publicationPolicy(c)).toContain('不再逐项请求');
  expect(publicationPolicy(c)).not.toContain('停止执行并等待');
});
it('PA-PERM-01 full access auto answers core confirmations once without another user click',async()=>{
  const { onPermission } = await import('@/features/chat/runtime/permissions');
  const a=await addAssistant('A');a.conversation='c';storeAssistant(a);
  const c={id:'c',remote:true,owner:'pc',title:'A',updated:1,messages:[],personal:{id:a.id,name:a.name,directory:a.directory}} as any;
  S.convs=[c];await requestPermissionTier(a,'full');vi.mocked(api).mockClear();S.prefs.allowInstall='deny';
  onPermission(c,{id:'approval',call_id:'call',command_type:'execute',description:'执行用户任务',options:[{label:'允许一次',value:'proceed_once'},{label:'拒绝',value:'cancel'}]});
  await vi.waitFor(()=>expect(c.messages[0].status).toBe('approved'));
  expect(api).toHaveBeenCalledWith('POST','/api/conversations/c/confirmations/call/confirm',{msg_id:'approval',data:{value:'proceed_once'},always_allow:false});
});

it.each(['ask', 'routine', 'full'] as const)('PA-PERM-01 opens an unloaded %s assistant by ensuring runtime before applying mode', async tier => {
  const a = await addAssistant('Cold start'); a.conversation = `cold-${tier}`; a.permission = tier; storeAssistant(a);
  let active = false;
  vi.mocked(api).mockImplementation(async (_method, path) => {
    if (path.endsWith('/runtime/ensure')) { active = true; return {} as never; }
    if (path.endsWith('/config-options/mode')) {
      if (!active) throw new Error('No active agent for this conversation');
      return {} as never;
    }
    throw new Error(`Unexpected request ${path}`);
  });
  await expect(applyPersonalPermission(a)).resolves.toBeUndefined();
  expect(permissionTier(loadAssistants().items[0])).toBe(tier);
  expect(api).toHaveBeenCalledWith('PUT', `/api/conversations/cold-${tier}/config-options/mode`, { value: tier === 'full' ? 'yolo' : 'default' });
});

it.each(['startup-failed', 'account-changed'])('PA-PERM-01 cold-start %s does not configure or save a successful tier', async reason => {
  const a = await addAssistant('Cold failure'); a.conversation = 'cold-failure'; a.permission = 'ask'; storeAssistant(a);
  vi.mocked(api).mockImplementation(async () => {
    if (reason === 'startup-failed') throw new Error('startup failed');
    S.account!.id = 'another'; return {} as never;
  });
  await expect(applyPersonalPermission(a)).rejects.toThrow();
  expect(vi.mocked(api).mock.calls.some(([method]) => method === 'PUT')).toBe(false);
  S.account!.id = 'a'; expect(permissionTier(loadAssistants().items[0])).toBe('ask');
});
