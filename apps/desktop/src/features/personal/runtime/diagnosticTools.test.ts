import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
const m = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), api: vi.fn() }));
vi.mock('@/features/phones/runtime/phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@/core/client', () => ({ api: m.api }));
import { personalDiagnosticTool } from './diagnosticTools';
const call = (name: string, args = {}, current = () => true) => personalDiagnosticTool(name, args, current);
beforeEach(() => {
  vi.resetAllMocks();
  S.agents = { dev_a: { id: 'dev_a', name: 'Phone', real: true, status: 'online' } } as unknown as typeof S.agents;
  S.cloud = 'signed-in'; S.cloudVision = ['pro']; S.cloudModels = { pro: 'vision', max: '', mini: '' };
});
it('PA-VISION-02 discovers paired phones and returns real status, offline never calls phone', async () => {
  expect((await call('phone_list'))?.content[0].text).toContain('dev_a');
  m.rpc.mockResolvedValue({ battery: '42' });
  expect((await call('phone_status', { device: 'dev_a' }))?.content[0].text).toContain('42');
  S.agents.dev_a.status = 'offline'; m.rpc.mockClear();
  expect((await call('phone_status', { device: 'dev_a' }))?.content[0].text).toContain('false');
  expect(m.rpc).not.toHaveBeenCalled();
});
it('PA-VISION-02 status diagnosis keeps pairing distinct from unavailable keychain and unknown remote status', async () => {
  for (const code of ['remote.repair_required', 'remote.trust_store_unavailable', 'remote.method_unknown']) {
    m.rpc.mockRejectedValue(new Error(code));
    const result = await call('phone_status', { device: 'dev_a' });
    expect(result?.isError).toBe(true); expect(result?.content[0].text).toContain(code);
  }
});
it('PA-VISION-02 stopped or removed phone never leaks status, including late replies', async () => {
  expect((await call('phone_status', { device: 'dev_missing' }))?.isError).toBe(true);
  expect((await call('phone_status', { device: 'dev_a' }, () => false))?.isError).toBe(true);
  let current = true;
  m.rpc.mockImplementation(async () => { current = false; return { battery: 'secret-late' }; });
  const result = await call('phone_status', { device: 'dev_a' }, () => current);
  expect(result?.isError).toBe(true); expect(result?.content[0].text).not.toContain('secret-late');
});
it('PA-VISION-02 image tool delivers explicit model description and never substitutes OCR', async () => {
  m.api.mockResolvedValue([{ name: 'Lom 云端', enabled: true, api_key: 'test-key' }]);
  m.invoke.mockResolvedValue('图中是一只红色鸟');
  const result = await call('lom_view_image', { file_path: '/tmp/test.png' });
  expect(result?.content[0].text).toContain('看图模型描述');
  expect(result?.content[0].text).toContain('红色鸟');
});
