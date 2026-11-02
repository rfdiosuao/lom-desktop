import type { HistoryEntry } from '@/core/types';
/** /goal 的状态：开始时间（也用作完成标记的编号）、暂停、自动推进了几轮 */
export interface Goal { text: string; at: number; done?: boolean; doneAt?: number; paused?: boolean; pausedAt?: number; pausedMs?: number; turns?: number; note?: string }
import type { CommandSkill } from '@/features/chat/runtime/commandSkills';
import type { Plans, Subscription } from '@/features/account/runtime/plans';
import type { AgentRow } from '@/features/settings/runtime/agents';
import type { AgentOption } from '@/features/settings/runtime/agentOptions';
import type { Notice } from '@/features/account/runtime/notices';
import type { FeedbackThread } from '@/features/account/runtime/feedback';
import type { TurtleSession } from './types';
import { demoAgents, demoPhoneConvs, demoPhoneData, demoSchedules, demoSkills, demoTeams } from '@/demo/fixtures';
import type { Agent, ConnState, DraftAttachment, Conv, FileNode, Layout, MenuState, ModalEntry, Mode, Provider, Schedule, Skill, Team } from './types';

/* ===== 应用状态：单一状态树，由 store.ts 的 update() 修改 ===== */

export interface Route { name: string; id?: string; }
export interface NavSnap { mode: Mode; route: Route; activeConv: string | null; phoneId: string; agentPick?: string; }
export interface Toast { text: string; icon: string; key: number; tone?: 'ok' | 'info' | 'error'; }

export const initialState = () => {
  const phone = demoPhoneData();
  return {
    /* 导航 */
    mode: 'desktop' as Mode, route: { name: 'home' } as Route, back: [] as NavSnap[], fwd: [] as NavSnap[],
    phoneId: 'p1', activeConv: null as string | null,
    /* 布局（可拖拽、可收起，持久化） */
    layout: { left: 276, right: 380, leftCollapsed: false, rightCollapsed: false } as Layout,
    theme: 'light' as 'light' | 'dark' | 'system',
    /* 工作区 */
    wsTab: 'preview' as 'preview' | 'files' | 'plan' | 'changes' | 'phone', live: true, quality: '自动', previewDevice: 'desktop' as 'desktop' | 'mobile',
    workspaceBrowseRoot: '' as string,
    openFile: null as string | null, openFileContent: '' as string, treeOpen: {} as Record<string, boolean>,
    files: null as FileNode | null, filesLoading: false, filesError: '' as string,
    previewHtml: '' as string, previewAt: 0, previewError: '' as string,
    /* 输入 */
    lit: { p1: true, p2: true, p3: false } as Record<string, boolean>, homeExtra: [] as string[],
    folder: '' as string, recentFolders: [] as string[], homeDir: '' as string,
    permission: 'ask', model: '' as string, phoneModel: 'lom-mini',
    turtles: {} as Record<string, TurtleSession>,
    drafts: {} as Record<string, string>, attachments: {} as Record<string, DraftAttachment[]>,
    /* 连接 lom-core */
    conn: 'connecting' as ConnState, connError: '' as string, providers: [] as Provider[], tasksLoaded: false,
    /* Lom 云端：HEANG 账号与积分（S04-01） */
    cloud: 'checking' as 'checking' | 'unavailable' | 'signed-out' | 'signing-in' | 'signed-in', cloudError: '' as string, cloudScheduleError: '' as string,
    account: null as null | { id: string; email: string; name: string; avatar?: string; provider_avatar?: string },
    points: null as null | { total: number; free: number; paid: number; period: string; daily?: number },
    cloudModels: null as null | { pro: string; max: string; mini: string },
    cloudLegacy: {} as import('@/features/account/runtime/modelBinding').LegacyModels,
    cloudModelRevision: -1,
    cloudAllowed: null as null | ('pro' | 'max' | 'mini')[],
    /** 订阅里另外包含的星钥模型（后台勾选） */
    cloudExtra: [] as string[],
    /** 能直接看图的档位（服务端下发） */
    cloudVision: [] as ('pro' | 'max' | 'mini')[],
    /* 订阅：套餐与我的订阅，从麓鸣服务读取（A03） */
    plans: null as null | Plans, subscription: null as null | Subscription, plansError: '' as string,
    /* 公告与意见反馈（A04） */
    notices: [] as Notice[], noticeSeen: [] as string[], feedback: [] as FeedbackThread[],
    /* 其他 Agent（Codex CLI、Claude Code…）：核心检测到的列表、加进切换器的、新任务要用的（'' = Lom） */
    agentCatalog: null as null | AgentRow[], agentsError: '' as string, agentPins: [] as string[], agentPick: '' as string, historyAgentPick: '' as string, historyImports: [] as HistoryEntry[], historyImportError: '' as string, historyHidden: [] as string[],
    /** 外部 Agent：每个任务读到的选项（模型等）；新任务页为每个 Agent 预选的模型 */
    agentOptions: {} as Record<string, AgentOption[]>, agentModelPick: {} as Record<string, string>,
    /** 外部 Agent：新任务页为每个 Agent 预选的推理强度（它 CLI 自己报的档位值） */
    agentEffortPick: {} as Record<string, string>,
    /** /goal：每个任务（conv:<id>，新任务页是 home）的目标，会随每条消息带给 Agent */
    goals: {} as Record<string, Goal>,
    /** 侧边聊天：在哪个任务旁边开的、对应的临时会话 */
    personalPanel: null as null | { account: string; minimized: boolean; rect?: { x: number; y: number; w: number; h: number } },
    sideChat: null as null | { parent: string; conv?: string; creating?: boolean; error?: string; minimized?: boolean },
    /** 新任务页选的推理强度（Lom 自己的模型）；空 = 模型默认 */
    effortPick: '' as string,
    /* Agent 与会话 */
    agents: demoAgents() as Record<string, Agent>, phoneOrder: ['p1', 'p2', 'p3'],
    convs: demoPhoneConvs() as Conv[],
    customGroups: { p1: [], p2: [], p3: [] } as Record<string, { id: string; name: string }[]>,
    convGroup: {} as Record<string, string>, groupFold: {} as Record<string, boolean>,
    convPhones: {} as Record<string, string[]>,
    running: {} as Record<string, boolean>, pending: {} as Record<string, () => void>, takeover: null as string | null,
    /* 定时任务 / 技能 / 团队（演示） */
    schedules: demoSchedules() as Schedule[], skills: demoSkills() as Skill[],
    commandSkills: { items: [] as CommandSkill[], loading: false, error: '' },
    installed: phone.installed, mySkills: phone.mySkills,
    subagents: phone.subagents, souls: phone.souls, memories: phone.memories, authorizedPCs: phone.authorizedPCs,
    teams: demoTeams() as Team[], teamView: 'board' as 'board' | 'side' | 'single', teamFocus: 'm1',
    /* 设置 */
    settingsPage: 'connections',
    prefs: { reconnect: true, notify: true, launchAtLogin: false, sound: true, lang: '简体中文', supervise: 30, autoTakeover: false, notifyHelp: true, cellularCap: true, confirmPublish: true, auditLog: true, allowInstall: 'ask' } as Record<string, string | number | boolean>,
    /* 界面瞬时状态 */
    menu: null as MenuState | null, modals: [] as ModalEntry[], toast: null as Toast | null,
    q: { skill: '', palette: '', conv: '', memory: '', assist: '', sched: '' } as Record<string, string>,
    skillCat: 'all', skillTab: 'discover', schedFilter: 'all', soulPreview: true, soulDirty: {} as Record<string, boolean>,
    eventOpen: {} as Record<string, boolean>, convSearch: false, paletteIdx: 0,
    /** 弹窗表单是自由结构，各弹窗自己约定字段 */
    form: {} as Record<string, any>,
    focusNext: null as string | null,
  };
};

