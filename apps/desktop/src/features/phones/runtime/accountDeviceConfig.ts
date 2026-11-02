import { S, update } from '@/state/store';
import type { AppState } from '@/state/state';
import type { Agent, TeamMember } from '@/state/types';

interface MemberSlot { index: number; member: TeamMember }
interface Config {
  version: 1;
  agents: Agent[];
  lit: Record<string, boolean>;
  groups: AppState['customGroups'];
  installed: AppState['installed'];
  subagents: AppState['subagents'];
  members: Record<string, MemberSlot[]>;
}
const prefix = 'lom.device-config.v1:';
let activeAccount: string | null = null;
let legacyMembers: Config['members'] = {};
let initialized = false;
const account = () => S.cloud === 'signed-in' ? S.account?.id || null : null;

function memberSlots(s: AppState, owns: (id: string) => boolean): Config['members'] {
  return Object.fromEntries(s.teams.map(t => [t.id, t.members.flatMap((member, index) => owns(member.agent) ? [{ index, member: { ...member } }] : [])]));
}

/** Store only device configuration; keys, documents and conversations stay in their existing stores. */
export function saveDeviceAccount(s: AppState = S) {
  if (!activeAccount || activeAccount !== account()) return;
  writeConfig(activeAccount, s);
}

function writeConfig(accountId: string, s: AppState) {
  const ids = s.phoneOrder.filter(id => s.agents[id]?.real), owned = new Set(ids);
  const config: Config = { version: 1,
    agents: ids.map(id => ({ ...s.agents[id], status: 'offline', battery: undefined, network: undefined })),
    lit: Object.fromEntries(ids.filter(id => s.lit[id] !== undefined).map(id => [id, s.lit[id]])),
    groups: Object.fromEntries(ids.map(id => [id, s.customGroups[id] || []])),
    installed: Object.fromEntries(ids.map(id => [id, s.installed[id] || []])),
    subagents: Object.fromEntries(ids.map(id => [id, s.subagents[id] || []])),
    members: memberSlots(s, id => owned.has(id)),
  };
  try { localStorage.setItem(prefix + accountId, JSON.stringify(config)); }
  catch { console.warn('phones.config_save_failed: 手机配置未能保存，当前会话仍可使用'); }
}

function hideDevices(s: AppState) {
  const ids = new Set(Object.values(s.agents).filter(a => a.real).map(a => a.id));
  const hidden = (id: string) => ids.has(id) || id.startsWith('dev_');
  s.phoneOrder = s.phoneOrder.filter(id => !hidden(id));
  for (const id of ids) {
    delete s.agents[id]; delete s.lit[id]; delete s.customGroups[id];
    delete s.installed[id]; delete s.subagents[id];
  }
  for (const t of s.teams) t.members = t.members.filter(m => !hidden(m.agent));
  if (hidden(s.phoneId)) s.phoneId = s.phoneOrder[0] || '';
}

function restoreMembers(s: AppState, members: Config['members'], owns: (id: string) => boolean) {
  for (const t of s.teams) for (const { index, member } of members[t.id] || []) {
    if (owns(member.agent) && !t.members.some(m => m.mid === member.mid)) t.members.splice(Math.min(index, t.members.length), 0, { ...member });
  }
}

function restoreConfig(id: string) {
  try {
    const raw = localStorage.getItem(prefix + id);
    if (!raw) return;
    const config = JSON.parse(raw) as Config;
    if (config.version !== 1 || !Array.isArray(config.agents)) throw new Error('配置格式错误');
    const agents = config.agents.filter(a => a.real && a.kind === 'phone'), ids = new Set(agents.map(a => a.id));
    update(s => {
      for (const a of agents) {
        s.agents[a.id] = { ...a, status: 'offline' }; s.phoneOrder.push(a.id);
        s.installed[a.id] = config.installed?.[a.id] || []; s.subagents[a.id] = config.subagents?.[a.id] || [];
        s.customGroups[a.id] = config.groups?.[a.id] || [];
        if (config.lit?.[a.id] !== undefined) s.lit[a.id] = config.lit[a.id];
      }
      restoreMembers(s, config.members || {}, key => ids.has(key));
    });
  } catch { console.warn('phones.config_read_failed: 手机配置无法读取，将从云端重新同步'); }
}

/** Sign-out hides private devices without interpreting it as a successful empty cloud roster. */
export function syncDeviceAccount() {
  const next = account();
  if (next === activeAccount && initialized) return;
  if (activeAccount) {
    writeConfig(activeAccount, S);
  } else if (!initialized) {
    // Migrate old global team references only after a cloud roster proves device ownership.
    legacyMembers = memberSlots(S, id => id.startsWith('dev_'));
  }
  initialized = true;
  update(hideDevices);
  activeAccount = next;
  if (next) restoreConfig(next);
}

export function restoreLegacyDeviceMembers(ids: Set<string>) {
  if (!activeAccount) return;
  update(s => restoreMembers(s, legacyMembers, id => ids.has(id)));
  for (const team of Object.keys(legacyMembers)) legacyMembers[team] = legacyMembers[team].filter(x => !ids.has(x.member.agent));
}
