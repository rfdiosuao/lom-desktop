vi.mock('@/features/skills/runtime/conversationSkills', () => ({ conversationSkills: vi.fn(async () => ({ enabled_skills: ['fixture-personal'] })) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { api } from '@/core/client';
import { invoke } from '@tauri-apps/api/core';
import { addAssistant, loadAssistants } from './catalog';
import { ensureConversation, linkWorkspace } from './session';
import { documentDrafts, readDocument, listDiary, saveDocument } from './memory';
vi.mock('@/features/phones/runtime/phoneCommander', async load => ({ ...await load<typeof import('@/features/phones/runtime/phoneCommander')>(), ensurePersonalBridge: vi.fn(async () => {}), personalExtra: vi.fn(async () => ({ lom_personal_scope: 'pa-test', selected_mcp_server_ids: ['mcp_bridge'] })) }));
vi.mock('@/core/client', async importOriginal => ({ ...await importOriginal<typeof import('@/core/client')>(), api: vi.fn(), getEndpoint: () => ({ defaultFolder: '/work' }) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock('@/features/chat/runtime/tasks', () => ({ openTask: vi.fn() }));
vi.mock('@/features/chat/runtime/history', () => ({ convFromCore: (c: any) => ({ id: c.id, owner: 'pc', remote: true, workspace: c.extra?.workspace, messages: [], loaded: true, modelId: 'cloud::pro' }) }));
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  S.account = { id: 'account-a', email: '', name: 'A' }; S.cloud = 'signed-in';
  S.providers = [{ id: 'cloud', name: 'Lom 云端', enabled: true, models: ['pro'] } as any];
  S.cloudModels = { pro: 'pro', max: 'max', mini: 'mini' }; S.model = 'cloud::pro';
  vi.mocked(invoke).mockResolvedValue('/data/a/assistant');
});
describe('PA02 personal assistants', () => {
  it('PA02 isolates profiles by signed-in account and restores each assistant', async () => {
    const a = await addAssistant('小麓');
    expect(loadAssistants().items[0].id).toBe(a.id);
    S.account!.id = 'account-b'; expect(loadAssistants().items).toEqual([]);
    await addAssistant('工作助理');
    S.account!.id = 'account-a'; expect(loadAssistants().items.map(x => x.name)).toEqual(['小麓']);
  });
  it('PA02 does not create an assistant if its native directory fails', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('no permission'));
    await expect(addAssistant('小麓')).rejects.toThrow('no permission');
    expect(loadAssistants().items).toEqual([]);
  });
  it('PA-CREATE reports unreadable local profiles as damaged instead of an unknown failure', () => {
    localStorage.setItem('lom.personal.v1:account-a', '{"items":[{');
    expect(() => loadAssistants()).toThrow('助理配置损坏，请先恢复备份');
    localStorage.setItem('lom.personal.v1:account-a', 'null');
    expect(() => loadAssistants()).toThrow('助理配置损坏，请先恢复备份');
  });
  it('PA-CREATE keeps a disabled storage error out of the damaged-profile branch', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    try { expect(() => loadAssistants()).toThrow(DOMException); } finally { getItem.mockRestore(); }
  });
  it('PA02 deduplicates conversation creation and restores the same remote id', async () => {
    const a = await addAssistant('小麓');
    vi.mocked(api).mockImplementation(async (method, path, body: any) => {
      if (method === 'POST' && path === '/api/conversations') return { id: 'conv-a', type: 'aionrs', extra: body.extra, model: { provider_id: 'cloud', model: 'pro' } } as never;
      if (method === 'GET') return { id: 'conv-a', type: 'aionrs', extra: { lom_personal: a.id, lom_personal_directory: a.directory }, model: { provider_id: 'cloud', model: 'pro' } } as never;
      return '' as never;
    });
    const ids = await Promise.all([ensureConversation(a), ensureConversation(a)]);
    expect(ids).toEqual(['conv-a', 'conv-a']);
    expect(vi.mocked(api).mock.calls.filter(x => x[0] === 'POST' && x[1] === '/api/conversations')).toHaveLength(1);
    expect(loadAssistants().items[0].conversation).toBe('conv-a');
  });
  it('PA02 preserves external document changes instead of overwriting them', async () => {
    const a = await addAssistant('小麓'); vi.mocked(api).mockResolvedValue('outside change');
    await expect(saveDocument(a, 'SOUL.md', 'old', 'new')).rejects.toThrow('已被修改');
    expect(vi.mocked(api).mock.calls.some(x => x[1] === '/api/fs/write')).toBe(false);
  });
  it('PA02 never retries an uncertain conversation creation as a second conversation', async () => {
    const a = await addAssistant('小麓');
    vi.mocked(api).mockImplementation(async (method, path) => {
      if (method === 'POST' && path === '/api/conversations') throw new Error('receipt lost');
      return '' as never;
    });
    await expect(ensureConversation(a)).rejects.toThrow('receipt lost');
    const stored = loadAssistants().items[0];
    await expect(ensureConversation(stored)).rejects.toThrow('尚未确认');
    expect(vi.mocked(api).mock.calls.filter(x => x[1] === '/api/conversations')).toHaveLength(1);
  });
  it('PA02 refuses documents from another signed-in account', async () => {
    const a = await addAssistant('小麓'); S.account!.id = 'other-account';
    await expect(saveDocument(a, 'SOUL.md', 'old', 'new')).rejects.toThrow('账号已切换');
    expect(api).not.toHaveBeenCalled();
  });

});

it('PA02 links a workspace without resending immutable skill or MCP snapshots', async () => {
  const a = await addAssistant('小麓'); a.conversation = 'conv-a';
  S.activeConv = 'main'; S.folder = '/main';
  const immutable = { skills: [], mcp_server_ids: [], mcp_servers: [], mcp_statuses: {}, session_mcp_servers: [] };
  vi.mocked(api).mockImplementation(async (method, _path, body: any) => {
    if (method === 'GET') return { id: 'conv-a', type: 'aionrs', extra: { ...immutable, lom_personal: a.id, lom_personal_directory: a.directory, workspace: '/old' } } as never;
    if (Object.keys(immutable).some(key => key in body.extra)) throw new Error('immutable post-creation');
    return { id: 'conv-a', extra: { ...immutable, ...body.extra } } as never;
  });
  await linkWorkspace(a, '/selected');
  expect(api).toHaveBeenLastCalledWith('PATCH', '/api/conversations/conv-a', { extra: { workspace: '/selected' } });
  expect(loadAssistants().items[0].workspace).toBe('/selected');
  expect(S.folder).toBe('/main'); expect(S.activeConv).toBe('main');
});

it('PA02 composer folder selection links the assistant instead of the active background task', async () => {
  const a = await addAssistant('小麓'); a.conversation = 'assistant';
  const { storeAssistant } = await import('./catalog'); storeAssistant(a);
  S.convs = [{ id: 'assistant', owner: 'pc', title: '小麓', messages: [], updated: 1, remote: true, personal: { id: a.id, name: a.name, directory: a.directory } }];
  S.activeConv = 'background'; S.folder = '/background';
  vi.mocked(api).mockImplementation(async (method, _path, body: any) => ({ id: 'assistant', type: 'aionrs', extra: { lom_personal: a.id, lom_personal_directory: a.directory, workspace: method === 'PATCH' ? body.extra.workspace : '/old' } }) as never);
  const { pickFolderPath } = await import('@/features/chat/actions/composer');
  await pickFolderPath('/assistant-project', `personal:${a.id}`);
  expect(api).toHaveBeenLastCalledWith('PATCH', '/api/conversations/assistant', { extra: { workspace: '/assistant-project' } });
  expect(S.folder).toBe('/background'); expect(S.activeConv).toBe('background');
});

it('PA02 drops pending document reads and drafts after same-account reauthentication', async () => {
  const { beginAuthChange } = await import('@/features/account/runtime/authScope');
  const a = await addAssistant('小麓');
  documentDrafts.set('soul', { base: 'old', value: 'private draft' });
  let finish!: (value: any) => void;
  vi.mocked(api).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const read = readDocument(a, 'SOUL.md'); beginAuthChange(); finish('old account data');
  await expect(read).rejects.toThrow('账号已切换'); expect(documentDrafts.get('soul')).toBeUndefined();
  const list = listDiary(a); beginAuthChange(); finish([]);
  await expect(list).rejects.toThrow('账号已切换');
});

it('PA-IDENTITY new Personal sessions use shared Lom identity and upstream auto-skill exclusions', async () => {
  const a = await addAssistant('小麓');
  vi.mocked(api).mockImplementation(async (method, path, body: any) => {
    if (method === 'POST' && path === '/api/conversations') return {id:'identity-new',type:'aionrs',extra:body.extra,model:{provider_id:'cloud',model:'pro'}} as never;
    return '' as never;
  });
  await ensureConversation(a);
  const body = vi.mocked(api).mock.calls.find(x=>x[0]==='POST'&&x[1]==='/api/conversations')?.[2] as any;
  expect(body.extra.enabled_skills).toEqual(['fixture-personal']);
  expect(body.extra.preset_rules).toContain('只以麓鸣 Lom 的身份');
  expect(body.extra.exclude_auto_inject_skills).toContain('aionui-config');
  expect(body.extra.preset_rules).toContain('先调用 session_list');
});
