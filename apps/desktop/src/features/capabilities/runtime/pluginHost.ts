import { invoke, isTauri } from '@tauri-apps/api/core';

/*
 * PLUGIN-API-01：插件宿主能力发现。外壳的 Tauri 命令返回与 lom.plugin.v1alpha1 HostDescriptor
 * proto JSON 映射同名的字段；这里是进程内调用（ADR 0003），以后改用生成类型只需替换类型声明。
 * 页面只能通过 pluginExtensionUsable 决定是否显示入口：reserved 的能力不显示可点但不能用的按钮。
 */

export type PluginSupportStatus = 'SUPPORT_STATUS_RESERVED' | 'SUPPORT_STATUS_IMPLEMENTED';
export type PluginExtensionKind =
  | 'EXTENSION_KIND_TOOL' | 'EXTENSION_KIND_SERVICE' | 'EXTENSION_KIND_EVENT_SOURCE' | 'EXTENSION_KIND_CHANNEL'
  | 'EXTENSION_KIND_MODEL' | 'EXTENSION_KIND_EXECUTOR' | 'EXTENSION_KIND_AUTOMATION' | 'EXTENSION_KIND_UI'
  | 'EXTENSION_KIND_STORAGE' | 'EXTENSION_KIND_SANDBOX';

export interface PluginHostDescriptor {
  protocolVersions: string[];
  hostApiVersions: string[];
  platform: string;
  executionLevels: string[];
  extensions: { kind: string; apiVersions: string[]; status: string; verifiedMatrixRefs: string[] }[];
  services: { service: string; apiVersions: string[]; status: string }[];
  methods: { method: string; status: string }[];
}

/** lom.common.v1.LomError 的 JSON 形状。 */
interface LomErrorShape { code: string; retryable: boolean; messageKey: string; detail?: Record<string, string> }

export class PluginHostError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly messageKey: string,
    readonly detail: Record<string, string> = {}) {
    super(code);
    this.name = 'PluginHostError';
  }
}

const hostUnavailable = () =>
  new PluginHostError('plugin.host_unavailable', false, 'plugin.hostUnavailable', { reason: 'not_in_shell' });

function isLomError(value: unknown): value is LomErrorShape {
  const v = value as Partial<LomErrorShape> | null;
  return !!v && typeof v.code === 'string' && v.code.length > 0 && typeof v.retryable === 'boolean';
}

/** 只读发现。浏览器开发模式下没有外壳，明确报宿主不可用，不编造一份描述。 */
export async function discoverPluginHost(): Promise<PluginHostDescriptor> {
  if (!isTauri()) throw hostUnavailable();
  return invoke<PluginHostDescriptor>('plugin_host_discover');
}

/**
 * 所有插件管理与调用请求的唯一入口。外壳对 reserved 方法返回 plugin.capability_unsupported；
 * 外壳给出的不是 LomError 时同样按失败处理，绝不把它当成功。
 */
export async function requestPluginHost(method: string): Promise<unknown> {
  if (!isTauri()) throw hostUnavailable();
  try {
    return await invoke<unknown>('plugin_host_request', { method });
  } catch (error) {
    if (isLomError(error)) throw new PluginHostError(error.code, error.retryable, error.messageKey, error.detail);
    throw new PluginHostError('plugin.host_unavailable', false, 'plugin.hostUnavailable', { reason: String(error) });
  }
}

/** 只有 implemented 才算可用；reserved、缺项或不认识的状态值一律不可用。 */
export function pluginExtensionUsable(host: PluginHostDescriptor | undefined, kind: PluginExtensionKind): boolean {
  return host?.extensions.some(e => e.kind === kind && e.status === 'SUPPORT_STATUS_IMPLEMENTED') ?? false;
}

/** 同上，用于管理方法（例如安装、切换渠道授权）的入口。 */
export function pluginMethodUsable(host: PluginHostDescriptor | undefined, method: string): boolean {
  return host?.methods.some(m => m.method === method && m.status === 'SUPPORT_STATUS_IMPLEMENTED') ?? false;
}
