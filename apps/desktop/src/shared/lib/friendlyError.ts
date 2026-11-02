/* ===== D37：把错误换成用户看得懂的话 =====
 * 代码里写好的中文提示原样保留（它们已经说明了原因和怎么办，也区分“失败 / 未确认”）；
 * 核心、网络、操作系统返回的英文或技术细节换成通用说法，原文只留在控制台，不弹给用户。 */

/** 核心常见的英文报错 → 中文（匹配到才替换；子串匹配，大小写不敏感） */
const KNOWN: [RegExp, string][] = [
  [/must keep their original assistant/i, '这个定时任务固定在原会话里运行，不能更换助理'],
  [/immutable post-creation/i, '这个任务的技能和工具在创建时已固定，不能修改'],
  [/(not found|no such (file|conversation|task))/i, '内容已不存在，刷新后再试'],
  [/(unauthori[sz]ed|forbidden|invalid token|token expired)/i, '登录状态已失效，请重新登录'],
  [/(timed? ?out|deadline exceeded)/i, '等待超时，请重试'],
  [/(failed to fetch|networkerror|load failed|econnrefused|connection refused|network|offline)/i, '连接不上 Lom 服务，请检查网络后重试'],
  [/(permission denied|access denied|operation not permitted|denied)/i, '没有权限访问，请检查文件或文件夹权限'],
  [/(too many requests|rate limit)/i, '操作太频繁，请稍后再试'],
  [/(quota|insufficient|balance)/i, '积分不足，请充值后再试'],
  [/(already running|in progress|busy)/i, '还在处理上一个操作，请稍后再试'],
];

const BY_STATUS: [number, number, string][] = [
  [401, 403, '登录状态已失效，请重新登录'],
  [404, 404, '内容已不存在，刷新后再试'],
  [409, 409, '状态已经变化，刷新后再试'],
  [413, 413, '内容太大，请精简后再试'],
  [429, 429, '操作太频繁，请稍后再试'],
  [500, 599, '服务暂时出了点问题，请稍后再试'],
];

const CJK = /[一-鿿]/;
const GENERIC = '没有完成，请重试';

/** 去掉写给开发者的错误码前缀（如 `personal.xxx：`、`feishu.xxx: `），保留后面的中文说明 */
const stripCode = (text: string) => text.replace(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+\s*[:：]\s*/i, '').trim();

export function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const status = (error as { status?: unknown } | null)?.status;
  const text = stripCode(raw);
  if (text && CJK.test(text)) return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  for (const [pattern, friendly] of KNOWN) if (pattern.test(raw)) return friendly;
  if (typeof status === 'number') for (const [from, to, friendly] of BY_STATUS) if (status >= from && status <= to) return friendly;
  return GENERIC;
}
