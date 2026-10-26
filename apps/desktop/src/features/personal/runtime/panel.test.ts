import { vi } from 'vitest';
vi.mock('@/features/account/runtime/serviceConfig', () => ({ cloudConfigured: () => true }));
import { beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import { closePersonalPanel, minimizePersonalPanel, openPersonalPanel, savePanelRect } from './panel';
beforeEach(() => { localStorage.clear(); S.personalPanel = null; S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' }; });
it('PA02 opens one account-scoped panel, preserves its geometry, and never changes the background', () => {
  S.activeConv = 'background'; S.folder = '/background'; S.workspaceBrowseRoot = '/preview'; S.route = { name: 'chat' };
  openPersonalPanel(); savePanelRect({ x: 30, y: 20, w: 600, h: 400 }); minimizePersonalPanel(); openPersonalPanel();
  expect(S.personalPanel?.minimized).toBe(false); expect(S.personalPanel?.rect?.x).toBe(30);
  closePersonalPanel(); openPersonalPanel(); expect(S.personalPanel?.rect?.w).toBe(600);
  expect(S.activeConv).toBe('background'); expect(S.route).toEqual({ name: 'chat' }); expect(S.workspaceBrowseRoot).toBe('/preview'); expect(S.folder).toBe('/background');
  S.account!.id = 'other'; openPersonalPanel(); expect(S.personalPanel?.account).toBe('other'); expect(S.personalPanel?.rect?.x).not.toBe(30);
});
it('PA02 clamps restored geometry and refuses logged-out entry', () => {
  localStorage.setItem('lom.personal.panel:owner', JSON.stringify({ x: 90000, y: 90000, w: 90000, h: 90000 })); openPersonalPanel();
  expect(S.personalPanel!.rect!.x + S.personalPanel!.rect!.w).toBeLessThanOrEqual(innerWidth);
  closePersonalPanel(); S.cloud = 'signed-out'; openPersonalPanel(); expect(S.personalPanel).toBeNull();
});

it('PA02 rejects incomplete persisted panel rectangles', () => {
  localStorage.setItem('lom.personal.panel:owner', '{}'); openPersonalPanel();
  expect(Object.values(S.personalPanel!.rect!).every(Number.isFinite)).toBe(true);
});
