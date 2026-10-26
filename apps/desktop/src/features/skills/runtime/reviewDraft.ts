import { invoke, isTauri } from '@tauri-apps/api/core';
import { cloud } from '@/features/account/runtime/cloud';
export const readReviewDraft = (id: string) => cloud<{ summary: string; evidence: { summary_status: string; source_status: string } }>('GET', `/v1/skills/versions/${encodeURIComponent(id)}/draft`);
export const saveReviewSummary = (id: string, summary: string) => cloud('PATCH', `/v1/skills/versions/${encodeURIComponent(id)}/draft`, { summary });

export async function openSkillRepository(url: string) {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(url)) throw new Error('仓库地址无效');
  if (isTauri()) await invoke('skill_repository_open', { url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}
