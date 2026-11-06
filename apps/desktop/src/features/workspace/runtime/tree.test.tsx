import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: m.api, getEndpoint: () => ({ url: 'http://core', homeDir: '/home', defaultFolder: '/work' }) }));
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { wsTab } from '@/app/shell/layout';
import { WsFiles } from '../ui/WsFiles';
import { iconOf, kindOf, TREE_MAX_NODES, TEXT_PREVIEW_CHARS } from './fileKind';
import { buildTree, openFile } from './workspace';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let meta: { size?: number } = {};
let content: unknown = 'hello';
const calls = (route: string) => m.api.mock.calls.filter(c => c[1] === route);
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(S, initialState());
  S.route = { name: 'home' }; S.folder = '/work'; meta = {}; content = 'hello';
  m.api.mockImplementation(async (_m: string, p: string) => p === '/api/fs/metadata' ? meta : p === '/api/fs/read' ? content : []);
});
async function mount() {
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<WsFiles />));
  return { host, done: () => act(() => root.unmount()) };
}

it('WS-TREE-01 #400 Office, audio and image formats are binary; svg is text but keeps the image icon', () => {
  for (const f of ['a.docx', 'b.XLSX', 'c.pptx', 'd.mp3', 'e.wav', 'f.bmp', 'g.tiff', 'h.png', 'i.pdf', 'j.zip']) expect(kindOf(f), f).toBe('binary');
  for (const f of ['a.md', 'b.svg', 'c.html', 'd.ts', 'LICENSE']) expect(kindOf(f), f).toBe('text');
  expect(iconOf('x.svg')).toBe('image'); expect(iconOf('x.png')).toBe('image'); expect(iconOf('x.md')).toBe('file'); expect(iconOf('x.ts')).toBe('fileCode');
});

it('WS-TREE-01 #400 a docx is never read as text and the reader offers the system app with type and size', async () => {
  meta = { size: 2048 };
  await openFile('/work/报告.docx');
  expect(calls('/api/fs/read')).toHaveLength(0);
  expect(S.openFileInfo).toMatchObject({ kind: 'binary', size: 2048 }); expect(S.openFileContent).toBe('');
  const { host, done } = await mount();
  expect(host.textContent).toContain('不能在这里预览'); expect(host.textContent).toContain('.docx'); expect(host.textContent).toContain('2 KB');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === '用默认应用打开')).toBe(true);
  await done();
});

it('WS-TREE-01 #400 svg is shown as source text', async () => {
  content = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  await openFile('/work/logo.svg');
  expect(S.openFileContent).toBe(content); expect(S.openFileInfo?.kind).toBe('text');
});

it('WS-TREE-01 #400 an unknown extension whose content is binary is detected by sniffing', async () => {
  content = 'PK\u0003\u0004\u0000\u0000\u0008\u0000binary-ish';
  await openFile('/work/payload.dat');
  expect(S.openFileInfo?.kind).toBe('binary'); expect(S.openFileContent).toBe('');
});

it('WS-TREE-01 #405 build and output folders stay visible; only dependency and system entries are hidden and counted', () => {
  const dir = (name: string) => ({ name, full_path: `/w/${name}`, is_dir: true, children: [{ name: 'x', full_path: `/w/${name}/x`, is_dir: false }] });
  const entries = ['dist', 'build', 'target', 'node_modules', '.git'].map(dir);
  const tree = buildTree('/w', entries);
  expect(tree.children?.map(c => c.name)).toEqual(['build', 'dist', 'target']);
  expect(tree.hidden).toBe(2);
  expect(buildTree('/w', entries, true).children).toHaveLength(5);
});

it('WS-TREE-01 #405 the tree footer says how many entries are hidden and can show them', async () => {
  S.files = { name: 'work', path: '/work', type: 'dir', hidden: 2, children: [{ name: 'dist', path: '/work/dist', type: 'dir', children: [] }] };
  m.api.mockImplementation(async (_m: string, p: string) => p === '/api/fs/dir' ? [{ name: 'node_modules', full_path: '/work/node_modules', is_dir: true }, { name: 'a.md', full_path: '/work/a.md', is_dir: false }] : null);
  const { host, done } = await mount();
  expect(host.textContent).toContain('已隐藏 2 项');
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '显示')!.click());
  expect(S.filesShowAll).toBe(true);
  expect(S.files?.children?.map(c => c.name)).toContain('node_modules');
  await done();
});

it('WS-TREE-01 #408 a huge directory is capped and says how many entries were left out', async () => {
  const entries = Array.from({ length: TREE_MAX_NODES + 7 }, (_, i) => ({ name: `f${i}.txt`, full_path: `/w/f${i}.txt`, is_dir: false }));
  const tree = buildTree('/w', entries);
  expect(tree.children).toHaveLength(TREE_MAX_NODES); expect(tree.omitted).toBe(7);
  S.folder = '/w'; S.files = tree;
  const { host, done } = await mount();
  expect(host.textContent).toContain(`只显示前 ${TREE_MAX_NODES} 项`);
  await done();
});

it('WS-TREE-01 #408 switching workspace tabs does not rescan a tree that is already current', async () => {
  S.files = { name: 'work', path: '/work', type: 'dir', children: [] };
  wsTab('plan'); wsTab('changes'); wsTab('files'); await Promise.resolve();
  expect(calls('/api/fs/dir')).toHaveLength(0);
  S.files = null; wsTab('files'); await vi.waitFor(() => expect(calls('/api/fs/dir')).toHaveLength(1));
});

it('WS-TREE-01 #408 a long text file is cut at the preview limit with a notice', async () => {
  content = 'x'.repeat(TEXT_PREVIEW_CHARS + 500);
  meta = { size: TEXT_PREVIEW_CHARS + 500 };
  await openFile('/work/big.log');
  expect(S.openFileContent.length).toBe(TEXT_PREVIEW_CHARS); expect(S.openFileInfo?.truncated).toBe(true);
  const { host, done } = await mount();
  expect(host.textContent).toContain('只显示前');
  await done();
});

it('WS-TREE-01 #408 a very long log renders a bounded number of lines', async () => {
  content = Array.from({ length: 50000 }, (_, i) => `l${i}`).join('\n');
  await openFile('/work/run.log');
  expect(S.openFileInfo?.truncated).toBe(true);
  const { host, done } = await mount();
  expect(host.querySelectorAll('.code__line').length).toBeLessThanOrEqual(5000);
  await done();
});

it('WS-TREE-01 #408 a file above the read limit is not fetched at all', async () => {
  meta = { size: 200 * 1024 * 1024 };
  await openFile('/work/dump.sql');
  expect(calls('/api/fs/read')).toHaveLength(0);
  expect(S.openFileInfo).toMatchObject({ kind: 'large' });
  const { host, done } = await mount();
  expect(host.textContent).toContain('太大'); await done();
});
