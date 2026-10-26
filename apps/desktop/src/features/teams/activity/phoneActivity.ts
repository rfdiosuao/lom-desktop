import type { AppState } from '@/state/state';
import type { Conv, Team } from '@/state/types';
import type { BoardLane } from './ActivityBoard';
import type { ActivityItem } from './activityTypes';

/** Local phone snapshots are distinct from the core mailbox: no synthetic read receipts. */
export interface PhoneActivity {
  conversationId: string;
  title: string;
  category: 'message' | 'task';
  label: string;
  text: string;
  files: number;
  system?: boolean;
  finished?: boolean;
}

export const phoneLaneId = (memberId: string) => `phone:${memberId}`;

export function teamPhoneConversations(team: Team, state: AppState): Conv[] {
  if (!team.real || state.cloud !== 'signed-in' || !state.account?.id) return [];
  const devices = new Set(team.members.filter(m => state.agents[m.agent]?.real).map(m => m.agent));
  return state.convs.filter(c => !c.remote && c.teamId === team.id && devices.has(c.owner));
}

export function phoneActivityLanes(team: Team, state: AppState): BoardLane[] {
  if (!team.real || state.cloud !== 'signed-in' || !state.account?.id) return [];
  return team.members.flatMap(member => {
    const phone = state.agents[member.agent];
    if (!phone?.real || phone.kind !== 'phone') return [];
    return [{ slotId: phoneLaneId(member.mid), memberId: member.mid, agentId: phone.id,
      name: phone.name, local: true, status: phone.status === 'online' ? '在线' : '离线' }];
  });
}

function taskStatus(conv: Conv, state: AppState) {
  if (state.agents[conv.owner]?.status !== 'online') return { label: '离线 · 执行状态未知', finished: false };
  if (conv.phonePending) return { label: '发送结果待确认', finished: false };
  if (conv.phoneRunStatus === 'unknown') return { label: '同步中断 · 执行状态未知', finished: false };
  if (state.running[conv.id]) return { label: '执行中', finished: false };
  if (!conv.loaded) return { label: '等待同步', finished: false };
  const labels: Record<string, string> = { completed: '已完成', cancelled: '已取消', failed: '执行失败', timeout: '已超时', interrupted: '已中断', accepted: '手机已接受', idle: '上次同步未在运行' };
  const status = conv.phoneRunStatus || '';
  return { label: labels[status] || '执行状态未知', finished: status === 'completed' || status === 'cancelled' };
}

export function buildPhoneActivity(team: Team, state: AppState): ActivityItem[] {
  return teamPhoneConversations(team, state).flatMap(conv => {
    const member = team.members.find(m => m.agent === conv.owner)!;
    const lane = phoneLaneId(member.mid);
    const base = { conversationId: conv.id, title: conv.title };
    const status = taskStatus(conv, state);
    const items: ActivityItem[] = [{ kind: 'phone', id: `phone-task:${conv.id}`, lane, createdAt: conv.phoneSyncedAt || conv.updated,
      phone: { ...base, category: 'task', text: conv.title, files: 0, ...status } }];
    // Only original phone messages are included. Leader tool results remain in the desktop lane.
    for (const msg of conv.messages) {
      if (!['user', 'assistant', 'system'].includes(msg.type)) continue;
      if (!msg.text && !msg.attachments?.length) continue;
      items.push({ kind: 'phone', id: `phone-message:${conv.id}:${msg.id}`, lane, createdAt: msg.at,
        phone: { ...base, category: 'message', label: msg.type === 'user' ? '发给手机' : msg.type === 'system' ? '同步提示' : '手机回复',
          text: msg.text || '', files: msg.attachments?.length || 0, system: msg.type === 'system' } });
    }
    return items;
  });
}
