import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { AttachmentThumbnail } from '@/features/chat/ui/AttachmentThumbnail';
const load = vi.hoisted(() => vi.fn());
vi.mock('@/core/client', () => ({ loadFilePreview: load }));
it('FILE-PREVIEW-01 ignores historical credential URLs and releases Blob URLs on unmount', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const create = vi.fn(() => 'blob:safe'), revoke = vi.fn();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  load.mockResolvedValue(new Blob(['x'], { type: 'image/png' }));
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<AttachmentThumbnail attachment={{ ic: 'image', path: '/work/a.png', preview: 'http://core/api/fs/stream?token=old-secret' }} />));
  expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:safe');
  expect(load).toHaveBeenCalledWith('/work/a.png', expect.any(AbortSignal));
  await act(async () => root.unmount());
  expect(revoke).toHaveBeenCalledWith('blob:safe');
  expect(load.mock.calls[0][1].aborted).toBe(true); vi.unstubAllGlobals();
});

it('FILE-PREVIEW-01 historical core URL without a local path is never loaded', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'), root = createRoot(host);
  await act(async () => root.render(<AttachmentThumbnail attachment={{ preview: 'http://core/api/fs/stream?token=old-secret' }} />));
  expect(host.querySelector('img')).toBeNull();
  await act(async () => root.unmount());
});
