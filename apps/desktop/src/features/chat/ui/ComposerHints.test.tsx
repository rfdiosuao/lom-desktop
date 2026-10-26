import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { Composer } from './Composer';
import { composerHints } from './composerHints';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.spyOn(Math, 'random').mockReturnValue(0);
  localStorage.clear(); Object.assign(S, initialState());
  S.mode = 'desktop'; S.route = { name: 'home' }; S.activeConv = '';
  S.convs = [
    { id: 'lom1', owner: 'pc', title: 'Lom 任务', updated: 1, messages: [], remote: true, loaded: true },
    { id: 'codex1', owner: 'pc', title: 'Codex', updated: 1, messages: [], remote: true, loaded: true, agentId: 'ag_codex', agentName: 'Codex CLI' },
  ];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const overlayText = () => host.querySelector('.composer__placeholder-text')?.textContent ?? '';
/** 每隔 500ms 看一眼覆盖层，收集看到的文字（每句完整停留 2 秒，所以不会漏掉） */
const watch = async (seconds: number) => {
  const seen = new Set<string>();
  for (let t = 0; t < seconds * 1000; t += 500) {
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    seen.add(overlayText());
  }
  return seen;
};

it('CW04 the default Lom input plays its own hint and then every built-in hint', async () => {
  await act(async () => root.render(<Composer ckey="conv:lom1" />));
  const own = host.querySelector('textarea')!.getAttribute('placeholder')!;
  const seen = await watch(220);
  for (const hint of composerHints(own)) expect(seen.has(hint), hint).toBe(true);
  // 提示是覆盖层里的装饰，输入框的草稿始终为空
  expect(host.querySelector('textarea')!.value).toBe('');
});

it('CW04 an input with its own hint (team, external Agent) never mixes in the built-in hints', async () => {
  await act(async () => root.render(<Composer ckey="team:example" compact placeholder="把目标告诉 Leader…" />));
  const team = await watch(40);
  expect([...team].every(text => '把目标告诉 Leader…'.startsWith(text))).toBe(true);
  expect(team.has('把目标告诉 Leader…')).toBe(true);

  await act(async () => root.render(<Composer ckey="conv:codex1" agentId="pc" />));
  const own = host.querySelector('textarea')!.getAttribute('placeholder')!;
  expect(own).toContain('Codex CLI');
  const ext = await watch(40);
  expect([...ext].every(text => own.startsWith(text))).toBe(true);
});
