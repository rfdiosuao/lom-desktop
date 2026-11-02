import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), cloud: vi.fn(), api: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/features/account/runtime/cloud', () => ({ cloud: mocks.cloud, ensureLomSelection: vi.fn() }));
vi.mock('@/core/client', () => ({ api: mocks.api }));
const { phoneRpc } = await import('./phoneRpc');
const { syncPhoneModel } = await import('./phoneModel');
const { loadPhoneCache, savePhoneCache } = await import('./phoneCache');
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); S.cloud='signed-in'; S.account={id:'account-a',name:'A',email:''};
  S.model='own::test-model';
  // 未单独选择手机模型：允许跟随电脑当前模型（ST05 明确保留的路径）
  S.phoneModel='';
  S.providers=[{id:'own',name:'My Key',platform:'openai',base_url:'',models:['test-model'],enabled:true,created_at:0}];
  mocks.invoke.mockImplementation(async (name: string, args: Record<string, unknown>) => name==='remote_seal'
    ? { id: args.id, ciphertext: 'OPAQUE', sender:'a',recipient:'b',ephemeral:'c',signature:'s' }
    : JSON.stringify({status:'ok',payload:'{"status":"saved"}',error:''}));
  mocks.cloud.mockImplementation(async (_method: string, _path: string, envelope: unknown) => envelope);
  mocks.api.mockResolvedValue([{id:'own',enabled:true,models:['test-model'],api_key:'BYOK_FIXTURE',base_url:'https://fixture.invalid/v1',platform:'openai'}]);
});
it('sends only an encrypted envelope to cloud; uses actual BYOK without fallback', async () => {
  await syncPhoneModel('dev_a');
  const plaintext=JSON.parse(mocks.invoke.mock.calls.find(x=>x[0]==='remote_seal')![1].text);
  expect(JSON.parse(plaintext.payload)).toMatchObject({api_key:'BYOK_FIXTURE',model:'test-model'});
  expect(JSON.stringify(mocks.cloud.mock.calls)).not.toContain('BYOK_FIXTURE');
  expect(mocks.cloud.mock.calls[0][2].ciphertext).toBe('OPAQUE');
});
it('missing BYOK never falls back to built-in points model', async () => {
  mocks.api.mockResolvedValue([{id:'builtin',enabled:true,models:['test-model'],api_key:'POINTS_KEY'}]);
  await expect(syncPhoneModel('dev_a')).rejects.toThrow('缺少');
  expect(mocks.cloud).not.toHaveBeenCalled();
});
it('rejects reply for another request before decrypting', async () => {
  mocks.cloud.mockResolvedValue({id:'other'});
  await expect(phoneRpc('dev_a','chat.list',{})).rejects.toThrow('不匹配');
  expect(mocks.invoke.mock.calls.filter(x=>x[0]==='remote_open')).toHaveLength(0);
});
it('reports revision conflict without silently retrying and keeps its error code', async () => {
  mocks.invoke.mockImplementation(async (name: string, a: Record<string, unknown>) => name==='remote_seal' ? {id:a.id} : JSON.stringify({status:'error',error:'sync.conflict',payload:'{}'}));
  await expect(phoneRpc('dev_a','document.write',{})).rejects.toMatchObject({ message: expect.stringContaining('未覆盖'), code: 'sync.conflict' });
  expect(mocks.cloud).toHaveBeenCalledTimes(1);
});
it('account switch cannot receive an old account reply', async () => {
  mocks.cloud.mockImplementation(async (_a: string,_b: string,e: unknown) => { S.account={id:'other',name:'Other',email:''}; return e; });
  await expect(phoneRpc('dev_a','chat.list',{})).rejects.toThrow('账号已切换');
});
it('persists phone history locally and isolates signed-out or other accounts', async () => {
  loadPhoneCache();
  S.convs.push({id:'cache-fixture',owner:'dev_a',phoneSession:'s',title:'test',updated:1,messages:[{id:'m',type:'assistant',text:'phone reply',at:1}]});
  await savePhoneCache();
  S.cloud='signed-out'; loadPhoneCache(); expect(S.convs.some(c=>c.id==='cache-fixture')).toBe(false);
  S.cloud='signed-in'; S.account={id:'account-b',name:'B',email:''}; loadPhoneCache(); expect(S.convs.some(c=>c.id==='cache-fixture')).toBe(false);
  S.account={id:'account-a',name:'A',email:''}; loadPhoneCache(); expect(S.convs.find(c=>c.id==='cache-fixture')?.messages[0].text).toBe('phone reply');
});
