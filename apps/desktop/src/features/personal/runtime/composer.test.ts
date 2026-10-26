vi.mock('@/features/account/runtime/serviceConfig', () => ({ cloudConfigured: () => true, LOM_CLOUD_URL: 'https://service.example.invalid', requireCloudService: () => {}, CLOUD_UNAVAILABLE: '后端未包含' }));
import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { send, pickModel, pickPerm, runKeyOf } from '@/features/chat/actions/composer';
import { sendToTask, applyModeToTask, applyModelToTask } from '@/features/chat/runtime/tasks';
import { MENUS } from '@/app/overlays/menu-registry';
import { storeAssistant } from './catalog';
import { attachFiles } from '@/features/chat/actions/attachments';
import { uploadFile } from '@/core/client';
vi.mock('@/features/chat/runtime/tasks', async load => ({ ...await load<typeof import('@/features/chat/runtime/tasks')>(), sendToTask: vi.fn(async () => true), applyModeToTask: vi.fn(async () => true), applyModelToTask: vi.fn(async () => true) }));
vi.mock('@/features/account/runtime/cloud', async load => ({ ...await load<typeof import('@/features/account/runtime/cloud')>(), ensureCloudConfig: vi.fn(async () => {}) }));
vi.mock('@/core/client', async load => ({ ...await load<typeof import('@/core/client')>(), uploadFile: vi.fn(async () => '/upload/image.png') }));
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  S.activeConv = 'main'; S.route = { name: 'chat' }; S.mode = 'phone'; S.folder = '/main'; S.workspaceBrowseRoot = '/main-preview';
  S.convs = [{ id: 'assistant', owner: 'pc', title: '小麓', messages: [], updated: 1, remote: true, personal: { id: 'pa_a', name: '小麓', directory: '/a' } }];
  S.drafts = { 'personal:pa_a': '只给小麓', 'conv:main': '主任务草稿' }; S.attachments = {}; S.running = {};
  storeAssistant({ id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a', conversation: 'assistant' });
});
it('PA02 sends personal drafts to the mapped conversation while preserving all main navigation', async () => {
  await send('personal:pa_a');
  expect(sendToTask).toHaveBeenCalledWith(S.convs[0], '只给小麓', []);
  expect(S.drafts['personal:pa_a']).toBe(''); expect(S.drafts['conv:main']).toBe('主任务草稿');
  expect(S.activeConv).toBe('main'); expect(S.folder).toBe('/main'); expect(S.workspaceBrowseRoot).toBe('/main-preview'); expect(S.route).toEqual({ name: 'chat' });
  expect(runKeyOf('personal:pa_a')).toBe('assistant');
});
it('PA02 personal permission and model menus target the assistant rather than the main task', async () => {
  S.permission = 'readonly'; await pickPerm('auto', 'personal:pa_a'); await pickModel({ model: 'lom-pro', agent: 'pc', ckey: 'personal:pa_a' });
  expect(applyModeToTask).not.toHaveBeenCalled(); expect(S.permission).toBe('readonly'); expect(applyModelToTask).toHaveBeenCalledWith('assistant', 'lom-pro');
  expect(S.activeConv).toBe('main');
});
it('PA02 personal attachments upload to the assistant conversation even while the main view is phone mode', async () => {
  await attachFiles('personal:pa_a', [new File(['notes'], 'notes.txt', { type: 'text/plain' })]);
  expect(uploadFile).toHaveBeenCalledWith(expect.any(File), 'notes.txt', 'assistant');
  expect(S.attachments['personal:pa_a'][0].path).toBe('/upload/image.png');
});
it('PA02 account menu opens the panel only when signed in', () => {
  const items = MENUS.account({}); const entry = items.find(x => typeof x !== 'string' && x.label === 'Personal Agent');
  expect(entry && typeof entry !== 'string' && !entry.header && !entry.disabled).toBe(true);
  if (entry && typeof entry !== 'string' && !entry.header) entry.onSelect?.();
  expect(S.personalPanel?.account).toBe('owner');
  S.cloud = 'signed-out'; S.account = null;
  expect(MENUS.account({}).some(x => typeof x !== 'string' && x.label === 'Personal Agent')).toBe(false);
});

it('PA02 stale assistant model menus cannot fall back to the global model', async () => {
  S.model = 'main-model'; S.convs = [];
  await pickModel({ model: 'new-model', ckey: 'personal:pa_a' });
  expect(S.model).toBe('main-model'); expect(applyModelToTask).not.toHaveBeenCalled();
});
