import { afterEach, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ tauri: true, invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => h.tauri, invoke: h.invoke }));

import {
  discoverPluginHost, pluginExtensionUsable, pluginMethodUsable, PluginHostError, requestPluginHost,
  type PluginExtensionKind, type PluginHostDescriptor,
} from './pluginHost';

const kinds: PluginExtensionKind[] = ['EXTENSION_KIND_TOOL', 'EXTENSION_KIND_SERVICE', 'EXTENSION_KIND_EVENT_SOURCE',
  'EXTENSION_KIND_CHANNEL', 'EXTENSION_KIND_MODEL', 'EXTENSION_KIND_EXECUTOR', 'EXTENSION_KIND_AUTOMATION',
  'EXTENSION_KIND_UI', 'EXTENSION_KIND_STORAGE', 'EXTENSION_KIND_SANDBOX'];

// 与外壳当前返回一致：全部 reserved
const reservedHost: PluginHostDescriptor = {
  protocolVersions: ['lom.plugin.v1alpha1'], hostApiVersions: ['0.1.0'], platform: 'darwin-arm64', executionLevels: [],
  extensions: kinds.map(kind => ({ kind, apiVersions: [], status: 'SUPPORT_STATUS_RESERVED', verifiedMatrixRefs: [] })),
  services: [{ service: 'HOST_SERVICE_LOGGER', apiVersions: [], status: 'SUPPORT_STATUS_RESERVED' }],
  methods: [{ method: 'HOST_METHOD_SET_CHANNEL_GRANTS', status: 'SUPPORT_STATUS_RESERVED' }],
};

afterEach(() => { h.tauri = true; h.invoke.mockReset(); });

it('PLUGIN-API-01 discovery reads the shell descriptor and every reserved extension stays unusable', async () => {
  h.invoke.mockResolvedValue(reservedHost);
  const host = await discoverPluginHost();
  expect(h.invoke).toHaveBeenCalledWith('plugin_host_discover');
  for (const kind of kinds) expect(pluginExtensionUsable(host, kind)).toBe(false);
  expect(pluginMethodUsable(host, 'HOST_METHOD_SET_CHANNEL_GRANTS')).toBe(false);
});

it('PLUGIN-API-01 a reserved management request rejects with capability_unsupported and never resolves empty', async () => {
  h.invoke.mockRejectedValue({ code: 'plugin.capability_unsupported', retryable: false,
    messageKey: 'plugin.capabilityUnsupported', detail: { method: 'HOST_METHOD_INSTALL_PACKAGE' } });
  const outcome = requestPluginHost('HOST_METHOD_INSTALL_PACKAGE');
  await expect(outcome).rejects.toBeInstanceOf(PluginHostError);
  await expect(outcome).rejects.toMatchObject({ code: 'plugin.capability_unsupported', retryable: false,
    detail: { method: 'HOST_METHOD_INSTALL_PACKAGE' } });
  expect(h.invoke).toHaveBeenCalledWith('plugin_host_request', { method: 'HOST_METHOD_INSTALL_PACKAGE' });
});

it('PLUGIN-API-01 a shell failure without an error code is still a failure, not success', async () => {
  h.invoke.mockRejectedValue('command plugin_host_request not found');
  await expect(requestPluginHost('HOST_METHOD_INVOKE_CAPABILITY'))
    .rejects.toMatchObject({ code: 'plugin.host_unavailable', retryable: false });
});

it('PLUGIN-API-01 outside the desktop shell discovery and requests report the host as unavailable', async () => {
  h.tauri = false;
  await expect(discoverPluginHost()).rejects.toMatchObject({ code: 'plugin.host_unavailable' });
  await expect(requestPluginHost('HOST_METHOD_GET_CALL')).rejects.toMatchObject({ code: 'plugin.host_unavailable' });
  expect(h.invoke).not.toHaveBeenCalled();
});

it('PLUGIN-API-01 only an implemented status makes an entry usable; unknown or missing values do not', () => {
  const withStatus = (status: string): PluginHostDescriptor => ({ ...reservedHost,
    extensions: [{ kind: 'EXTENSION_KIND_TOOL', apiVersions: ['1.0.0'], status, verifiedMatrixRefs: [] }] });
  expect(pluginExtensionUsable(withStatus('SUPPORT_STATUS_IMPLEMENTED'), 'EXTENSION_KIND_TOOL')).toBe(true);
  expect(pluginExtensionUsable(withStatus('SUPPORT_STATUS_VERIFIED'), 'EXTENSION_KIND_TOOL')).toBe(false);
  expect(pluginExtensionUsable(withStatus('SUPPORT_STATUS_UNSPECIFIED'), 'EXTENSION_KIND_TOOL')).toBe(false);
  expect(pluginExtensionUsable(withStatus('SUPPORT_STATUS_IMPLEMENTED'), 'EXTENSION_KIND_CHANNEL')).toBe(false);
  expect(pluginExtensionUsable(undefined, 'EXTENSION_KIND_TOOL')).toBe(false);
});
