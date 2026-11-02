import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ prepare: vi.fn(), dispose: vi.fn() }));
vi.mock('@/features/settings/runtime/agentWarmup', () => ({ prepareAgentTask: m.prepare }));
vi.mock('@/core/client', async orig => ({ ...(await orig<object>()), getEndpoint: () => ({ url: 'http://core', token: 't', defaultFolder: '/work', homeDir: '/Users/me' }) }));
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';
import { Composer } from './Composer';

const codex = { id: 'ag_codex', name: 'Codex CLI', backend: 'codex', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' as const };
let host: HTMLDivElement, root: Root;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  // 不开「减少动态效果」，占位光标才会出现
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.clearAllMocks();
  m.prepare.mockReturnValue(m.dispose);
  localStorage.clear(); Object.assign(S, initialState());
  S.mode = 'desktop'; S.route = { name: 'home' }; S.activeConv = '';
  S.agentCatalog = [codex]; S.agentPick = 'ag_codex';
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Composer ckey="home" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const caret = () => host.querySelector('.composer__placeholder-caret');
const textarea = () => host.querySelector('textarea')!;
const settle = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

it('CW04 losing focus keeps the warmed-up Codex session, so clicking Send can still adopt it', async () => {
  await act(async () => { textarea().focus(); });
  await settle(400);
  expect(m.prepare).toHaveBeenCalledTimes(1);

  // 点发送按钮、打开菜单、切到别处都会让输入框先失焦
  await act(async () => { textarea().blur(); });
  await settle(400);
  expect(m.dispose).not.toHaveBeenCalled();
  expect(m.prepare).toHaveBeenCalledTimes(1);

  // 重新聚焦也不会重复预热
  await act(async () => { textarea().focus(); });
  await settle(400);
  expect(m.prepare).toHaveBeenCalledTimes(1);
});

it('CW04 the warmed-up session is still retired when the scope really changes', async () => {
  await act(async () => { textarea().focus(); });
  await settle(400);
  expect(m.prepare).toHaveBeenCalledTimes(1);
  await act(async () => { update(s => { s.agentPick = ''; }); });
  expect(m.dispose).toHaveBeenCalledTimes(1);
});

it('CW04 the decorative cursor follows the real focus: hidden while focused, back on blur', async () => {
  expect(caret()).not.toBeNull();
  await act(async () => { textarea().focus(); });
  expect(caret()).toBeNull();
  await act(async () => { textarea().blur(); });
  expect(caret()).not.toBeNull();
});
