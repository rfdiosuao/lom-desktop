import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ cloud: vi.fn(), install: vi.fn(), detail: vi.fn(), toast: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/core/client', () => ({ api: vi.fn() }));
vi.mock('@/features/phones/runtime/phoneRpc', () => ({ phoneRpc: vi.fn() }));
vi.mock('@/features/phones/runtime/phoneFiles', () => ({ base64: vi.fn(), uploadPhoneFile: vi.fn() }));
vi.mock('@/features/chat/runtime/commandSkills', () => ({ loadCommandSkills: vi.fn() }));
vi.mock('@/features/account/runtime/cloud', () => ({ cloud: m.cloud, cloudSkillArchive: vi.fn() }));
vi.mock('@/shared/overlays/controller', () => ({ closeModal: vi.fn(), toast: m.toast, confirm: (o: { onOk: () => void }) => o.onOk() }));
vi.mock('./skillMarket', async orig => ({ ...(await orig<object>()), installMarketSkill: m.install, marketDetail: m.detail }));
import { S, update } from '@/state/store';
import { initialState } from '@/state/state';
import { beginAuthChange } from '@/features/account/runtime/authScope';
import { MarketDetailModal } from '../ui/MarketModal';
import { purchaseSkill } from './skillMarket';

type Points = NonNullable<typeof S.points>;
const points = (total: number): Points => ({ total, free: 0, paid: total, period: '', daily: 0 } as Points);
const A = { id: 'acc-a', name: 'A', email: 'a@test.invalid' }, B = { id: 'acc-b', name: 'B', email: 'b@test.invalid' };
/** 一次还没返回的云端请求：先切换账号，再让它「迟到」返回 */
const pendingCloud = () => {
  let resolve!: (v: unknown) => void, reject!: (e: unknown) => void;
  m.cloud.mockImplementationOnce(() => new Promise((res, rej) => { resolve = res; reject = rej; }));
  return { resolve: (v: unknown) => resolve(v), reject: (e: unknown) => reject(e) };
};
const switchTo = (account: typeof B, total: number) => update(s => { s.account = account; s.points = points(total); });

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(S, initialState());
  S.cloud = 'signed-in'; S.account = A; S.points = points(50);
});

it('ST08 a purchase in the current account updates the points display and reports the charge', async () => {
  m.cloud.mockResolvedValueOnce({ owned: true, charged: 5, points: points(45) });
  expect(await purchaseSkill('sk1')).toBe(5);
  expect(S.points?.total).toBe(45);
});

it('ST08 a late success after switching accounts does not overwrite the new account points', async () => {
  const req = pendingCloud();
  const result = purchaseSkill('sk1');
  switchTo(B, 200);
  req.resolve({ owned: true, charged: 5, points: points(45) });
  await expect(result).rejects.toThrow('账号已切换');
  expect(S.points?.total).toBe(200);
});

it('ST08 logging out and back into the same account does not revive the old response', async () => {
  const req = pendingCloud();
  const result = purchaseSkill('sk1');
  beginAuthChange();
  req.resolve({ owned: true, charged: 5, points: points(45) });
  await expect(result).rejects.toThrow('账号已切换');
  expect(S.points?.total).toBe(50);
});

it('ST08 a late failure after switching accounts is not shown as the new account error', async () => {
  const req = pendingCloud();
  const result = purchaseSkill('sk1');
  switchTo(B, 200);
  req.reject(new Error('points.insufficient'));
  await expect(result).rejects.toThrow('账号已切换');
  expect(S.points?.total).toBe(200);
});

it('ST08 a normal failure keeps its real error, also when nobody is signed in', async () => {
  m.cloud.mockRejectedValueOnce(new Error('points.insufficient'));
  await expect(purchaseSkill('sk1')).rejects.toThrow('points.insufficient');
  expect(S.points?.total).toBe(50);

  S.cloud = 'signed-out'; S.account = null;
  m.cloud.mockRejectedValueOnce(new Error('请先登录'));
  await expect(purchaseSkill('sk1')).rejects.toThrow('请先登录');
});

let host: HTMLDivElement, root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });

it('ST08 after the account switched the install dialog shows no charge toast and never installs', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  m.detail.mockResolvedValue({ id: 'sk1', name: '写作', summary: '写文章', category: '写作', version: 1, downloads: 0, price: 5, owned: false, readme: '', files: [] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<MarketDetailModal p={{ id: 'sk1' }} />));

  const req = pendingCloud();
  const install = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === '安装技能')!;
  await act(async () => install.click());
  await act(async () => { switchTo(B, 200); });
  await act(async () => req.resolve({ owned: true, charged: 5, points: points(45) }));

  expect(m.install).not.toHaveBeenCalled();
  expect(m.toast).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('账号已切换');
  expect(S.points?.total).toBe(200);
});
