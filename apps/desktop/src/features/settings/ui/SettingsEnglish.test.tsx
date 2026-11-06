import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as serviceConfig from '@/features/account/runtime/serviceConfig';
import { ModalHost } from '@/app/overlays/ModalHost';
import { openModal } from '@/shared/overlays/controller';
import { S } from '@/state/store';
import { Settings } from './Settings';

const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => true }));
vi.mock('../runtime/agents', async original => ({ ...await original<object>(), loadAgents: vi.fn(async () => undefined) }));
vi.mock('../runtime/mcpManager', async original => ({ ...await original<typeof import('../runtime/mcpManager')>(), listMcp: vi.fn(async () => []) }));

/** 含中文字符的界面文字：只有中文界面才允许出现 */
const CJK = /[㐀-鿿＀-￯　-〿]/;
let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  S.prefs.lang = 'English';
  S.cloud = 'signed-in';
  S.conn = 'ready';
  m.invoke.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  S.prefs.lang = '简体中文';
  S.account = null;
});

/** 页面或弹层里仍是中文的可见文字与控件属性（placeholder、aria-label、title） */
function untranslated(): string[] {
  const found = new Set<string>();
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent?.trim() ?? '';
    if (text && CJK.test(text)) found.add(text);
  }
  for (const el of host.querySelectorAll('*')) {
    for (const attr of ['placeholder', 'aria-label', 'title']) {
      const value = el.getAttribute(attr);
      if (value && CJK.test(value)) found.add(`[${attr}] ${value}`);
    }
  }
  return [...found];
}

const PAGES = ['account', 'general', 'agents', 'models', 'connections', 'servers', 'agent', 'security', 'data', 'about'];

it('SET-I18N-01 #432 every settings page is fully translated when the interface language is English', () => {
  const report: Record<string, string[]> = {};
  for (const page of PAGES) {
    S.settingsPage = page;
    act(() => root.render(<Settings />));
    report[page] = untranslated();
  }
  expect(Object.entries(report).filter(([, found]) => found.length)).toEqual([]);
});

it('SET-I18N-01 #432 a signed-in account page is fully translated when the interface language is English', () => {
  const configured = vi.spyOn(serviceConfig, 'cloudConfigured').mockReturnValue(true);
  S.account = { id: 'i18n', name: '', email: 'i18n@example.test' };
  S.settingsPage = 'account';
  try {
    act(() => root.render(<Settings />));
    expect(untranslated()).toEqual([]);
  } finally { configured.mockRestore(); }
});

it.each([
  ['shortcuts', undefined],
  ['customAgent', undefined],
  ['mcpConnector', {}],
  ['sshMachine', { account: 'i18n' }],
  ['mcp', {}],
  ['audit', undefined],
  ['update', undefined],
] as const)('SET-I18N-01 #432 the %s dialog opened from settings is fully translated in English', async (name, props) => {
  S.settingsPage = 'general';
  act(() => root.render(<><Settings /><ModalHost /></>));
  await act(async () => { openModal(name, props as Record<string, unknown> | undefined); });
  expect(untranslated()).toEqual([]);
});
