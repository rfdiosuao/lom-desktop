import type { AgentRow } from './agents';

/* ===== UI-AUDIT-02 UI-02/04：Agent 状态只有这一份规则 =====
 * 分类、计数、徽标、能否加入切换器都从这里读，避免「可用」里出现不可用、未检测的条目。 */

export type AgentState = 'ok' | 'unchecked' | 'login' | 'error' | 'missing';

const LOGIN = /log ?in|sign ?in|auth|unauthori[sz]ed|credential|api[_ -]?key|401|403|未登录|登录|授权/i;

export function agentState(a: AgentRow): AgentState {
  if (!a.installed || a.status === 'missing') return 'missing';
  if (a.status === 'unchecked') return 'unchecked';
  if (a.status === 'offline' || !a.enabled) return LOGIN.test(a.last_check_error_message || '') ? 'login' : 'error';
  return 'ok';
}

export const STATE_BADGE: Record<AgentState, { text: string; tone?: 'ok' | 'warn' | 'danger' }> = {
  ok: { text: '可用', tone: 'ok' },
  unchecked: { text: '待检测' },
  login: { text: '需登录', tone: 'warn' },
  error: { text: '异常', tone: 'danger' },
  missing: { text: '未安装' },
};

/** 加入切换器：可用的直接加；待检测的允许先加，发任务前会再检测 */
export const canPin = (a: AgentRow) => a.enabled && (agentState(a) === 'ok' || agentState(a) === 'unchecked');

/** 失败原因的简短中文说法和下一步；原始错误另行放进可复制的诊断详情，不在这里丢掉 */
export function agentHint(a: AgentRow): string | undefined {
  const raw = a.last_check_error_message || '';
  switch (agentState(a)) {
    case 'missing': return `本机没有找到${a.backend ? `「${a.backend}」命令` : '这个 CLI'}。按它的官方说明安装后，点「重新检测」。`;
    case 'unchecked': return '还没有检测过。点「测试连接」确认能否启动。';
    case 'login': return '这个 CLI 需要先登录：在终端运行它并按提示完成登录，然后点「测试连接」。';
    case 'error':
      if (!a.enabled) return '这个 Agent 已被停用。';
      if (/ENOENT|not found|no such file|找不到/i.test(raw)) return '找不到可执行文件。请检查安装路径或 PATH，必要时重新安装后点「重新检测」。';
      if (/timed? ?out|timeout|超时/i.test(raw)) return '启动超时。请确认它在终端能正常运行，再点「测试连接」。';
      if (/initiali[sz]e|handshake|JSON|parse|protocol/i.test(raw)) return '启动握手失败，通常是 CLI 版本过旧或不支持 ACP。请更新到最新版后点「测试连接」。';
      return '连接失败。查看诊断详情，处理后点「测试连接」。';
    default: return undefined;
  }
}
