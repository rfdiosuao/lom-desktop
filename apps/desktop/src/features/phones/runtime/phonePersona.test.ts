import { expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('./phoneRpc', () => ({ phoneRpc: rpc }));
vi.mock('./phoneCache', () => ({ savePhoneCache: vi.fn() }));
import { syncPhoneDocuments, writePhoneDocument } from './phoneDocuments';
import { S, update } from '@/state/store';
import { personaOf } from '@/state/selectors';
it('D11 手机同步、桌面保存及清空灵魂文档更新人格状态，草稿不算已保存', async () => {
  const id = 'dev_d11';
  S.cloud = 'signed-in'; S.account = { id: 'persona-account', name: 'Persona', email: '' };
  update(s => { s.agents[id] = { id, kind: 'phone', name: 'Phone', persona: '', real: true, status: 'online' }; s.soulDirty = {}; s.modals = []; s.phoneId = id; });
  rpc.mockImplementation(async (_id, method, args) => method === 'document.list' ? { items: [{ name: 'SOUL.md', revision: '1' }] } : { name: 'SOUL.md', text: method === 'document.write' ? args.text : '# 自定义身份', revision: '1', modified: 1 });
  await syncPhoneDocuments(id); expect(personaOf(S.agents[id])).toBe('已配置人格');
  update(s => { s.souls[id] = ''; s.soulDirty[id] = true; });
  expect(personaOf(S.agents[id])).toBe('已配置人格');
  await writePhoneDocument(id, 'SOUL.md', ''); expect(personaOf(S.agents[id])).toBe('未配置人格');
});
