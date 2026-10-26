import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
const m = vi.hoisted(() => ({ api: vi.fn(), invoke: vi.fn(), listen: vi.fn(), rpc: vi.fn(), send: vi.fn(), capture: vi.fn(), control: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: m.listen }));
vi.mock('./phoneRpc', () => ({ phoneRpc: m.rpc }));
vi.mock('./phoneChat', () => ({ sendPhone: m.send }));
vi.mock('./phoneScreen', () => ({ capturePhone: m.capture, controlPhone: m.control, screenError: (e: Error) => e.message }));
const { commanderExtra, executePhoneTool } = await import('./phoneCommander');
let scope: string;
const call = (name: string, args: object = {}) => executePhoneTool({ id: 'a'.repeat(64), scope, name, arguments: JSON.stringify(args) });
beforeEach(async () => {
  vi.resetAllMocks();
  S.cloud = 'signed-in'; S.account = { id: 'account-a' } as typeof S.account;
  S.agents.dev_a = { ...S.agents.p1, id: 'dev_a', real: true, status: 'online', name: 'Test phone' };
  m.listen.mockResolvedValue(() => {});
  m.invoke.mockImplementation(async (_name, args) => ({ scope: args.scope, url: 'http://127.0.0.1:32100/mcp', token: 'test-only' }));
  m.api.mockImplementation(async (method, path) => method === 'GET' ? [{ id: 'global', enabled: true, name: 'existing' }, { id: 'private', enabled: true, name: 'lom-phone-other' }] : path.endsWith('/toggle') ? {} : { id: 'selected', enabled: true });
  const extra = await commanderExtra(); scope = extra.lom_phone_scope;
  S.convs = [{ id: 'commander', remote: true, phoneScope: scope, owner: 'desktop', title: 't', updated: 1, messages: [] } as Conv];
  S.convPhones = { commander: ['dev_a'] }; S.running = { commander: true };
});
it('R02-03 snapshots explicit MCP selection without leaking other conversation bridges', async () => {
  const extra = await commanderExtra();
  expect(extra.selected_mcp_server_ids).toEqual(['global', 'selected']);
  expect(extra).not.toHaveProperty('mcp_server_ids');
  expect(m.api).toHaveBeenCalledWith('POST', '/api/mcp/servers/selected/toggle', {});
});
it('R02-03 stopped, signed-out, changed-account and unselected calls never reach phone', async () => {
  for (const mutate of [() => { S.running = {}; }, () => { S.cloud = 'signed-out'; }, () => { S.account = { id: 'b' } as typeof S.account; }, () => { S.convPhones.commander = []; }]) {
    S.running = { commander: true }; S.cloud = 'signed-in'; S.account = { id: 'account-a' } as typeof S.account; S.convPhones.commander = ['dev_a']; mutate();
    expect(await call('phone_ui_tree', { device: 'dev_a' })).toMatchObject({ isError: true });
  }
  expect(m.rpc).not.toHaveBeenCalled();
});
it('R02-03 screenshot returns actual image and original coordinate dimensions', async () => {
  m.capture.mockResolvedValue({ image: 'jpeg-bytes', mime: 'image/jpeg', width: '1080', height: '2400', captured_at: '123' });
  const result = await call('phone_screenshot', { device: 'dev_a' });
  expect(result.content[1]).toEqual({ type: 'image', data: 'jpeg-bytes', mimeType: 'image/jpeg' });
  expect(result.content[0].text).toContain('1080x2400');
});
it('R02-03 offline or concurrently running phone refuses control', async () => {
  S.agents.dev_a.status = 'offline'; expect(await call('phone_control', { device: 'dev_a', action: 'home' })).toMatchObject({ isError: true });
  S.agents.dev_a.status = 'online'; S.convs.push({ id: 'phone', owner: 'dev_a' } as Conv); S.running.phone = true;
  expect(await call('phone_control', { device: 'dev_a', action: 'home' })).toMatchObject({ isError: true });
  expect(m.control).not.toHaveBeenCalled();
});
it('R02-03 uses transport identity to deduplicate control and reports dispatch as accepted', async () => {
  m.control.mockResolvedValue({ status: 'completed' });
  await call('phone_control', { device: 'dev_a', action: 'home' });
  expect(m.control).toHaveBeenCalledWith('dev_a', { device: 'dev_a', action: 'home' }, 'a'.repeat(64));
  m.send.mockImplementation(async (c: Conv) => { c.phoneSession = 'session-real'; });
  const reply = await call('phone_task_start', { device: 'dev_a', text: '查看屏幕' });
  expect(JSON.parse(reply.content[0].text!)).toMatchObject({ status: 'accepted', session_id: 'session-real' });
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('PHONE-IMAGE-01 image tool uses the real chunk transport and honors revocation before upload', async () => {
  vi.stubGlobal('File', class {
    name: string; type: string; size: number; bytes: Uint8Array;
    constructor(parts: Uint8Array[], name: string, options: { type: string }) { this.bytes = parts[0]; this.name = name; this.type = options.type; this.size = this.bytes.length; }
    async arrayBuffer() { return this.bytes.buffer; }
    slice(start: number, end: number) { const bytes = this.bytes.slice(start, end); return { arrayBuffer: async () => bytes.buffer }; }
  });
  m.invoke.mockImplementation(async (name, args) => name === 'local_image_data' ? 'data:image/png;base64,YWJj' : name === 'local_file_info' ? ['3', 'a'.repeat(64)] : name === 'local_file_chunk' ? btoa('abc') : ({ scope: args?.scope }));
  m.rpc.mockImplementation(async (_device, method, payload) => method === 'file.begin' ? { offset: '0' } : method === 'file.chunk' ? { offset: '3' } : { id: payload.id, status: 'complete', sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
  const result = await call('phone_send_image', { device: 'dev_a', file_path: '/work/image.png' });
  expect(JSON.parse(result.content[0].text!)).toMatchObject({ status: 'received', name: 'image.png' });
  expect(m.rpc.mock.calls.map(x => x[1])).toEqual(['file.begin', 'file.chunk', 'file.finish']);
  m.rpc.mockClear();
  m.invoke.mockImplementation(async () => { S.convPhones.commander = []; return 'data:image/png;base64,YWJj'; });
  expect(await call('phone_send_image', { device: 'dev_a', file_path: '/work/image.png' })).toMatchObject({ isError: true });
  expect(m.rpc).not.toHaveBeenCalled();
});

it('PHONE-IMAGE-01 a stop request prevents file.begin even while running remains true', async () => {
  const cancellation = await import('@/features/chat/runtime/cancel');
  const stopping = vi.spyOn(cancellation, 'isTaskStopping').mockReturnValue(true);
  expect(S.running.commander).toBe(true);
  expect(await call('phone_send_image', { device: 'dev_a', file_path: '/work/image.png' })).toMatchObject({ isError: true });
  expect(m.rpc).not.toHaveBeenCalled();
  stopping.mockRestore();
});
