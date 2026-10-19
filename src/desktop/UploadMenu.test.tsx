import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { UploadMenu, type UploadMenuProps } from './UploadMenu';
let host: HTMLDivElement, root: Root;
const row = { id: 'one', name: '相同名称', source: '工作区', location: '/workspace/one' };
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const click = async (text: string) => { const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text)); expect(button).toBeDefined(); await act(async () => button!.click()); };
const mount = async (overrides: Partial<UploadMenuProps> = {}) => {
  const props: UploadMenuProps = { scopeKey: 'one', hasDraft: false, onManual: vi.fn(), prepareDraft: vi.fn().mockResolvedValue(undefined), loadSkills: vi.fn().mockResolvedValue({ skills: [row, { ...row, id: 'two', location: '/workspace/two' }], warnings: [] }), ...overrides };
  await act(async () => root.render(<UploadMenu {...props} />)); return props;
};
it('loads real adapter entries with path disambiguation; selecting only prepares a draft', async () => {
  const props = await mount(); await click('上传技能'); await click('让 Lom 上传');
  expect(props.loadSkills).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('/workspace/one'); expect(host.textContent).toContain('/workspace/two');
  await click('相同名称'); expect(props.prepareDraft).toHaveBeenCalledWith(row, 'replace');
});
it('preserves an existing draft until the user chooses append/replace', async () => {
  const props = await mount({ hasDraft: true }); await click('上传技能'); await click('让 Lom 上传'); await click('相同名称');
  expect(props.prepareDraft).not.toHaveBeenCalled(); await click('追加'); expect(props.prepareDraft).toHaveBeenCalledWith(row, 'append');
});
it('keeps manual entry and reports read failure without demo rows', async () => {
  const props = await mount({ loadSkills: vi.fn().mockRejectedValue(new Error('目录无权限')) });
  await click('上传技能'); await click('手动上传'); expect(props.onManual).toHaveBeenCalledOnce();
  await click('上传技能'); await click('让 Lom 上传'); expect(host.querySelector('[role="alert"]')?.textContent).toContain('目录无权限'); expect(host.textContent).not.toContain('/workspace/one');
});
it('ignores late results after closing the menu', async () => {
  let finish: (value: { skills: typeof row[]; warnings: string[] }) => void = () => {};
  await mount({ loadSkills: () => new Promise(resolve => { finish = resolve; }) });
  await click('上传技能'); await click('让 Lom 上传'); await click('上传技能');
  await act(async () => finish({ skills: [row], warnings: [] })); expect(host.textContent).not.toContain(row.name);
});
it('switching data owner clears a selected old skill and closes the menu', async () => {
  const props = await mount({ hasDraft: true }); await click('上传技能'); await click('让 Lom 上传'); await click('相同名称');
  await act(async () => root.render(<UploadMenu {...props} scopeKey="new-owner" />));
  expect(host.querySelector('[role="menu"]')).toBeNull(); expect(props.prepareDraft).not.toHaveBeenCalled();
});
