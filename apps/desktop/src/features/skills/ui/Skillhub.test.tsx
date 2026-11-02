import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Skillhub } from './Skillhub';
import { listMarket, mineSkills } from '../runtime/skillMarket';
vi.mock('../runtime/skillMarket', () => ({ listMarket: vi.fn(), mineSkills: vi.fn(), CATEGORIES: [], priceLabel: () => '免费' }));
vi.mock('./UploadMenu', () => ({ UploadMenu: () => null }));
vi.mock('./InstalledSkills', () => ({ InstalledSkills: () => null }));
vi.mock('./ReviewDraft', () => ({ ReviewDraft: () => null }));
let root: Root, host: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
it('D09 shows an accessible animation immediately, before the debounced first request, then real empty state', async () => {
  vi.mocked(listMarket).mockResolvedValue([]);
  act(() => root.render(<Skillhub />));
  expect(host.querySelector('[role="status"] .spinner')).not.toBeNull();
  expect(host.textContent).not.toContain('暂无已上架技能');
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(host.textContent).toContain('暂无已上架技能');
});
it('D09 replaces animation with request errors and animates the uploads tab while pending', async () => {
  vi.mocked(listMarket).mockRejectedValue(new Error('market unavailable'));
  vi.mocked(mineSkills).mockReturnValue(new Promise(() => {}));
  act(() => root.render(<Skillhub />));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('market unavailable');
  act(() => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b => b.textContent === '我的上传')!.click());
  expect(host.querySelector('[role="status"] .spinner')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
