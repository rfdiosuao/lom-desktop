import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { UploadMenu } from './UploadMenu';
import { prepareLomUpload, uploadSkills } from '../runtime/lomUpload';
vi.mock('../runtime/lomUpload', () => ({ prepareLomUpload: vi.fn(async () => {}), uploadSkills: vi.fn() }));
let root: Root; let host: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes(text))!;
const click = async (text: string) => { await act(async () => button(text).click()); };
beforeEach(() => {
  vi.clearAllMocks(); S.drafts = {}; S.attachments = {}; S.modals = [];
  vi.mocked(uploadSkills).mockResolvedValue({ warnings: [], skills: [{ name: '真实技能', location: '/skills/a', source: 'custom', description: '' }, { name: '真实技能', location: '/skills/b', source: 'custom', description: '' }] });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(<UploadMenu/>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
it('D29 both entries, duplicate names and keyboard selection', async () => {
  await click('上传技能'); expect(button('手动上传')).toBeTruthy(); await click('让 Lom 上传');
  const rows = host.querySelectorAll<HTMLButtonElement>('.skill-upload__item'); expect(rows.length).toBe(2);
  expect(rows[0].textContent).toContain('/skills/a'); expect(rows[1].textContent).toContain('/skills/b');
  rows[0].focus(); act(() => rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(document.activeElement).toBe(rows[1]); await act(async () => rows[1].click());
  expect(prepareLomUpload).toHaveBeenCalledWith(expect.objectContaining({ location: '/skills/b' }), 'replace');
});
it('D29 existing draft requires explicit append or replace', async () => {
  S.drafts.home = '不能覆盖'; await click('上传技能'); await click('让 Lom 上传'); await click('真实技能');
  expect(prepareLomUpload).not.toHaveBeenCalled(); expect(host.textContent).toContain('原草稿仍保留'); await click('追加');
  expect(prepareLomUpload).toHaveBeenCalledWith(expect.anything(), 'append');
});
it('D29 honest empty and error states', async () => {
  vi.mocked(uploadSkills).mockResolvedValue({ skills: [], warnings: [] }); await click('上传技能'); await click('让 Lom 上传'); expect(host.textContent).toContain('没有匹配的可访问技能');
  await click('上传技能'); vi.mocked(uploadSkills).mockRejectedValue(new Error('目录无权限')); await click('上传技能');
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('目录无权限');
});
it('D29 manual entry retains existing upload modal', async () => {
  await click('上传技能'); await click('手动上传'); expect(S.modals.at(-1)?.id).toBe('marketUpload'); expect(prepareLomUpload).not.toHaveBeenCalled();
});

it('D29 hover followed by click keeps the submenu open', async () => {
  await click('上传技能');
  await act(async () => button('让 Lom 上传').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(host.querySelector('[aria-label="本机技能"]')).not.toBeNull();
  await click('让 Lom 上传'); expect(host.querySelector('[aria-label="本机技能"]')).not.toBeNull();
  expect(button('上传技能').getAttribute('aria-expanded')).toBe('true');
});
