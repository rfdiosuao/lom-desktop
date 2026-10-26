import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ invoke: vi.fn(), native: vi.fn(), api: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: m.native }));
vi.mock('@/core/client', () => ({ api: m.api }));
import { S } from '@/state/store';
import { initialState, loadPersisted } from '@/state/state';
import { effectiveMode, ensureTaskPermissions, publicationPolicy, stripSettingsContext, savePreference, syncStartupPreference } from './preferences';
import { audit, readAudit } from './audit';
import { t } from '@/shared/i18n/index';
import { chime, taskFinished } from '@/app/sound';

beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); Object.assign(S, initialState()); m.native.mockReturnValue(true); m.api.mockResolvedValue({}); });
it('startup state is saved only after the OS acknowledges it, and read back on launch', async () => {
  m.invoke.mockRejectedValueOnce(new Error('OS denied'));
  await expect(savePreference('launchAtLogin', true)).rejects.toThrow('OS denied'); expect(S.prefs.launchAtLogin).toBe(false);
  m.invoke.mockResolvedValueOnce(true); await savePreference('launchAtLogin', true); expect(S.prefs.launchAtLogin).toBe(true);
  m.invoke.mockResolvedValueOnce(false); await syncStartupPreference(); expect(S.prefs.launchAtLogin).toBe(false);
  m.native.mockReturnValue(false); await expect(savePreference('launchAtLogin', true)).rejects.toThrow('桌面应用');
});
it('permission setting refuses an active task and does not persist a failed core request', async () => {
  S.running.x = true; await expect(savePreference('allowInstall', 'deny')).rejects.toThrow('先停止'); expect(m.api).not.toHaveBeenCalled();
  S.running = {}; S.convs = [{ id: 'security-failure', remote: true, owner: 'pc', title: '', updated: 0, messages: [] }];
  m.api.mockRejectedValueOnce(new Error('core unreachable'));
  await expect(savePreference('allowInstall', 'deny')).rejects.toThrow('core unreachable'); expect(S.prefs.allowInstall).toBe('ask');
});
it('restrictive policy clears legacy always approvals and cannot be overridden by full-auto', async () => {
  const c = { id: 'fresh-security-test', remote: true, owner: 'pc', title: '', updated: 0, messages: [] };
  S.permission = 'auto'; S.prefs.allowInstall = 'ask';
  m.api.mockResolvedValueOnce({ runtime: { has_task: true } });
  await ensureTaskPermissions(c);
  expect(m.api.mock.calls).toEqual([
    ['GET', '/api/conversations/fresh-security-test'],
    ['POST', '/api/conversations/fresh-security-test/runtime/restart', {}],
    ['PUT', '/api/conversations/fresh-security-test/config-options/mode', { value: 'default' }],
  ]);
  m.api.mockClear(); await ensureTaskPermissions(c);
  expect(m.api.mock.calls).toEqual([
    ['POST', '/api/conversations/fresh-security-test/runtime/ensure', {}],
    ['PUT', '/api/conversations/fresh-security-test/config-options/mode', { value: 'default' }],
  ]);
  expect(effectiveMode('auto', 'deny')).toBe('default'); expect(effectiveMode('auto', 'allow')).toBe('yolo'); expect(effectiveMode('readonly', 'allow')).toBe('default');
});
it('audit stores only bounded metadata, deduplicates updates and isolates accounts', () => {
  S.account = { id: 'a' } as typeof S.account;
  audit('conversation', 'call', 'ExecCommand', 'running'); audit('conversation', 'call', 'ExecCommand', 'completed');
  expect(readAudit()).toHaveLength(1); expect(readAudit()[0].status).toBe('completed');
  expect(Object.keys(readAudit()[0]).sort()).toEqual(['at', 'conversation', 'id', 'status', 'tool']);
  S.account = { id: 'b' } as typeof S.account; expect(readAudit()).toHaveLength(0);
  S.prefs.auditLog = false; audit('c', 'id', 'Write', 'completed'); expect(readAudit()).toHaveLength(0);
});
it('switching to readonly clears approvals even when commands follow task permissions', async () => {
  const c = { id: 'readonly-switch', remote: true, owner: 'pc', title: '', updated: 0, messages: [] };
  S.permission = 'auto'; S.prefs.allowInstall = 'allow'; await ensureTaskPermissions(c);
  m.api.mockClear(); S.permission = 'readonly'; m.api.mockResolvedValueOnce({ runtime: { has_task: true } });
  await ensureTaskPermissions(c);
  expect(m.api).toHaveBeenCalledWith('POST', '/api/conversations/readonly-switch/runtime/restart', {});
  expect(m.api).toHaveBeenLastCalledWith('PUT', '/api/conversations/readonly-switch/config-options/mode', { value: 'default' });
});
it('language changes actual UI text and persists; arbitrary user content is untouched', async () => {
  await savePreference('lang', 'English'); expect(t('开机自动启动')).toBe('Launch at login'); expect(t('我的私人笔记')).toBe('我的私人笔记');
  expect(document.documentElement.lang).toBe('en'); const restored = initialState(); loadPersisted(restored); expect(restored.prefs.lang).toBe('English');
  await expect(savePreference('lang', 'unknown')).rejects.toThrow('不支持');
});
it('old inactive auto-takeover default is not silently activated', () => {
  localStorage.setItem('lom-desktop-v1', JSON.stringify({ prefs: { autoTakeover: true } }));
  const restored = initialState(); loadPersisted(restored); expect(restored.prefs.autoTakeover).toBe(false);
});
it('publication rules change on the next turn and stay out of displayed user text', () => {
  const text = 'hello\nsecond line'; S.prefs.confirmPublish = true;
  const prefix = publicationPolicy(); expect(prefix).toContain('停止执行并等待'); expect(stripSettingsContext(`${prefix}\n\n${text}`)).toBe(text);
  expect(stripSettingsContext(text)).toBe(text); S.prefs.confirmPublish = false; expect(publicationPolicy()).not.toContain('停止执行并等待');
});
it('native sound honors background-only completion and the sound preference; preview plays explicitly', async () => {
  m.invoke.mockResolvedValue(undefined); S.prefs.sound = false; taskFinished('other'); expect(m.invoke).not.toHaveBeenCalled();
  S.prefs.sound = true; S.route = { name: 'chat' }; S.activeConv = 'visible';
  vi.spyOn(document, 'hasFocus').mockReturnValue(true); Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  taskFinished('visible'); expect(m.invoke).not.toHaveBeenCalled(); taskFinished('background'); expect(m.invoke).toHaveBeenCalledWith('completion_sound');
  m.invoke.mockClear(); S.prefs.sound = false; await chime(); expect(m.invoke).toHaveBeenCalledWith('completion_sound');
});
