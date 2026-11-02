import { finishTurtle, submitTurtle, turtleBusy, turtleQuestion, turtleSending } from '../actions/turtle';
import { Btn } from '@/shared/ui/Button';
import { convOfKey } from '@/features/teams/runtime/team';
import { update, useStore } from '@/state/store';

/** 当前问题常驻输入框上方；历史问答仍保留在真实会话中。 */
export function TurtleCard({ ckey }: { ckey: string }) {
  const s = useStore();
  const session = s.turtles[ckey];
  if (!session?.active) return null;
  const busy = turtleBusy(ckey);
  const c = ckey === 'home' ? undefined : convOfKey(ckey);
  const loading = !!c && !c.loaded;
  const { question, failed } = turtleQuestion(ckey);
  const ready = session.started && !!question && !busy && !loading && !session.error;
  const editOther = (other: string) => update(() => { session.other = other; });
  return <section className="turtle-card" aria-label="海龟汤提问卡" aria-busy={busy}>
    <header className="turtle-card__header"><strong>海龟汤提问卡</strong><Btn label="结束提问" disabled={turtleSending(ckey)} variant="ghost" size="sm" onClick={() => void finishTurtle(ckey)} /></header>
    {!session.started && !busy ? <>
      <p className="turtle-card__question">让 AI 来问，你只需要回答。</p>
      <p className="turtle-card__hint">在下方写一个想法或主题，也可以直接开始，让 AI 帮你梳理。</p>
      <Btn label="开始提问" variant="primary" onClick={() => void submitTurtle(ckey)} disabled={loading} />
    </> : <>
      <p className="turtle-card__question" aria-live="polite">{loading ? '正在恢复问答记录…' : busy ? 'AI 正在准备下一问…' : question || '这一轮还没有可回答的问题。'}{(loading || busy) && <span className="turtle-card__dots" aria-hidden="true"><i /><i /><i /></span>}</p>
      {(loading || busy) && <div className="turtle-card__bar" aria-hidden="true" />}
      <div className="turtle-card__answers">
        <Btn label="对" ic="check" variant="ghost" disabled={!ready} onClick={() => void submitTurtle(ckey, '对')} />
        <Btn label="不对" ic="close" variant="ghost" disabled={!ready} onClick={() => void submitTurtle(ckey, '不对')} />
        <Btn label="其他" ic="edit" variant="ghost" disabled={!ready} onClick={() => update(() => { session.showOther = !session.showOther; })} />
      </div>
      {session.showOther && <div className="turtle-card__other">
        <textarea autoFocus aria-label="其他回答" placeholder="不确定、部分正确，或者补充你的想法…" value={session.other} disabled={busy} onChange={e => editOther(e.target.value)} />
        <Btn label="发送回答" variant="primary" disabled={!ready || !session.other.trim()} onClick={() => void submitTurtle(ckey, session.other)} />
      </div>}
    </>}
    {session.error && <p role="alert" className="turtle-card__error">{session.error}</p>}
    {session.started && !busy && !loading && (failed || !question || session.error) && <Btn label="重试这一轮" size="sm" onClick={() => void submitTurtle(ckey)} />}
  </section>;
}
