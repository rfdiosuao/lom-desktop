import type { IconName } from '@/shared/ui/iconPaths';
import type { CoreAskAnswer, CoreAskQuestion } from '@/core/types';

/* ===== 应用状态的类型定义 ===== */

export type AgentKind = 'computer' | 'phone' | 'user';
export type Mode = 'desktop' | 'phone';

export interface Agent {
  id: string;
  kind: AgentKind;
  name: string;
  persona: string;
  status: 'online' | 'offline';
  network?: string;
  battery?: number;
  soulConfigured?: boolean;
  model?: string;
  device?: string;
  lastSeen?: number;
  /** 真实配对的手机（R01，来自云端设备列表）；没有这个标记的是界面演示数据 */
  real?: boolean;
  /** PHONE-PROFILE-02：手机自己上报的应用名、版本（来自配对信息）和头像（data: URL，只在运行时，不进持久化配置） */
  appName?: string;
  appVersion?: string;
  logo?: string;
}

export interface Attachment { historyPaths?: string[]; historyId?: string; phoneFile?: { device: string; session: string; message: string; index: number }; name: string; ic?: IconName; preview?: string; path?: string; kind?: 'local' | 'upload'; }
/** 输入框里待发送的附件：本机文件直接给路径；粘贴、拖入的内容先上传到核心的托管目录 */
export interface DraftAttachment { historyPaths?: string[]; historyId?: string; file?: File; transferId?: string; transferDevice?: string; progress?: number; name: string; ic?: string; path?: string; kind?: 'local' | 'upload'; uploading?: boolean; preview?: string; }
export interface FileChange { path: string; add: number; del: number; }
/** 核心文件快照里的一项变更（WS-SNAPSHOT-01）：来自 git 状态或影子快照，不是工具调用推断 */
export interface SnapshotChange { path: string; relative: string; operation: 'create' | 'modify' | 'delete'; staged: boolean; }
export interface SnapshotView {
  workspace: string;
  /** guarded：工作文件夹太宽，等用户确认再建快照 */
  status: 'idle' | 'guarded' | 'loading' | 'ready' | 'error';
  mode?: 'git-repo' | 'snapshot'; branch?: string | null;
  /** 影子快照的基线建立时间（毫秒）；此前的改动不在其中 */
  since?: number;
  changes: SnapshotChange[]; error?: string; code?: string;
}
/** 发送一条消息时记下的文件状态（WS-SNAPSHOT-02）：路径 → 当时相对基线的操作，用来算「本轮」改了什么 */
export interface TurnBase {
  msgId: string; workspace: string; at: number;
  /** skipped：工作文件夹太宽，没有建快照；failed：读取失败，带原因 */
  status: 'pending' | 'ready' | 'skipped' | 'failed';
  files: Record<string, SnapshotChange['operation']>; code?: string; error?: string;
}
export interface PlanItem { text: string; done: boolean; }

export type MsgType =
  | 'user' | 'assistant' | 'thinking' | 'plan' | 'tool' | 'approval' | 'question'
  | 'files' | 'delegate' | 'handoff' | 'schedule' | 'system' | 'teammate';

