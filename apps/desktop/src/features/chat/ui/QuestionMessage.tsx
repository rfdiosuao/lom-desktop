import { useState } from 'react';
import type { CoreAskAnswer, CoreAskQuestion } from '@/core/types';
import type { Msg } from '@/state/types';
import { Btn } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Layout';
import { answerQuestion, completeAnswers } from '../runtime/questions';
import { EventCard } from './EventCard';

interface Pick { labels: string[]; text: string; }
const multi = (q: CoreAskQuestion) => !!(q.multi_select || q.multiSelect);
const answersOf = (questions: CoreAskQuestion[], picks: Pick[]): CoreAskAnswer[] => questions.map((q, i) => ({
  question: q.question, labels: [...(picks[i]?.labels || []), ...(picks[i]?.text.trim() ? [picks[i].text.trim()] : [])],
}));

function QuestionFields({ question: q, pick, disabled, onChange }: { question: CoreAskQuestion; pick: Pick; disabled: boolean; onChange: (pick: Pick) => void }) {
  const select = (label: string) => {
    const labels = multi(q) ? pick.labels.includes(label) ? pick.labels.filter(l => l !== label) : [...pick.labels, label] : [label];
    onChange({ labels, text: multi(q) ? pick.text : '' });
  };
  return <fieldset disabled={disabled} className="field">
    <legend>{q.header ? `${q.header} · ` : ''}{q.question}{multi(q) ? '（可多选）' : ''}</legend>
    <div className="stack">
      {q.options.map((o, i) => <Btn key={i} label={o.description ? `${o.label} · ${o.description}` : o.label} active={pick.labels.includes(o.label)} onClick={() => select(o.label)} />)}
      <label>其他回答<Input value={pick.text} onChange={text => onChange({ labels: multi(q) ? pick.labels : [], text })} /></label>
    </div>
  </fieldset>;
}

export function QuestionMessage({ m, ctxId }: { m: Msg; ctxId: string }) {
  const questions = m.questions || [];
  const [picks, setPicks] = useState<Pick[]>(() => questions.map(() => ({ labels: [], text: '' })));
  const pending = m.status === 'pending', submitting = m.status === 'submitting';
  const answers = answersOf(questions, picks);
  const title = submitting ? '正在提交回答…' : pending ? '需要你回答' : m.status === 'done' ? '已提交回答' : m.status === 'denied' ? '已跳过提问' : '提问已由其他客户端处理';
  return <EventCard m={m} ic="message" tone="info" title={title} toggle={false}
    body={pending || submitting ? questions.map((q, i) => <QuestionFields key={i} question={q} pick={picks[i]} disabled={submitting}
      onChange={pick => setPicks(previous => previous.map((p, n) => n === i ? pick : p))} />)
      : m.questionAnswers?.map((a, i) => <p key={i}>{a.question}：{a.labels.join('、')}</p>)}
    foot={pending || submitting ? <>
      <Btn label="跳过提问" variant="ghost" size="sm" disabled={submitting} onClick={() => void answerQuestion(ctxId.replace(/^conv:/, ''), m, null)} />
      <Btn label="提交回答" variant="primary" size="sm" disabled={submitting || !completeAnswers(questions, answers)} onClick={() => void answerQuestion(ctxId.replace(/^conv:/, ''), m, answers)} />
    </> : undefined} />;
}
