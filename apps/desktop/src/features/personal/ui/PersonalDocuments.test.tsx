import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PersonalDocuments } from './PersonalDocuments';
import { saveDocument } from '../runtime/memory';
vi.mock('../runtime/memory', async load => ({ ...await load<typeof import('../runtime/memory')>(), readDocument: vi.fn(async () => 'original'), listDiary: vi.fn(async () => []), saveDocument: vi.fn() }));
it('PA02 prevents editing during an outstanding save so the receipt cannot discard newer changes', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  let finish!: () => void; vi.mocked(saveDocument).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  try {
    await act(async () => root.render(<PersonalDocuments assistant={{ id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a' }} />));
    await act(async () => host.querySelector<HTMLButtonElement>('.pa-document')!.click());
    await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent === '编辑')!.click());
    await act(async () => [...host.querySelectorAll('button')].find(x => x.textContent === '保存')!.click());
    expect(host.querySelector<HTMLTextAreaElement>('textarea')?.disabled).toBe(true);
    await act(async () => finish());
    expect(host.querySelector('textarea')).toBeNull();
  } finally { await act(async () => root.unmount()); }
});
