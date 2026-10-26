import { beforeEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { S } from '@/state/store';
import { Markdown } from '@/shared/ui/Markdown';
import { WsFiles } from '../ui/Workspace';
import { Message } from '@/features/chat/ui/Message';
import { openMessagePath } from './workspace';
import { resolveLocalPath } from '@/shared/lib/localPaths';
const mock = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api: mock.api, getEndpoint: () => ({ url: 'http://core', homeDir: '/home', defaultFolder: '/work' }) }));
beforeEach(() => {
  mock.api.mockReset(); S.route = { name: 'team', id: 't' }; S.activeConv = null; S.workspaceBrowseRoot = ''; S.openFile = null; S.folder = '/work';
  mock.api.mockImplementation(async (_method, path) => path.endsWith('/metadata') ? {} : path.endsWith('/dir') ? [] : 'file content');
});
it('D15 inline, linked and bare local paths open while code blocks stay literal', () => {
  const seen: string[] = [];
  const html = renderToStaticMarkup(<Markdown text={'`/work/a b.md` [报告](</work/c d.md>)\n\n文件：/work/out\n\n```sh\n/work/command\n```'} file={(p,l,k) => { seen.push(p); return <button key={k}>{l}</button>; }} />);
  expect(seen).toEqual(['/work/a b.md', '/work/c d.md', '/work/out']);
  expect(html).toContain('<code>/work/command</code>');
});
it('D15 resolves relative paths and rejects non-file schemes', () => {
  expect(resolveLocalPath('../docs/x.md:12', '/work/src', '/home')).toBe('/work/docs/x.md');
  expect(resolveLocalPath('~/file.md', '', '/home')).toBe('/home/file.md');
  expect(() => resolveLocalPath('javascript:alert(1)', '', '')).toThrow();
});
it('D15 raw and team conversation IDs render the actual Agent avatar/name', () => {
  S.agentCatalog = [{ id:'codex', name:'Codex CLI', icon:'/logos/codex.svg' }] as never;
  S.convs = [{ id:'c', agentId:'codex', agentName:'Codex CLI', owner:'pc', remote:true, messages:[] }] as never;
  for (const id of ['c', 'conv:c']) {
    const host = document.createElement('div'); const root = createRoot(host);
    act(() => root.render(<Message ctxId={id} m={{ id:'m', type:'assistant', agent:'pc', at:0, text:'完成' }} />));
    const html = host.innerHTML; act(() => root.unmount());
    expect(html).toContain('Codex CLI'); expect(html).toContain('/logos/codex.svg'); expect(html).not.toContain('电脑主控');
  }
});
it('D15 file opens in sidebar without navigating away from team', async () => {
  await openMessagePath('a.md', '/work/docs');
  expect(S.route).toEqual({name:'team',id:'t'}); expect(S.layout.rightCollapsed).toBe(false);
  expect(S.workspaceBrowseRoot).toBe('/work/docs'); expect(S.openFile).toBe('/work/docs/a.md'); expect(S.openFileContent).toBe('file content');
});
it('D15 folders open a tree; failed reads report errors', async () => {
  mock.api.mockImplementation(async (_m,p) => p.endsWith('/metadata') ? {is_directory:true} : []);
  await openMessagePath('/work/docs'); expect(S.openFile).toBeNull(); expect(S.files?.path).toBe('/work/docs');
  mock.api.mockRejectedValue(new Error('not found')); await openMessagePath('/missing'); expect(S.filesError).toContain('not found');
});
it('D15 older selection and navigation cannot replace the current selection', async () => {
  let done!: (v: object) => void;
  mock.api.mockImplementationOnce(() => new Promise(r => { done = r; }));
  const old = openMessagePath('/old'); await openMessagePath('/new'); done({}); await old;
  expect(S.openFile).toBe('/new');
  mock.api.mockImplementationOnce(() => new Promise(r => { done = r; }));
  const pending = openMessagePath('/next'); S.route = {name:'home'}; done({}); await pending;
  expect(S.openFile).toBeNull();
});

it('D15 clicking the reply path shows file content inside the workspace panel', async () => {
  S.convs = [{id:'click',owner:'pc',remote:true,workspace:'/work',messages:[]}] as never;
  const host = document.createElement('div'); const root = createRoot(host);
  await act(async () => root.render(<><Message ctxId="conv:click" m={{id:'m',type:'assistant',at:0,text:'文件：`/work/report.md`'}} /><WsFiles /></>));
  await act(async () => { host.querySelector<HTMLButtonElement>('.message-path')!.click(); });
  expect(host.textContent).toContain('file content'); expect(S.openFile).toBe('/work/report.md');
  expect(S.route.name).toBe('team'); act(() => root.unmount());
});
