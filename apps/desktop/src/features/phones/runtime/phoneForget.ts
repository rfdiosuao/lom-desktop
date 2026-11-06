import type { AppState } from '@/state/state';
import { dropLink } from './deviceLink';
import { dropPhoneProfile } from './phoneProfile';
import { dropPhoneCapabilities } from './phoneCapabilities';
import { forgetPhoneChat } from './phoneChat';
import { forgetPhoneDocuments } from './phoneDocuments';
import { forgetPhoneModel } from './phoneModel';
import { forgetPhoneSubagents } from './phoneSubagents';

/* ===== PHONE-REPAIR-01：解除配对 / 手机从云端消失时，这台手机的本机状态只在这里清 =====
 * 以前各模块各清各的，漏掉了「当前手机」：解除唯一一台手机后 S.phoneId 变成 undefined，之后配对新手机也不会被选中，
 * 而界面用 phone() 回退显示新手机，发送却读原始 S.phoneId，消息发不出去，重启后才重新选择。 */

/** 当前手机必须是手机列表里存在的一台；没有就取第一台，列表空就是空串 */
export function ensurePhoneSelected(s: AppState) {
  if (!s.phoneOrder.includes(s.phoneId)) s.phoneId = s.phoneOrder[0] || '';
}

/** 清掉该手机的全部本机状态：连接记录、能力清单、模型确认、会话缓存、子代理 / 文档缓存、选择与导航 */
export function forgetPhone(s: AppState, id: string) {
  const convs = s.convs.filter(c => c.owner === id);
  dropLink(id);
  dropPhoneCapabilities(id);
  dropPhoneProfile(id);
  forgetPhoneModel(id);
  forgetPhoneSubagents(id);
  forgetPhoneDocuments(id);
  forgetPhoneChat(id, convs.map(c => c.id));
  for (const c of convs) { delete s.running[c.id]; delete c.phonePending; }
  if (convs.some(c => c.id === s.activeConv)) { s.activeConv = null; if (s.route.name === 'chat') s.route = { name: 'home' }; }
  s.phoneOrder = s.phoneOrder.filter(x => x !== id);
  delete s.lit[id];
  delete s.agents[id];
  s.teams.forEach(t => { t.members = t.members.filter(m => m.agent !== id); });
  ensurePhoneSelected(s);
}
