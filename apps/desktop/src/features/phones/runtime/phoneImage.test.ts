import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ invoke: vi.fn(), upload: vi.fn(), gallery: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('./phoneFiles', () => ({ uploadPhoneFile: m.upload, savePhoneGallery: m.gallery }));
import { sendPhoneImage } from './phoneImage';
beforeEach(() => { vi.clearAllMocks(); m.invoke.mockResolvedValue('data:image/png;base64,YWJj'); m.upload.mockResolvedValue('file-1'); m.gallery.mockResolvedValue({ status: 'saved', uri: 'content://media/1' }); });
it('PHONE-IMAGE-01 uploads a validated local image and reports receipt without publishing or saving to gallery by default', async () => {
  const current = vi.fn();
  expect(await sendPhoneImage('dev', { file_path: '/work/a.png' }, current)).toEqual({ status: 'received', file_id: 'file-1', name: 'a.png', mime: 'image/png' });
  expect(m.invoke).toHaveBeenCalledWith('local_image_data', { path: '/work/a.png' });
  expect(m.upload).toHaveBeenCalledWith('dev', expect.objectContaining({ file: expect.any(File), name: 'a.png' }), current);
  expect(m.gallery).not.toHaveBeenCalled();
});
it('PHONE-IMAGE-01 saves to gallery only when explicitly requested, and does not disguise gallery failures as success', async () => {
  expect(await sendPhoneImage('dev', { file_path: '/a.png', save_to_gallery: true }, () => {})).toMatchObject({ status: 'saved_to_gallery', file_id: 'file-1', uri: 'content://media/1' });
  m.gallery.mockRejectedValue(new Error('permission denied'));
  expect(await sendPhoneImage('dev', { file_path: '/a.png', save_to_gallery: true }, () => {})).toMatchObject({ status: 'received', file_id: 'file-1', gallery_error: 'permission denied' });
});
it('PHONE-IMAGE-01 rejects invalid inputs and never transfers invalid images', async () => {
  await expect(sendPhoneImage('dev', { file_path: 'relative.png' }, () => {})).rejects.toThrow('绝对路径');
  await expect(sendPhoneImage('dev', { file_path: '/a.png', save_to_gallery: 'yes' }, () => {})).rejects.toThrow('布尔');
  m.invoke.mockRejectedValue(new Error('image.invalid'));
  await expect(sendPhoneImage('dev', { file_path: '/a.png' }, () => {})).rejects.toThrow('image.invalid');
  expect(m.upload).not.toHaveBeenCalled();
});
it('PHONE-IMAGE-01 revocation during validation or transfer never triggers the next operation', async () => {
  let allowed = true; const current = () => { if (!allowed) throw new Error('已撤销'); };
  m.invoke.mockImplementationOnce(async () => { allowed = false; return 'data:image/png;base64,YWJj'; });
  await expect(sendPhoneImage('dev', { file_path: '/a.png' }, current)).rejects.toThrow('已撤销');
  expect(m.upload).not.toHaveBeenCalled();
  allowed = true; m.upload.mockImplementationOnce(async () => { allowed = false; return 'file-1'; });
  await expect(sendPhoneImage('dev', { file_path: '/a.png', save_to_gallery: true }, current)).rejects.toThrow('已撤销');
  expect(m.gallery).not.toHaveBeenCalled();
});
