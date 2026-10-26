import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { convFromCore } from '@/features/chat/runtime/history';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn(), rpc: vi.fn(), refresh: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('./phoneChat', () => ({ sendPhone: vi.fn(), refreshPhoneChat: m.refresh }));
const { stopTask } = await import('@/features/chat/runtime/cancel');
const { savePhoneGallery } = await import('./phoneFiles');
const { syncPhoneName } = await import('./deviceName');
beforeEach(() => {
  vi.resetAllMocks(); S.convs = []; S.teams = []; S.running = {};
  S.cloud = 'signed-in'; S.account = { id: 'account' } as typeof S.account;
});
it('D13 restart restores parents from core metadata and stops children despite empty running cache', async () => {
  S.convs = ['leader','child'].map(id => convFromCore({ id, name: id, type: 'acp', created_at: 0, modified_at: 0, extra: { agent_id: 'test', ...(id === 'child' ? { lom_parent: 'leader' } : {}) } }));
  m.api.mockImplementation(async (method, path) => ({ runtime: { is_processing: method === 'GET' && path.includes('child'), turn_id: 'current' } }));
  expect(await stopTask('leader')).toBe(true);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/child/cancel', { turn_id: 'current' }, expect.anything());
});
it('D13 failed child cancellation is not success and relationship survives retry', async () => {
  S.convs = [{ id: 'leader' }, { id: 'child', remote: true, parentTask: 'leader' }].map(x => ({ owner:'pc', title:'t', updated:0, messages:[], ...x } as Conv));
  m.api.mockImplementation(async (method, path) => { if (method === 'POST') throw Error('offline'); return { runtime: { is_processing: path.includes('child'), turn_id:'live' } }; });
  expect(await stopTask('leader')).toBe(false);
  expect(await stopTask('leader')).toBe(false);
  expect(m.api.mock.calls.filter(x => x[0] === 'POST')).toHaveLength(2);
});
it('D13 recovered phone is queried and cancelled; unrelated phone is untouched', async () => {
  S.convs = [{ id:'leader', owner:'pc' }, { id:'child', owner:'dev_test', phoneSession:'session', parentTask:'leader' }, { id:'other', owner:'dev_other', phoneSession:'other' }].map(x=>({ title:'t', updated:0, messages:[], ...x } as Conv));
  m.api.mockResolvedValue({ runtime: { is_processing:false, turn_id:null } });
  m.refresh.mockImplementationOnce(async c => { S.running[c.id] = true; }).mockImplementationOnce(async c => { S.running[c.id] = false; });
  expect(await stopTask('leader')).toBe(true);
  expect(m.rpc).toHaveBeenCalledExactlyOnceWith('dev_test','chat.cancel',{session_id:'session'});
});
it('D13 gallery requires matching durable media receipt', async () => {
  m.rpc.mockResolvedValue({ id:'f',status:'saved',uri:'content://media/external/images/media/1' });
  expect((await savePhoneGallery('dev','f')).status).toBe('saved');
  m.rpc.mockResolvedValue({ id:'f', status:'accepted',uri:'' });
  await expect(savePhoneGallery('dev','f')).rejects.toThrow('尚未确认');
});
it('D13 phone name only confirms an exact acknowledgment, stale rename is refused', async () => {
  S.agents.dev_test = { ...S.agents.p1, id:'dev_test',name:'新名称',real:true };
  m.rpc.mockResolvedValue({name:'新名称'});
  await syncPhoneName('dev_test','新名称');
  await expect(syncPhoneName('dev_test','旧名称')).rejects.toThrow('已更新');
  m.rpc.mockResolvedValue({name:'其他'});
  await expect(syncPhoneName('dev_test','新名称')).rejects.toThrow('尚未确认');
});
it('D13 recovery reads later conversation pages instead of losing older delegated children', async () => {
  const { listTasks } = await import('@/features/chat/runtime/history');
  // 按请求路径应答：任务列表同时会读一次归档状态（侧栏接口），不再依赖调用顺序
  m.api.mockImplementation(async (_method: string, path: string) => path === '/api/conversations?limit=200'
    ? {items:[{id:'leader',name:'l',type:'aionrs',created_at:0,modified_at:0}],has_more:true}
    : path === '/api/conversations?limit=200&cursor=leader'
      ? {items:[{id:'older-child',name:'c',type:'acp',created_at:0,modified_at:0,extra:{agent_id:'test',lom_parent:'leader'}}],has_more:false}
      : {groups:[]});
  expect((await listTasks())[1]).toMatchObject({id:'older-child',parentTask:'leader'});
  expect(m.api).toHaveBeenCalledWith('GET','/api/conversations?limit=200&cursor=leader');
});
it('D13 unreachable leader does not prevent attempting phone cancellation', async () => {
  S.convs = [{id:'leader',owner:'pc'}, {id:'child',owner:'dev_test',phoneSession:'s',parentTask:'leader'}].map(x=>({title:'t',updated:0,messages:[],...x} as Conv));
  m.api.mockRejectedValue(Error('core unavailable'));
  m.refresh.mockImplementationOnce(async c=>{S.running[c.id]=true;}).mockImplementationOnce(async c=>{S.running[c.id]=false;});
  expect(await stopTask('leader')).toBe(false);
  expect(m.rpc).toHaveBeenCalledWith('dev_test','chat.cancel',{session_id:'s'});
});
