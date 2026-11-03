/* PA-CONTEXT-01 / REFACTOR-01-M3：上下文超限的识别。
 * 先看结构化证据（核心的错误码、HTTP 413），只有没有结构化字段的旧错误和旧历史记录才按文字匹配；
 * 文字兼容规则只放在 LEGACY_OVERFLOW_TEXT 一处维护。识别结果在变成展示文字之前保留恢复动作。 */

/** 核心把 AgentErrorCode 序列化成 SCREAMING_SNAKE_CASE；只归一化 code 字段 */
const OVERFLOW_CODES = ['contexttoolarge', 'userllmprovidercontexttoolarge'];

/** 旧核心、上游服务商原文和已保存的旧历史：没有错误码时的文字兼容 */
const LEGACY_OVERFLOW_TEXT = /ContextTooLarge|context_length_exceeded|maximum context length|context window.*exceed|\bAPI\s+error\s*[:=]?\s*413\b|\bHTTP(?:\s+status)?\s*[:=]?\s*413\b|\b413\s+(?:Payload|Request Entity|Content) Too Large|(?:payload|request entity|content) too large/i;

const RECOVERY = { recovery: 'compact' as const, text: '上下文或请求体过大，模型未能完成这一轮。请先压缩上下文，完成后再手动发送任务。' };

function structuredOverflow(data: Record<string, unknown>) {
  const code = typeof data.code === 'string' ? data.code.replace(/[_-]/g, '').toLowerCase() : '';
  return OVERFLOW_CODES.includes(code) || data.status === 413 || data.http_status === 413;
}

function legacyOverflow(error: unknown, data: Record<string, unknown>) {
  const text = [typeof error === 'string' ? error : '', data.code, data.message, data.error, data.detail].filter(x => typeof x === 'string').join(' ');
  return LEGACY_OVERFLOW_TEXT.test(text);
}

export function contextRecovery(error: unknown): { recovery: 'compact'; text: string } | null {
  const data = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return structuredOverflow(data) || legacyOverflow(error, data) ? { ...RECOVERY } : null;
}
