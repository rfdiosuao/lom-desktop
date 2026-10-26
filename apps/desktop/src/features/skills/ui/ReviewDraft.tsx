import { useEffect, useState } from 'react';
import { Btn } from '@/shared/ui/Button';
// API access stays in the runtime adapter below; author may correct prose, never self-verify a source.
import { readReviewDraft, saveReviewSummary } from '../runtime/reviewDraft';
export function ReviewDraft({ id }: { id: string }) {
  const [summary, setSummary] = useState(''), [info, setInfo] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void readReviewDraft(id).then(r => { if (active) { setSummary(r.summary); setInfo(`${r.evidence.summary_status === 'pending' ? '简介待补充' : '简介可校正'} · ${r.evidence.source_status === 'verified' ? '开源来源已核验' : '来源待复核'}`); } }, e => { if (active) setError(String(e.message || e)); }); return () => { active = false; }; }, [id]);
  return <div><p className="muted">{info}</p><textarea className="textarea" aria-label="审核简介" maxLength={120} value={summary} onChange={e => setSummary(e.target.value)} /><Btn label="保存简介" disabled={busy || !summary.trim()} onClick={() => { setBusy(true); setError(''); void saveReviewSummary(id, summary).then(() => setInfo('简介已保存，等待人工审核'), e => setError(String(e.message || e))).finally(() => setBusy(false)); }} />{error && <p role="alert">{error}</p>}</div>;
}
