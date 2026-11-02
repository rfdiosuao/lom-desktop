import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { Shell } from './Shell';
it.each(['light', 'dark'] as const)('ISSUE-7 empty phone mode renders without invented devices (%s)', async theme => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(S, initialState()); S.theme = theme; S.mode = 'phone'; S.wsTab = 'phone';
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(<Shell />));
    expect(host.textContent).toContain('尚未配对手机');
    expect(host.textContent).not.toContain('手机一号');
    expect(host.querySelectorAll('button').length).toBeGreaterThan(0);
    expect(host.querySelector('[aria-label="主区域"]')?.textContent).toContain('配对新手机');
  } finally { await act(async () => root.unmount()); }
});
