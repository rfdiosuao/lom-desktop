import { agent, skill } from '@/state/selectors';
import { S } from '@/state/store';
import { openModal } from '@/shared/overlays/controller';
import { unavailable } from '@/shared/lib/unavailable';

/* ---------- skillhub ---------- */
export const skillDetail = (id: string) => openModal('skill', { id });

export function installSkill(id: string, agentId: string) {
  if (agent(agentId) && skill(id)) unavailable('技能安装');
}
export function uninstallSkill(id: string, agentId: string) {
  if (agent(agentId) && skill(id)) unavailable('技能卸载');
}

export function uploadSkill(id?: string) {
  const m = id ? S.mySkills.find(x => x.id === id) : undefined;
  S.form = { name: m?.name || '', desc: '', target: 'phone', vis: 'public', file: m ? '已上架版本.lomskill' : '' };
  openModal('upload', { id });
}

export function saveUpload() { unavailable('技能上传审核'); }
export function unpublish(id: string) {
  if (S.mySkills.some(x => x.id === id)) unavailable('技能下架');
}