export interface Msg {
  /** Observed terminal state for this user turn or explicit error record. */
  turnOutcome?: 'completed' | 'failed' | 'cancelled';
  /** schedule：定时任务；feishu / wechat：从该渠道发来（FEISHU-02） */
  source?: 'schedule' | 'feishu' | 'wechat' | 'personal' | 'phone_receipt' | 'dispatch_done' | 'team_chat';
  /** TEAM-CHAT-01：这条用户消息是哪条群聊发言投递来的（来自隐藏信封，不按名字匹配） */
  teamChat?: TeamChatMeta;
  /** 派发完成提醒对应的成员会话（来自渠道说明） */
  dispatchOf?: string;
  images?: string[];
  id: string;
  type: MsgType;
  at: number;
  /** CHAT-ACTIVITY-01：实际观测到的起止时间（毫秒）；旧记录缺失时不推算耗时。 */
  timing?: { startedAt: number; endedAt?: number };
  text?: string;
  /** PA-CONTEXT-01: explicit context failure recovery, never inferred from translated text. */
  recovery?: 'compact';
  /** REFACTOR-01-M3：压缩提示的状态与它所属的轮次（只结算这一轮的终态） */
  compaction?: 'running' | 'done' | 'failed' | 'unconfirmed' | 'stopped';
  compactTurn?: string;
  agent?: string;
  role?: string;
  streaming?: boolean;
  attachments?: Attachment[];
  items?: PlanItem[];
  tool?: string;
  detail?: string;
  status?: 'running' | 'done' | 'error' | 'pending' | 'approved' | 'denied' | 'queued' | 'submitting' | 'resolved' | 'unconfirmed';
  output?: string;
  changes?: FileChange[];
  to?: string;
  task?: string;
  phone?: string;
  stage?: 'help' | 'takeover' | 'returned';
  note?: string;
  title?: string;
  desc?: string;
  ic?: IconName;
  command?: string;
  /** lom-core 里对应的工具调用与确认请求 */
  callId?: string;
  confirmId?: string;
  confirmationOptions?: { label: string; value: string; action: 'deny' | 'once' | 'always' | 'choice' }[];
  confirmationSubmitted?: boolean;
  confirmationProblem?: string;
  confirmationEngine?: 'embedded' | 'session' | 'acp' | 'unknown';
  requestId?: string;
  questions?: CoreAskQuestion[];
  questionAnswers?: CoreAskAnswer[];
  remoteId?: string;
  /** 工具调用的原始工具名与参数（用于完成后生成文件变更、预览） */
  toolName?: string;
  args?: Record<string, unknown>;
}

export interface Conv {
  wechatOrigin?: boolean;
  /** ACP-PERM: requested mode is not an observed runtime mode. */
  agentModeChange?: { value: string; confirmation: 'pending_next_turn' | 'command_ack' };
  personal?: { id: string; name: string; directory: string; avatar?: string; image?: string };
  historyArchiveId?: string;
  historyContextPath?: string;
  historyRawPath?: string;
  phoneScope?: string;
  /** PA04：个人助理会话的调度工具 scope（`pa-` 开头） */
  personalScope?: string;
  id: string;
  owner: string;
  title: string;
  updated: number;
  preview?: null | 'building' | 'ready';
  phones?: string[];
  pinned?: boolean;
  messages: Msg[];
  /** true = 存在于 lom-core（真实的电脑任务）；false = 演示数据 */
  remote?: boolean;
  phoneSession?: string;
  /** Last phone-reported execution state; never infer completion from !running. */
  phoneRunStatus?: string;
  phoneSyncedAt?: number;
  phonePending?: { client_id: string; session_id: string; text: string; files?: string; policy?: string };
  workspace?: string;
  loaded?: boolean;
  /** 预览要显示的 html 文件（工作文件夹内的绝对路径） */
  previewFile?: string;
  /** lom-core 当前这一轮的 id（停止任务时需要） */
  turnId?: string;
  /** 这个任务使用的模型服务（用来判断是否走 Lom 云端积分） */
  providerId?: string;
  modelId?: string;
  lomTier?: 'pro' | 'max' | 'mini';
  /** 外部 Agent（Codex CLI 等）的任务：核心里的 Agent 编号与名称；Lom 自己的任务为空 */
  agentId?: string;
  agentName?: string;
  agentBackend?: string;
  /** 属于哪个 OPC 团队（团队里的会话不出现在「最近任务」里） */
  teamId?: string;
  parentTask?: string;
  /** 侧边聊天的临时会话：挂在哪个任务旁边（不出现在任务列表里） */
  sideOf?: string;
  /** Lom 任务的推理强度（low / medium / high），空 = 模型默认 */
  effort?: string;
}

export interface Schedule {
  phoneTask?: string; revision?: string; editable?: boolean; exact?: boolean;
  /** 已下发但结果未知的手机操作：请求标识、发起状态与发起时的任务版本，重启后校验一致才复用 */
  pendingRun?: string; pendingOp?: 'schedule.toggle' | 'schedule.delete' | 'schedule.run'; pendingRunAt?: number; pendingRunRuns?: number;
  pendingRunTask?: string; pendingRunRevision?: string;
  /** 最近一次待确认/同步问题的可见说明 */
  pendingError?: string;
  remote?: boolean; conversationId?: string; cron?: string; timezone?: string; scheduleDescription?: string; nextRun?: number; agentConfig?: Record<string, unknown>;
  id: string; name: string; exec: string; prompt: string;
  freq: 'once' | 'daily' | 'weekly' | 'interval' | 'custom'; time: string; days: number[]; every: number | string;
  runIn: 'same' | 'new'; enabled: boolean; auto?: boolean; last: number | null;
  runs: { at: number; ok: boolean; note?: string; sessionId?: string }[];
  /** 定时运行时的会话模式（default / auto_edit / yolo） */
  runMode?: string;
}

