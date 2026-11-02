import { beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';

const m = vi.hoisted(() => ({ api: vi.fn(), endpoint: { url: 'http://core', token: 't', defaultFolder: '/work' }, toast: vi.fn(), toastError: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => m.endpoint }));
vi.mock('@/shared/overlays/controller', () => ({ toast: m.toast, toastError: m.toastError, openModal: vi.fn() }));
const { probeAgentOptions, loadConvOptions, setConvOption } = await import('./agentOptions');
const { externalModel, externalEffort } = await import('./agents');
const { startDesktopTask } = await import('@/features/chat/runtime/tasks');
const { prepareAgentTask } = await import('./agentWarmup');

const codex = { id: 'ag_codex', name: 'Codex CLI', backend: 'codex', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' as const };
const options = [
  { id: 'mode', category: 'mode', current_value: 'auto', options: [{ value: 'auto' }] },
  { id: 'model', category: 'model', current_value: 'gpt-6.1-sol', options: [{ value: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }, { value: 'gpt-5.6-luna', name: 'GPT-5.6 Luna' }] },
  { id: 'thought_level', category: 'thought_level', current_value: 'balanced', options: [{ value: 'fast', name: 'Fast' }, { value: 'balanced', name: 'Balanced' }, { value: 'deep', name: 'Deep' }] },
];

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  S.cloud = 'signed-in'; S.agentCatalog = [codex]; S.agentPick = 'ag_codex'; S.agentModelPick = {}; S.agentEffortPick = {}; S.agentOptions = {}; S.convs = [];
  m.api.mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    if (method === 'POST' && path === '/api/conversations') return { id: body?.name === 'lom-probe' ? 'probe1' : 'c1', name: 't', type: 'acp', created_at: 1, modified_at: 1, extra: body?.extra };
    if (path.endsWith('/runtime/ensure')) return { config_options: options };
    if (method === 'PUT') return { confirmation: 'observed', config_options: null };
    return {};
  });
});

