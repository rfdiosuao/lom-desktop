vi.mock('@/features/account/runtime/serviceConfig', () => ({ cloudConfigured: () => true, LOM_CLOUD_URL: 'https://service.example.invalid', requireCloudService: () => {}, CLOUD_UNAVAILABLE: '后端未包含' }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';

/* 桌面外壳与麓鸣云端都替换掉：invoke 模拟 Rust 里的密钥计算，fetch 模拟云端接口 */
const invoke = vi.fn();
vi.mock('../runtime/phoneModel', () => ({ syncPhoneModel: vi.fn(async () => ({ status: 'saved' })) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a), isTauri: () => true }));

type Reply = { status?: number; body: unknown };
let routes: Record<string, (body: unknown) => Reply>;
const calls: { method: string; path: string; body: unknown }[] = [];
globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  const method = init?.method || 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, body });
  const r = routes[`${method} ${path}`]?.(body) ?? { status: 404, body: { success: false, code: 'test.no_route', error: path } };
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
}) as typeof fetch;

const { pair, pairClosed, pairTick } = await import('./pairing');
const { closeModal } = await import('@/shared/overlays/controller');

const ok = (data: unknown): Reply => ({ body: { success: true, data } });
const props = () => S.modals.find(m => m.id === 'pair')?.props as Record<string, unknown>;
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
const device = { name: '手机一号', model: 'Redmi K80', os: 'Android 15', app_version: '1.14.0' };
let status: Record<string, unknown>;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => ({
    pairing_identity: { installId: 'inst_1', keys: 'K'.repeat(86), name: '宇航的 MacBook' },
    pairing_qr: '<svg/>', pairing_check_proof: true, pairing_sas: '482913', pairing_forget: null,
  } as Record<string, unknown>)[cmd]);
  calls.length = 0;
  status = { state: 'open', method: null, device_keys: null, device_info: null, key_proof: null, device_id: null };
  routes = {
    'POST /v1/pairing/sessions': () => ok({ pairing_id: 'pid', claim_token: 'tok', manual_code: 'ABCD-2345', expires_at: 2_000_000_000, host: 'lom.entermodetwo.com' }),
    'GET /v1/pairing/sessions/pid': () => ok(status),
    'POST /v1/pairing/sessions/pid/verify': () => ok({}),
    'DELETE /v1/pairing/sessions/pid': () => ok({}),
    'GET /v1/devices': () => ok([{ id: 'dev_1', name: '手机一号', keys: 'P', info: device, paired_at: 1, last_seen_at: 2, online: true }]),
  };
  update(s => { s.modals = []; s.cloud = 'signed-in'; s.account = { id: 'pairing-account', name: 'Pairing', email: '' }; s.subscription = null; });
});

describe('A03 手机台数上限', () => {
  const plan = (max: number) => ({ plan: { tier: null, name: '免费', ends_at: null, models: [], max_phones: max, discount_pct: 100, daily_points: 0 }, next_tier: null, next_days: null });
  it('已满时不生成二维码和配对码，提示升级或移除', async () => {
    update(s => { s.subscription = plan(1); s.agents.dev_full = { id: 'dev_full', kind: 'phone', name: '旧手机', real: true, status: 'online' } as never; s.phoneOrder.push('dev_full'); });
    pair();
    await flush();
    expect(props()).toMatchObject({ stage: 'limit', max: 1, used: 1 });
    expect(calls.some(c => c.path === '/v1/pairing/sessions')).toBe(false);
    update(s => { delete s.agents.dev_full; s.phoneOrder = s.phoneOrder.filter(x => x !== 'dev_full'); });
  });
  it('服务端拒绝（sub.phone_limit）时同样显示上限提示', async () => {
    update(s => { s.subscription = plan(3); });
    routes['POST /v1/pairing/sessions'] = () => ({ status: 409, body: { success: false, code: 'sub.phone_limit', error: '已满' } });
    pair();
    await flush();
    expect(props()?.stage).toBe('limit');
  });
});

describe('R01 添加手机', () => {
  it('AC-1/AC-2 扫码路径：显示真实二维码，核对 key_proof 后等待手机确认，确认后出现真实手机卡片', async () => {
    pair();
    await flush();
    expect(props()).toMatchObject({ stage: 'waiting', code: 'ABCD-2345', qrSvg: '<svg/>' });
    expect(invoke).toHaveBeenCalledWith('pairing_qr', { host: 'lom.entermodetwo.com', pairingId: 'pid', claimToken: 'tok' });
    // psk 只在外壳里：发往云端的请求里没有它（这里也没有任何 psk 字段可发）
    expect(JSON.stringify(calls)).not.toMatch(/psk/);

    Object.assign(status, { state: 'claimed', method: 'qr', device_keys: 'P', key_proof: 'proof', device_info: device });
    await pairTick();
    expect(invoke).toHaveBeenCalledWith('pairing_check_proof', { pairingId: 'pid', deviceKeys: 'P', keyProof: 'proof' });
    expect(calls.find(c => c.path.endsWith('/verify'))?.body).toEqual({ ok: true });
    expect(props()).toMatchObject({ stage: 'scanned', deviceName: '手机一号' });

    Object.assign(status, { state: 'confirmed', device_id: 'dev_1' });
    await pairTick();
    expect(props()).toMatchObject({ stage: 'done', newId: 'dev_1' });
    expect(S.agents.dev_1).toMatchObject({ real: true, name: '手机一号', status: 'online', device: 'Redmi K80 · Android 15' });
    expect(S.phoneOrder).toContain('dev_1');
    expect(S.lit.dev_1).toBe(true);
  });

  it('扫码路径：key_proof 不对时作废会话，不会显示已连接', async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === 'pairing_check_proof' ? false : cmd === 'pairing_qr' ? '<svg/>' : { installId: 'i', keys: 'K', name: 'M' }));
    pair();
    await flush();
    Object.assign(status, { state: 'claimed', method: 'qr', device_keys: 'P', key_proof: 'bad', device_info: device });
    await pairTick();
    expect(calls.find(c => c.path.endsWith('/verify'))?.body).toEqual({ ok: false });
    expect(props()).toMatchObject({ stage: 'error' });
  });

  it('AC-7 配对码路径：电脑显示本机计算的确认码', async () => {
    pair();
    await flush();
    Object.assign(status, { state: 'claimed', method: 'code', device_keys: 'P', device_info: device });
    await pairTick();
    expect(invoke).toHaveBeenCalledWith('pairing_sas', { pairingId: 'pid', deviceKeys: 'P' });
    expect(props()).toMatchObject({ stage: 'sas', sas: '482913' });
    expect(calls.some(c => c.path.endsWith('/verify'))).toBe(false);
  });

  it('手机取消或过期时如实提示，不会假装成功', async () => {
    pair();
    await flush();
    status.state = 'expired';
    await pairTick();
    expect(props()).toMatchObject({ stage: 'error', error: '配对已过期，请刷新二维码。' });
  });

  it('关闭弹窗：作废云端会话并丢弃 psk', async () => {
    pair();
    await flush();
    closeModal();
    pairClosed();
    await flush();
    expect(calls.some(c => c.method === 'DELETE' && c.path === '/v1/pairing/sessions/pid')).toBe(true);
    expect(invoke).toHaveBeenCalledWith('pairing_forget');
  });

  it('未登录时先登录，不生成配对码', async () => {
    update(s => { s.cloud = 'signed-out'; });
    pair();
    await flush();
    expect(props()).toMatchObject({ stage: 'signin' });
    expect(calls).toEqual([]);
  });
});