export interface Skill {
  id: string; name: string; author: string; cat: string; target: 'phone' | 'pc';
  color: string; ic: IconName; installs: string; rating: number; desc: string;
}

/** TEAM-CHAT-01：群聊发言的关联信息。from 只存身份标识，名称头像按标识实时取当前配置。 */
export interface TeamChatMeta { post: string; chain: string; hop: number; team: string; from: { kind: 'user' } | { kind: 'personal'; id: string; /** 发送时助理的名字，只在助理被删除后兜底显示；平时按 id 取当前名称 */ name?: string }; to: { key: string; name: string; role?: string }[] }
/** 群聊发言索引里一个接收者的投递状态（key：m:<成员 mid> 或 pa:<助理 id>） */
export interface TeamChatDelivery { key: string; state: 'pending' | 'accepted' | 'failed' | 'unconfirmed'; conv?: string; error?: string }
/** from/hop 只在从会话里恢复的发言上有（个人助理派的活）；用户在群聊里发的默认为用户、跳数 0 */
export interface TeamChatPost { id: string; at: number; chain: string; text: string; deliveries: TeamChatDelivery[]; from?: TeamChatMeta['from']; hop?: number }
export interface TeamMember { mid: string; agent: string; role: string; leader?: boolean; model?: string; }
/** real：真实团队（Leader 是 Lom 任务，成员是手机或本机 Agent）；leaderConv / memberConvs 是各自对应的会话 */
export interface Team { ownerAccountId?: string; id: string; name: string; folder: string; created: number; members: TeamMember[]; panes: Record<string, Msg[]>; real?: boolean; leaderConv?: string; memberConvs?: Record<string, string>; rosterSent?: string; core?: CoreTeamLink; /** TEAM-CHAT-01 发言索引（最多 200 条）与加入群聊的个人助理 */ chatPosts?: TeamChatPost[]; chatAssistant?: string; }
/** 真实团队在 lom-core 团队模式里的对应：内核团队编号、每个成员的 slot、Leader 助手和手机工具 */
export interface CoreTeamLink { id: string; slots: Record<string, string>; assistant: string; scope?: string; pendingSync?: boolean; }

export interface ModelOption {
  id: string; name: string; desc: string; cost: string;
  byok?: boolean; providerId?: string; model?: string; unavailable?: boolean; lomTier?: 'pro' | 'max' | 'mini';
}

export type { CoreProvider as Provider } from '@/core/types';

export type MenuCtx = Record<string, string | undefined> & { align?: 'start' | 'end'; key?: string; matchWidth?: string };
export interface MenuState { id: string; ctx: MenuCtx; key: string; rect: { left: number; right: number; top: number; bottom: number; width: number }; }
export interface ModalEntry { id: string; props: Record<string, unknown>; }

/** hidden：被隐藏的依赖 / 系统条目数；omitted：超过条目上限没有显示的数量（只在根节点上） */
export interface FileNode { name: string; path: string; type: 'dir' | 'file'; children?: FileNode[]; hidden?: number; omitted?: number; }
/** 打开的文件怎么显示：text 正文（truncated 表示被截断）、binary 只给类型和大小、large 太大没有读取 */
export interface OpenFileInfo { kind: 'text' | 'binary' | 'large'; size?: number; truncated?: boolean; }

export type ConnState = 'connecting' | 'ready' | 'offline';

export interface Layout { left: number; right: number; leftCollapsed: boolean; rightCollapsed: boolean; /** 技能商店、定时任务页是否展开工作区（默认不展开） */ rightOnPages?: boolean; }

export interface TurtleSession { active: boolean; started: boolean; other: string; showOther: boolean; request: string; error: string; }
