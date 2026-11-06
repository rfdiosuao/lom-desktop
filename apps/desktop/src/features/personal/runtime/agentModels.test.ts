import { beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import { checkedModel, describeAgentModel, memberModelFor } from './agentModels';

const seed = (id: string) => localStorage.setItem(`lom.agent-options:${id}`, JSON.stringify([
  { id: 'model', category: 'model', current_value: 'hy4free', options: [{ value: 'hy4free', name: 'Hy4' }, { value: 'hy3', name: 'Hy3' }] }]));
beforeEach(() => { localStorage.clear(); S.agentModelPick = {}; });

it('TEAM-ORCH-04 auto or empty means inherit, a listed model is kept', () => {
  seed('cb');
  expect(checkedModel('cb', undefined)).toBeUndefined();
  expect(checkedModel('cb', 'auto')).toBeUndefined();
  expect(checkedModel('cb', ' hy3 ')).toBe('hy3');
});
it('TEAM-ORCH-04 a model the agent does not list is rejected with the real choices', () => {
  seed('cb');
  expect(() => checkedModel('cb', 'gpt-x')).toThrow(/hy4free/);
});
it('TEAM-ORCH-04 a rejected model says the list is a possibly stale local cache, with its age when known', () => {
  seed('cb');
  expect(() => checkedModel('cb', 'gpt-x')).toThrow(/本机缓存/);
  localStorage.setItem('lom.agent-options:cb:at', String(Date.UTC(2026, 10, 5)));
  expect(() => checkedModel('cb', 'gpt-x')).toThrow(/2026-11-05T00:00:00/);
});
it('TEAM-ORCH-04 the read-only description carries the cache time and refresh hint', () => {
  seed('cb');
  localStorage.setItem('lom.agent-options:cb:at', String(Date.UTC(2026, 10, 5)));
  expect(describeAgentModel('cb')).toMatchObject({ models_cached_at: '2026-11-05T00:00:00.000Z', models_note: expect.stringContaining('重新读取') });
  expect(describeAgentModel('none')).not.toHaveProperty('models_note');
});
it('TEAM-ORCH-04 an unknown catalog does not invent a rejection, bad types still fail', () => {
  expect(checkedModel('never-read', 'anything')).toBe('anything');
  expect(() => checkedModel('cb', 5)).toThrow();
  expect(() => checkedModel('cb', 'x'.repeat(161))).toThrow();
});
it('TEAM-ORCH-04 member model beats the desktop pick, which beats inheriting', () => {
  S.agentModelPick = { cb: 'hy3' };
  expect(memberModelFor('cb', 'hy4free')).toBe('hy4free');
  expect(memberModelFor('cb')).toBe('hy3');
  expect(memberModelFor('other')).toBe('');
});
it('TEAM-ORCH-04 describes the default and its source honestly', () => {
  seed('cb');
  expect(describeAgentModel('cb')).toMatchObject({ default_model: 'hy4free', source: 'agent_reported', models_known: true });
  S.agentModelPick = { cb: 'hy3' };
  expect(describeAgentModel('cb')).toMatchObject({ default_model: 'hy3', source: 'desktop_preference' });
  expect(describeAgentModel('none')).toMatchObject({ default_model: null, source: 'unknown', models_known: false });
});
