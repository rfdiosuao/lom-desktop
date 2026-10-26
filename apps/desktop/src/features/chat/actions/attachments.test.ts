import { beforeEach, describe, expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';

/* 不连真实的 lom-core：上传接口替换掉 */
const uploadFile = vi.fn();
vi.mock('@/core/client', () => ({ uploadFile: (...a: unknown[]) => uploadFile(...a) }));
const { attachFiles, filesFrom, hasUploading } = await import('./attachments');

const png = (name = 'image.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

beforeEach(() => {
  uploadFile.mockReset();
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
  update(s => { s.mode = 'desktop'; s.attachments = {}; });
});

describe('粘贴 / 拖入图片作为附件', () => {
  it('电脑任务：截图上传到核心，附件带缩略图、换成可区分的名字，上传完成前不能发送', async () => {
    let finish: (p: string) => void = () => {};
    uploadFile.mockReturnValue(new Promise<string>(r => { finish = r; }));
    const done = attachFiles('home', [png()]);
    await Promise.resolve();
    const att = S.attachments.home[0];
    expect(att).toMatchObject({ ic: 'image', kind: 'upload', uploading: true, preview: 'blob:preview' });
    expect(att.name).toMatch(/^粘贴的图片-\d{6}\.png$/);
    expect(hasUploading('home')).toBe(true);
    finish('/data/uploads/a.png');
    await done;
    expect(S.attachments.home[0]).toMatchObject({ path: '/data/uploads/a.png', uploading: false });
    expect(hasUploading('home')).toBe(false);
    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), att.name, undefined);
  });

  it('上传失败：移除附件并释放缩略图，不留下发不出去的附件', async () => {
    uploadFile.mockRejectedValue(new Error('offline'));
    await attachFiles('home', [png('设计稿.png')]);
    expect(S.attachments.home).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });

  it('超过 20 MB 的文件不上传，提示改用本机文件', async () => {
    const big = new File([new Uint8Array(1)], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    await attachFiles('home', [big]);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(S.attachments.home ?? []).toEqual([]);
  });

  it('手机（演示）会话只显示附件，不上传', async () => {
    update(s => { s.mode = 'phone'; });
    await attachFiles('home', [png()]);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(S.attachments.home[0]).toMatchObject({ uploading: false });
  });

  it('剪贴板优先读 items（WebKit 截图只出现在 items 里），没有 items 时读 files', () => {
    const f = png();
    const viaItems = { items: [{ kind: 'file', getAsFile: () => f }, { kind: 'string', getAsFile: () => null }], files: [] } as unknown as DataTransfer;
    expect(filesFrom(viaItems)).toEqual([f]);
    const viaFiles = { items: [], files: [f] } as unknown as DataTransfer;
    expect(filesFrom(viaFiles)).toEqual([f]);
    expect(filesFrom(null)).toEqual([]);
  });
});