it('D07 picking an external agent reads its own configured model and the composer shows it', async () => {
  expect(externalModel('home')?.label).toBe('');
  await probeAgentOptions(codex);
  const probe = m.api.mock.calls.find(c => c[1] === '/api/conversations')![2];
  expect(probe.extra).toMatchObject({ lom_probe: true, agent_id: 'ag_codex' });
  expect(m.api.mock.calls.some(c => c[0] === 'DELETE' && c[1] === '/api/conversations/probe1')).toBe(true);
  expect(externalModel('home')).toMatchObject({ current: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' });
});

it('D07 a model picked on the new-task page is passed when the task is created', async () => {
  await probeAgentOptions(codex);
  S.agentModelPick.ag_codex = 'gpt-5.6-luna';
  expect(externalModel('home')?.label).toBe('GPT-5.6 Luna');
  await startDesktopTask('hi', []);
  const create = m.api.mock.calls.filter(c => c[1] === '/api/conversations').map(c => c[2]).find(b => b.name !== 'lom-probe');
  expect(create.extra.current_model_id).toBe('gpt-5.6-luna');
});

it('D07 inside a task the model is read from the session and switched there', async () => {
  const c = { id: 'c9', owner: 'pc', title: 't', updated: 1, messages: [], remote: true, agentId: 'ag_codex', agentName: 'Codex CLI' };
  S.convs = [c];
  await loadConvOptions(c);
  expect(externalModel('conv:c9')?.label).toBe('GPT-6.1 Sol');
  m.api.mockResolvedValueOnce({ confirmation: 'observed', config_options: options.map(o => o.id === 'model' ? { ...o, current_value: 'gpt-5.6-luna' } : o) });
  await setConvOption(c, 'model', 'gpt-5.6-luna');
  expect(m.api).toHaveBeenCalledWith('PUT', '/api/conversations/c9/config-options/model', { value: 'gpt-5.6-luna' });
  expect(externalModel('conv:c9')?.label).toBe('GPT-5.6 Luna');
});


it('EFFORT-01 the tier preselected for a new external task reaches the core at creation', async () => {
  await probeAgentOptions(codex);
  S.agentEffortPick.ag_codex = 'deep';
  const id = await startDesktopTask('hi', []);
  const create = m.api.mock.calls.filter(c => c[1] === '/api/conversations').map(c => c[2]).find(b => b.name !== 'lom-probe');
  expect(create.extra.thought_level).toBe('deep');
  expect(id).toBe('c1');
  expect(S.convs[0].effort).toBe('deep');
  expect(m.toastError).not.toHaveBeenCalled();
});

it('EFFORT-01 a core that does not echo the tier is reported as unconfirmed, never as success', async () => {
  await probeAgentOptions(codex);
  S.agentEffortPick.ag_codex = 'deep';
  m.api.mockImplementation(async (method: string, path: string) => {
    if (method === 'POST' && path === '/api/conversations') {
      return { id: 'c1', name: 't', type: 'acp', created_at: 1, modified_at: 1, extra: { backend: 'codex', agent_id: 'ag_codex', agent_name: 'Codex CLI' } };
    }
    return { turn_id: 't' };
  });
  await startDesktopTask('hi', []);
  expect(m.toastError.mock.calls.map(c => String(c[0])).join(' ')).toContain('无法确认');
  expect(S.convs[0].effort).toBeUndefined();
});

it('EFFORT-01 a pick the CLI no longer reports is not sent and is cleared', async () => {
  await probeAgentOptions(codex);
  S.agentEffortPick.ag_codex = 'removed-tier';
  await startDesktopTask('hi', []);
  const create = m.api.mock.calls.filter(c => c[1] === '/api/conversations').map(c => c[2]).find(b => b.name !== 'lom-probe');
  expect(create.extra.thought_level).toBeUndefined();
  expect(S.agentEffortPick.ag_codex).toBeUndefined();
  expect(m.toast.mock.calls.map(c => String(c[0])).join(' ')).toContain('默认值');
});

it('EFFORT-01 an empty live option list falls back to the cache instead of claiming unsupported', async () => {
  await probeAgentOptions(codex);
  const c = { id: 'c9', owner: 'pc', title: 't', updated: 1, messages: [], remote: true, agentId: 'ag_codex', agentName: 'Codex CLI' };
  S.convs = [c];
  S.agentOptions[c.id] = [];
  expect(externalEffort('conv:c9')).toMatchObject({ state: 'unloaded', label: 'Balanced' });
});

it('EFFORT-01 home ignores a pick the Agent no longer reports', async () => {
  await probeAgentOptions(codex);
  S.agentEffortPick.ag_codex = 'removed-tier';
  expect(externalEffort('home')).toMatchObject({ current: 'balanced', label: 'Balanced' });
});

it('D07 first send adopts the prepared Codex conversation and posts the user prompt exactly once', async () => {
  S.folder = '/work';
  const dispose = prepareAgentTask(codex, '/work');
  await Promise.resolve();
  const id = await startDesktopTask('first prompt', []);
  dispose();
  await vi.waitFor(() => expect(m.api.mock.calls.filter(c => c[1].endsWith('/messages'))).toHaveLength(1));
  expect(id).toBe('probe1');
  expect(m.api.mock.calls.filter(c => c[0] === 'POST' && c[1] === '/api/conversations')).toHaveLength(1);
  expect(m.api.mock.calls.some(c => c[0] === 'DELETE' && c[1] === '/api/conversations/probe1')).toBe(false);
  expect(S.convs[0]).toMatchObject({ id: 'probe1', title: 'first prompt', agentId: 'ag_codex' });
});

it('EFFORT-01 external task rejects a reasoning_effort echo as confirmation of thought_level', async () => {
  await probeAgentOptions(codex);
  S.agentEffortPick.ag_codex = 'deep';
  const original = m.api.getMockImplementation()!;
  m.api.mockImplementation(async (method, path, body) => {
    if (method === 'POST' && path === '/api/conversations') return { id: 'mismatch', type: 'acp', extra: { reasoning_effort: 'deep' } };
    return original(method, path, body);
  });
  await startDesktopTask('hi', []);
  const create = m.api.mock.calls.filter(c => c[0] === 'POST' && c[1] === '/api/conversations').at(-1)![2];
  expect(create.extra.thought_level).toBe('deep');
  expect(create.extra.reasoning_effort).toBeUndefined();
  expect(m.toastError).toHaveBeenCalledWith(expect.stringContaining('无法确认'), 'extra.thought_level 未回显');
});
