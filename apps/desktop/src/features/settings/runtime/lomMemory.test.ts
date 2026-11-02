import { expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ api: vi.fn(), invoke: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => null }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
import { addMemory } from './lomMemory';
it('audit: first memory prepares directory before writing note and missing index', async () => {
  const order: string[] = [];
  m.invoke.mockImplementation(async () => { order.push('prepare'); return '/memory'; });
  m.api.mockImplementation(async (_method, path) => { order.push(path); if (path.endsWith('/read')) throw { status: 404 }; return true; });
  await addMemory('/memory', '偏好', '内容', '/work');
  expect(order).toEqual(['prepare', '/api/fs/write', '/api/fs/read', '/api/fs/write']);
});
it('audit: index permission failures cannot overwrite the index', async () => {
  m.api.mockReset(); m.invoke.mockResolvedValue('/memory');
  m.api.mockImplementation(async (_method, path) => { if (path.endsWith('/read')) throw { status: 403 }; return true; });
  await expect(addMemory('/memory', '偏好', '内容', '/work')).rejects.toEqual({ status: 403 });
  expect(m.api.mock.calls.filter(c => c[1] === '/api/fs/write')).toHaveLength(1);
});
