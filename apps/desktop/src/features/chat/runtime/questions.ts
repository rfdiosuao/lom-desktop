import { api } from '@/core/client';
import type { CoreAskAnswer, CoreAskQuestion } from '@/core/types';
import { S, update } from '@/state/store';
import type { Conv, Msg } from '@/state/types';
import { uid } from '@/shared/lib/util';
import { toastError } from '@/shared/overlays/controller';

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};

export function askQuestions(raw: unknown): CoreAskQuestion[] | null {
  const list = Array.isArray(raw) ? raw : record(raw).questions;
  if (!Array.isArray(list) || !list.length) return null;
  const valid = list.every(q => typeof q?.question === 'string' && q.question.trim() && Array.isArray(q.options)
    && q.options.every((o: unknown) => typeof record(o).label === 'string' && record(o).label));
  return valid ? list as CoreAskQuestion[] : null;
}

export function onAsk(c: Conv, requestId: unknown, raw: unknown, confirmId?: string) {
  const questions = askQuestions(raw);
  if (typeof requestId !== 'string' || !requestId || !questions) {
    c.messages.push({ id: uid('m'), type: 'system', at: Date.now(), text: '提问数据不完整，未提交任何回答，请停止任务后重试。', ic: 'info' });
    return;
  }
  if (c.messages.some(m => m.type === 'question' && m.requestId === requestId)) return;
  c.messages.push({ id: uid('m'), type: 'question', at: Date.now(), status: 'pending', requestId, confirmId: confirmId || requestId, questions });
}

export function completeAnswers(questions: CoreAskQuestion[], answers: CoreAskAnswer[]) {
  return questions.length > 0 && Array.isArray(answers) && answers.length === questions.length && questions.every(q => {
    const a = answers.filter(answer => answer.question === q.question);
    return a.length === 1 && Array.isArray(a[0].labels) && a[0].labels.length > 0 && a[0].labels.every(label => typeof label === 'string' && !!label.trim())
      && ((q.multi_select || q.multiSelect) || a[0].labels.length === 1);
  });
}

export async function answerQuestion(convId: string, m: Msg, answers: CoreAskAnswer[] | null) {
  if (m.type !== 'question' || m.status !== 'pending' || !m.requestId) return false;
  if (answers !== null && !completeAnswers(m.questions || [], answers)) {
    toastError('提交回答失败', new Error('请回答每一个问题；单选问题只能选一个答案。'));
    return false;
  }
  if (!S.convs.some(c => c.id === convId && c.remote && c.messages.includes(m))) return false;
  update(() => { m.status = 'submitting'; });
  try {
    await api('POST', `/api/conversations/${convId}/asks/${encodeURIComponent(m.requestId)}/answer`, answers ? { answers } : { decline: true });
    if (!S.convs.some(c => c.id === convId && c.messages.includes(m)) || !['submitting', 'resolved'].includes(m.status || '')) return false;
    update(() => { m.status = answers ? 'done' : 'denied'; m.questionAnswers = answers || undefined; });
    return true;
  } catch (e) {
    update(() => { if (m.status === 'submitting') m.status = 'pending'; });
    toastError('提交回答失败', e);
    return false;
  }
}
