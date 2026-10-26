import { openSkillRepository } from '../runtime/reviewDraft';
import type { SkillSourceData } from '../runtime/skillMarket';
import { toastError } from '@/shared/overlays/controller';
export function SkillSource({ source }: { source?: SkillSourceData }) {
  if (source?.status !== 'verified' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(source.repository)) return null;
  return <span className="skill-source">开源 · {source.license}<a href={source.repository} target="_blank" rel="noopener noreferrer" title="查看开源仓库" aria-label="查看开源仓库" onClick={e => {
    e.stopPropagation(); e.preventDefault();
    void openSkillRepository(source.repository).catch(error => toastError('打开开源仓库失败', error));
  }}><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.53v-2.1c-3.1.68-3.76-1.32-3.76-1.32-.5-1.29-1.24-1.63-1.24-1.63-1.01-.69.08-.68.08-.68 1.12.08 1.7 1.15 1.7 1.15.99 1.7 2.61 1.21 3.25.92.1-.72.39-1.21.7-1.49-2.48-.28-5.08-1.24-5.08-5.52 0-1.22.43-2.22 1.15-3-.11-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.14A10.6 10.6 0 0 1 12 6.13c.94 0 1.88.13 2.76.38 2.12-1.44 3.05-1.14 3.05-1.14.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3.01 0 4.3-2.61 5.23-5.1 5.5.4.35.75 1.03.75 2.08V22c0 .3.2.64.77.53A11.1 11.1 0 0 0 12 .9Z"/></svg></a></span>;
}
