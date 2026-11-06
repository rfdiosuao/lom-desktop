import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { Skillhub } from './Skillhub';
import { listMarket } from '../runtime/skillMarket';
vi.mock('../runtime/skillMarket', () => ({ listMarket: vi.fn(), mineSkills: vi.fn(), CATEGORIES: [], priceLabel: () => '免费' }));
vi.mock('./UploadMenu', () => ({ UploadMenu: () => null }));
vi.mock('./InstalledSkills', () => ({ InstalledSkills: () => null }));
vi.mock('./ReviewDraft', () => ({ ReviewDraft: () => null }));
let root: Root, host: HTMLDivElement;
const previous = { cloud: S.cloud, account: S.account };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.resetAllMocks();
  S.cloud = 'signed-in';
  S.account = { id: 'skill-catalog-test', email: 'test@example.com', name: '测试' };
  localStorage.removeItem('lom.skill-catalog.v1.skill-catalog-test');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.assign(S, previous);
});
it('shows bundled skills immediately and replaces the catalog when the server returns', async () => {
  let complete!: (rows: []) => void;
  vi.mocked(listMarket).mockReturnValue(new Promise(resolve => { complete = resolve; }));
  act(() => root.render(<Skillhub />));
  expect(host.textContent).toContain('爆款标题生成');
  expect(host.querySelector('.spinner')).toBeNull();
  expect(host.textContent).not.toContain('刷新');
  await act(async () => complete([]));
  expect(host.textContent).toContain('暂无已上架技能');
});
it('keeps the account catalog visible if background refresh fails', async () => {
  localStorage.setItem('lom.skill-catalog.v1.skill-catalog-test', JSON.stringify([{
    id: 'cached', name: '缓存技能', summary: '立即查看', category: '写作', version: 1, downloads: 0,
  }]));
  vi.mocked(listMarket).mockRejectedValue(new Error('market unavailable'));
  await act(async () => root.render(<Skillhub />));
  expect(host.textContent).toContain('缓存技能');
  expect(host.querySelector('.spinner')).toBeNull();
});
