/* UI-AUDIT-04：团队活动读取失败的提示。
 * 按核心错误码（CoreError.code）给出用户看得懂的原因和固定错误码；原始报错只写进控制台，不显示给用户。 */

const BY_CODE: Record<string, [code: string, text: string]> = {
  LOM_CORE_NOT_READY: ['team.activity_core_not_ready', 'Lom 核心服务还没有启动，稍后重试'],
  LOM_CORE_UNREACHABLE: ['team.activity_unreachable', '连接不上 Lom 核心服务，请确认 Lom 仍在运行后重试'],
  LOM_CORE_CANCELLED: ['team.activity_timeout', '读取超时，请重试'],
  LOM_CORE_BAD_RESPONSE: ['team.activity_bad_response', '核心服务返回了无法识别的内容，请重试'],
};
const FALLBACK: [string, string] = ['team.activity_failed', '团队活动暂时读不到，请重试'];

/** 返回「原因（错误码）」；认不出的错误归入 team.activity_failed。 */
export function activityErrorText(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const [id, text] = (typeof code === 'string' && Object.hasOwn(BY_CODE, code)) ? BY_CODE[code] : FALLBACK;
  return `${text}（${id}）`;
}
