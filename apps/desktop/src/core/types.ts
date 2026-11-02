/* ===== lom-core（AionCore）接口类型 =====
 * 手写，只包含前端用到的字段；接口稳定后改为生成（ADR 0012）。 */

export interface Endpoint {
  url: string;
  token: string;
  /** 默认工作文件夹（外壳启动时已创建好） */
  defaultFolder: string;
  homeDir: string;
}

export interface CoreProvider {
  id: string; platform: string; name: string; base_url: string; models: string[]; enabled: boolean; created_at: number;
}

export interface CoreConversation {
  id: string;
  name: string;
  type: string;
  model?: { provider_id: string; model: string };
  status?: string;
  created_at: number;
  modified_at: number;
  extra?: { lom_personal?: string; lom_personal_name?: string; lom_personal_directory?: string; lom_tier?: 'pro' | 'max' | 'mini'; lom_probe?: boolean; lom_history_id?: string; lom_history_context?: string; lom_history_raw?: string; lom_phone_scope?: string; lom_personal_scope?: string; mcp_server_ids?: string[]; workspace?: string; session_mode?: string; is_temporary_workspace?: boolean; agent_id?: string; agent_name?: string; backend?: string; lom_parent?: string; lom_team?: string; lom_side?: string; reasoning_effort?: string; thought_level?: string; teamId?: string };
}

export interface CoreMessage {
  id: string;
  msg_id: string;
  conversation_id: string;
  type: string;
  content: Record<string, unknown>;
  position?: 'left' | 'right' | 'center';
  status?: string;
  hidden?: boolean;
  created_at: number;
}

/** WebSocket 推送：{ name, data } */
export interface CoreEvent { name: string; data: Record<string, unknown>; }

/** message.stream 事件的 data */
export interface StreamData {
  conversation_id: string;
  msg_id: string;
  turn_id?: string;
  type: string;
  data: Record<string, unknown>;
  hidden?: boolean;
}

export interface CoreConfirmation {
  id: string; call_id: string; title?: string | null; action?: string | null; description: string; command_type?: string | null;
  options: { label: string; value: unknown }[];
  questions?: unknown;
}

/** Live ACP/session permissions use a nested tool call; REST recovery uses CoreConfirmation. */
export interface CorePermissionRequest {
  session_id: string;
  tool_call: { tool_call_id: string; title?: string; kind?: string; raw_input?: unknown };
  options: { option_id: string; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' }[];
}

export interface CoreAskQuestion {
  question: string; header?: string;
  options: { label: string; description?: string }[];
  multi_select?: boolean; multiSelect?: boolean;
}
export interface CoreAskAnswer { question: string; labels: string[]; }

export interface FsEntry { name: string; full_path: string; relative_path: string; }

// REST DTOs correspond to lom-core aionui-api-types/history_import.rs.
export type HistorySource = 'codex' | 'claude';
export interface HistoryEntry {
  id: string; source: HistorySource; session_id: string; title: string; cwd: string;
  timestamp: string; digest: string; bytes: number; events: number; warnings: string[];
}
export interface HistoryListing { entries: HistoryEntry[]; diagnostics: string[]; }
export interface HistoryEvent { line: number; kind: string; role: string; text: string; }
export interface HistoryPage { entry: HistoryEntry; events: HistoryEvent[]; next: number | null; }
export interface HistoryBundle { entry: HistoryEntry; transcript_path: string; raw_path: string; }
export interface ImportResult { imported: number; skipped: number; errors: string[]; }
