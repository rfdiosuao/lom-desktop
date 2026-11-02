import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CoreAskAnswer, CoreConfirmation } from '@/core/types';
import type { Conv, Msg } from '@/state/types';
import { S } from '@/state/store';
const mock = vi.hoisted(() => ({ api: vi.fn(), toastError: vi.fn() }));
vi.mock('@/core/client', () => ({ api: mock.api, getEndpoint: () => null }));
vi.mock('@/features/workspace/runtime/workspace', () => ({ refreshWorkspace: vi.fn() }));
vi.mock('@/features/chat/runtime/taskSync', () => ({ refreshTaskList: vi.fn() }));
vi.mock('@/shared/overlays/controller', () => ({ toast: vi.fn(), toastError: mock.toastError, openModal: vi.fn() }));
import { handleCoreEvent } from '@/features/chat/runtime/stream';
import { restoreConfirmations } from '@/features/chat/runtime/tasks';
import { onPermission } from '@/features/chat/runtime/permissions';
import { answerQuestion } from '@/features/chat/runtime/questions';
import { QuestionMessage } from '@/features/chat/ui/QuestionMessage';
import { Message } from '@/features/chat/ui/Message';

const questions = [
  { question: 'Color?', header: 'Color', options: [{ label: 'Blue', description: 'Sky' }, { label: 'Red' }] },
  { question: 'Features?', options: [{ label: 'A' }, { label: 'B' }], multi_select: true },
  { question: 'Name?', options: [] },
];
let c: Conv, host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mock.api.mockReset().mockResolvedValue({}); mock.toastError.mockReset();
  c = { id: 'c', owner: 'pc', title: '', updated: 0, remote: true, agentId: 'claude-id', agentBackend: 'claude', messages: [] };
  S.convs = [c]; S.agentCatalog = []; S.permission = 'ask';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const ask = (raw: unknown = { questions }) => handleCoreEvent({ name: 'message.stream', data: { conversation_id: 'c', msg_id: 'm', type: 'ask', data: { session_id: 'c', request_id: 'ask/1', questions: raw } } });
const card = () => c.messages.find(m => m.type === 'question')!;
const answers: CoreAskAnswer[] = [{ question: 'Color?', labels: ['Blue'] }, { question: 'Features?', labels: ['A', 'B'] }, { question: 'Name?', labels: ['My project'] }];
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text || b.textContent?.startsWith(`${text} ·`))!;

it('D26 structured live Ask renders all questions, accepts multi-select and free input, uses dedicated API', async () => {
  ask();
  await act(async () => root.render(<QuestionMessage m={card()} ctxId="conv:c" />));
  expect(host.querySelectorAll('fieldset')).toHaveLength(3); expect(button('提交回答').disabled).toBe(true);
  await act(async () => { button('Blue').click(); button('A').click(); });
  await act(async () => { button('B').click(); });
  const free = host.querySelectorAll<HTMLInputElement>('input')[2];
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(free, 'My project');
    free.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(button('提交回答').disabled).toBe(false);
  await act(async () => { button('提交回答').click(); });
  expect(mock.api).toHaveBeenCalledWith('POST', '/api/conversations/c/asks/ask%2F1/answer', { answers });
  expect(mock.api.mock.calls.some(call => String(call[1]).includes('/confirmations/'))).toBe(false);
  expect(card().status).toBe('done'); expect(card().questionAnswers).toEqual(answers);
});

it('D26 recovery rebuilds full Claude question payload instead of permission allow buttons', async () => {
  const recovered: CoreConfirmation = { id: 'ask/1', call_id: 'ask/1', title: 'AskUserQuestion', description: '', questions, options: [{ label: 'Blue', value: 'Blue' }] };
  restoreConfirmations(c, [recovered]);
  expect(c.messages.map(m => m.type)).toEqual(['question']); expect(card().questions).toEqual(questions);
  await answerQuestion('c', card(), answers);
  expect(mock.api.mock.lastCall?.[1]).toBe('/api/conversations/c/asks/ask%2F1/answer');
});

