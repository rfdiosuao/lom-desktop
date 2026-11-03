import { beforeEach, expect, it } from 'vitest';
import { initialState, loadPersisted, persist } from './state';
beforeEach(() => localStorage.clear());
it('UI-CLEAN-01 a fresh startup contains no example phones, conversations or user assets', () => {
  const state = initialState(); loadPersisted(state);
  expect(Object.keys(state.agents)).toEqual(['pc']);
  expect(state.phoneId).toBe(''); expect(state.phoneOrder).toEqual([]);
  for (const rows of [state.convs, state.teams, state.schedules, state.skills, state.mySkills]) expect(rows).toEqual([]);
  for (const rows of [state.souls, state.memories, state.subagents, state.authorizedPCs, state.installed, state.lit]) expect(rows).toEqual({});
});
it('UI-CLEAN-01 existing user teams and preferences survive startup without adding samples', () => {
  const saved = initialState(); saved.theme = 'dark';
  saved.teams = [{ id: 'user-team', name: 'My team', members: [], panes: {}, created: 1, folder: '/work' }];
  saved.customGroups = { dev_real: [{ id: 'work', name: 'Work' }] };
  persist(saved);
  const restored = initialState(); loadPersisted(restored);
  expect(restored.teams).toEqual(saved.teams); expect(restored.theme).toBe('dark');
  expect(restored.customGroups.dev_real).toEqual(saved.customGroups.dev_real);
  expect(restored.phoneOrder).toEqual([]); expect(restored.convs).toEqual([]);
});
it('UI-CLEAN-01 demo data is only produced by explicit fixture opt-in', () => {
  const demo = initialState(true);
  expect(demo.phoneOrder).toEqual(['p1', 'p2', 'p3']); expect(demo.convs.length).toBeGreaterThan(0);
  expect(initialState().convs).toEqual([]);
});