export type AppState = ReturnType<typeof initialState>;

/* ---------- 持久化（只存设置、布局和本机偏好） ---------- */
const PERSIST_KEY = 'lom-desktop-v1';
const PERSIST_FIELDS: (keyof AppState)[] = ['layout', 'theme', 'quality', 'live', 'permission', 'model', 'phoneModel', 'prefs', 'teamView', 'lit', 'folder', 'recentFolders', 'convPhones', 'turtles', 'agentPins', 'agentPick', 'historyAgentPick', 'historyHidden', 'agentModelPick', 'agentEffortPick', 'goals', 'effortPick', 'customGroups', 'convGroup', 'groupFold', 'teams'];

export const loadPersisted = (s: AppState) => {
  let saved: Partial<AppState> = {};
  try { saved = JSON.parse(localStorage.getItem(PERSIST_KEY) || '{}'); } catch { saved = {}; }
  const target = s as Record<string, unknown>;
  for (const k of PERSIST_FIELDS) {
    const v = saved[k];
    if (v === undefined) continue;
    const cur = target[k];
    target[k] = cur && typeof cur === 'object' && !Array.isArray(cur) ? { ...cur, ...(v as object) } : v;
  }
  if (!saved.prefs?.settingsV2) { s.prefs.autoTakeover = false; s.prefs.settingsV2 = true; }
  // D33：旧宫格与无效偏好迁移到看板；保留用户的并排 / 单个选择。
  if (!['side', 'board', 'single'].includes(s.teamView)) s.teamView = 'board';
  // 重新打开 Lom 时没有哪一轮还在替目标干活：进行中的目标先暂停，点「继续」再推进
  const now = Date.now();
  for (const g of Object.values(s.goals)) if (!g.done && !g.paused) { g.paused = true; g.pausedAt = now; g.note = '重新打开了 Lom，目标已暂停'; }
};

let lastSaved = '';
/** update() 每次都会调用；内容没变就不写本地存储（流式回复时每帧都会走到这里） */
export const persist = (s: AppState) => {
  const o: Record<string, unknown> = {};
  for (const k of PERSIST_FIELDS) o[k] = s[k];
  const text = JSON.stringify(o);
  if (text === lastSaved) return;
  try { localStorage.setItem(PERSIST_KEY, text); lastSaved = text; } catch { /* 隐私模式下无法写入，只影响偏好保存 */ }
};