it('D26 ask supports bare arrays and camel-case multiSelect contract', async () => {
  const q = [{ question: 'Pick?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }];
  ask(q); await answerQuestion('c', card(), [{ question: 'Pick?', labels: ['A', 'B'] }]);
  expect(mock.api.mock.lastCall?.[2]).toEqual({ answers: [{ question: 'Pick?', labels: ['A', 'B'] }] });
});

it('D26 dismissing a question sends explicit decline rather than an empty allow', async () => {
  ask(); await answerQuestion('c', card(), null);
  expect(mock.api.mock.lastCall?.[2]).toEqual({ decline: true }); expect(card().status).toBe('denied');
});

it.each([
  [], [{ question: 'Color?', labels: ['Blue'] }],
  [{ question: 'Color?', labels: ['Blue', 'Red'] }, ...answers.slice(1)],
  [{ question: 'Color?', labels: [' '] }, ...answers.slice(1)],
].map(invalid => [invalid]))('D26 empty, partial, invalid single-select answers cannot be submitted: %j', async invalid => {
  ask(); expect(await answerQuestion('c', card(), invalid)).toBe(false);
  expect(mock.api).not.toHaveBeenCalled(); expect(card().status).toBe('pending');
});

it('D26 failed answer remains pending for retry and concurrent clicks submit only once', async () => {
  ask(); let reject!: (error: Error) => void;
  mock.api.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const first = answerQuestion('c', card(), answers); await answerQuestion('c', card(), null);
  expect(mock.api).toHaveBeenCalledTimes(1); expect(card().status).toBe('submitting');
  reject(new Error('offline')); await first; expect(card().status).toBe('pending');
  mock.api.mockResolvedValue({}); await answerQuestion('c', card(), answers); expect(card().status).toBe('done');
});

it('D26 late answer and approval replies cannot overwrite a verified stop', async () => {
  ask(); let resolve!: (value: unknown) => void;
  mock.api.mockImplementation(() => new Promise(done => { resolve = done; }));
  const first = answerQuestion('c', card(), answers); card().status = 'denied'; resolve({}); await first;
  expect(card().status).toBe('denied');
});

it.each(['qwen', undefined])('D26 legacy permission-embedded or unidentified recovered questions never use the Ask channel (%s)', async backend => {
  c.agentBackend = backend;
  onPermission(c, { id: 'ask/1', call_id: 'ask/1', title: 'AskUserQuestion', description: '', questions, options: [{ label: 'Blue', value: 'Blue' }] });
  expect(card()).toBeUndefined(); expect(mock.api).not.toHaveBeenCalled(); expect(c.messages.at(-1)?.text).toContain('暂不支持回答');
});

it('D26 nested permission questions cannot be mistaken for dedicated asks even on Claude', () => {
  onPermission(c, { session_id: 'c', tool_call: { tool_call_id: 'ask/1', title: 'AskUserQuestion', raw_input: { questions } }, options: [{ option_id: 'Blue', name: 'Blue', kind: 'allow_once' }] });
  expect(card()).toBeUndefined(); expect(mock.api).not.toHaveBeenCalled();
});

it('D26 changing the catalog to Claude cannot reroute an ACP conversation into the Ask channel', () => {
  c.agentBackend = 'qwen';
  S.agentCatalog = [{ id: 'claude-id', name: 'Changed', backend: 'claude', enabled: true, installed: true, status: 'online', agent_type: 'acp', agent_source: 'custom' }];
  onPermission(c, { id: 'ask/1', call_id: 'ask/1', title: 'AskUserQuestion', description: '', questions, options: [{ label: 'Blue', value: 'Blue' }] });
  expect(card()).toBeUndefined(); expect(mock.api).not.toHaveBeenCalled(); expect(c.messages.at(-1)?.text).toContain('暂不支持回答');
});

it.each([{}, [], [{ question: '', options: [] }], [{ question: 'Q?', options: [{}] }]])('D26 malformed question contract does not create an answerable card: %j', raw => {
  ask(raw); expect(card()).toBeUndefined(); expect(mock.api).not.toHaveBeenCalled(); expect(c.messages.at(-1)?.text).toContain('数据不完整');
});

it('D26 confirmation removal resolves a pending question without claiming an answer', () => {
  ask(); handleCoreEvent({ name: 'confirmation.remove', data: { conversation_id: 'c', id: 'ask/1' } });
  const m: Msg = card(); expect(m.status).toBe('resolved'); expect(m.questionAnswers).toBeUndefined();
});

it('D26 recovered ACP UI displays the offered label and submits its exact value without claiming approval', async () => {
  c.agentBackend = 'qwen';
  onPermission(c, { id: 'r', call_id: 'call', title: 'Run tool', description: '', options: [{ label: 'Reject current step', value: 'custom_no' }] });
  const m = c.messages.find(m => m.type === 'approval')!;
  await act(async () => root.render(<Message m={m} ctxId="conv:c" />));
  expect(button('Reject current step').disabled).toBe(false);
  await act(async () => button('Reject current step').click());
  expect(mock.api.mock.lastCall?.[2]).toEqual({ msg_id: 'r', data: { value: 'custom_no' }, always_allow: false });
  expect(host.textContent).toContain('已提交权限选项'); expect(host.textContent).not.toContain('已允许');
});

it('D26 missing-backend recovered UI cannot offer an effective allow or reject button', async () => {
  c.agentBackend = undefined;
  onPermission(c, { id: 'r', call_id: 'call', title: 'Run tool', description: '', options: [{ label: 'Approve', value: 'reject' }] });
  const m = c.messages.find(m => m.type === 'approval')!;
  await act(async () => root.render(<Message m={m} ctxId="conv:c" />));
  for (const label of ['拒绝', '总是允许', '允许一次']) {
    expect(button(label).disabled).toBe(true); await act(async () => button(label).click());
  }
  expect(mock.api).not.toHaveBeenCalled(); expect(host.textContent).toContain('未允许任何操作');
});
