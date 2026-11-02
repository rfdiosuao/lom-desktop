import { S, update } from '@/state/store';

const sends = new Map<string, symbol>();

/** A failed send may restore only the slots it cleared, never a newer draft. */
export function takeDraft(key: string) {
  const text = S.drafts[key] || '';
  const attachments = [...(S.attachments[key] || [])];
  const empty: typeof attachments = [];
  const token = Symbol();
  sends.set(key, token);
  update(s => { delete s.turtles[key]; s.drafts[key] = ''; s.attachments[key] = empty; });
  return (target = key) => update(s => {
    const current = s.attachments[target];
    if (target === key ? sends.get(key) !== token : sends.has(target)) return;
    if (s.drafts[target] || current?.length || (target === key && current !== empty)) return;
    s.drafts[target] = text;
    s.attachments[target] = attachments;
  });
}
