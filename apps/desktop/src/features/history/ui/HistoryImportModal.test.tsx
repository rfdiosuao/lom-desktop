import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { HistoryImportModal } from './HistoryImportModal';
import { setEndpoint } from '@/core/client';
let host: HTMLDivElement, root: Root;
const entry = { id: 'a'.repeat(64), source: 'claude', title: '真实导入预览', session_id: 'sample', cwd: '/中文项目', timestamp: '2026-10-22', digest: 'b'.repeat(64), bytes: 100, events: 8, warnings: ['attachments_are_references_only'] };
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); setEndpoint({ url: 'http://127.0.0.1:1234', token: 'test' } as any); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); setEndpoint(null as any); });
const click = async (label: string) => { const button = [...host.querySelectorAll('button')].find(b => b.textContent === label); expect(button).toBeDefined(); await act(async () => button?.click()); };
it('HIST-01 scans once, previews real metadata, imports selected entries and lists the saved archive', async () => {
  let saved = false; const requests: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname; requests.push(path);
    let data: unknown = { entries: saved ? [entry] : [], diagnostics: [] };
    if (path.endsWith('/scan')) data = { entries: [entry], diagnostics: ['symlink_skipped'] };
    if (path.endsWith('/import')) { expect(JSON.parse(String(init?.body)).entries).toEqual([entry]); saved = true; data = { imported: 1, skipped: 0, errors: [] }; }
    return new Response(JSON.stringify({ success: true, data }));
  });
  await act(async () => root.render(<HistoryImportModal />));
  await click('查找本机会话'); expect(host.textContent).toContain('真实导入预览'); expect(host.textContent).not.toContain('/中文项目');
  await click('导入 1 个会话'); expect(host.textContent).toContain('已导入 1 个，已存在 0 个，失败 0 个'); expect(host.textContent).toContain('已导入会话（1）');
  expect(requests.filter(p => p.endsWith('/import'))).toHaveLength(1);
});
it('HIST-01 backend unavailable is explicit and never displays a successful import', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, error: '配套核心未安装' }), { status: 404 }));
  await act(async () => root.render(<HistoryImportModal />));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('配套核心未安装');
  expect(host.textContent).not.toContain('新增 1');
});
