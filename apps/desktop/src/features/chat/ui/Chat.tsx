import { t } from '@/shared/i18n/index';
import { useLayoutEffect, useRef } from 'react';
import { enterPhone, newTask, pickPhone } from '@/app/navigation';
import { pair } from '@/features/phones/actions/phone';
import { applySuggestion, toggleAttachPhone } from '../actions/composer';
import { Chip, ChipAdd, SelLabel } from '@/shared/ui/Agent';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Typing } from '@/shared/ui/Controls';
import { Icon, InfinityLogo } from '@/shared/ui/Icon';
import { Empty } from '@/shared/ui/Layout';
import { agent, attached, conv, personaOf, phone, phones, phoneModelName } from '@/state/selectors';
import { externalAgentName } from '@/features/settings/runtime/agents';
import { useStore } from '@/state/store';
import { Composer } from './Composer';
import { NoticeBar } from '@/features/account/ui/Notices';
import { ReplyPending } from './ReplyPending';
import { MessageList } from './MessageList';

/* ===== 首页与对话页 ===== */

/** 滚动区贴底：用户停在底部时，新内容到来自动滚到底；往上翻看时不打扰 */
export function useStickBottom<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  });
  const onScroll = () => {
    const el = ref.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  return { ref, onScroll };
}

export function Home() {
  const s = useStore();
  const desk = s.mode === 'desktop';
  const ext = externalAgentName('home');
  const suggest = desk ? ['看看手机里的任务做得怎么样', '做一个个人作品集网站', '把选题.md 做成 3 张小红书封面'] : ['回复最新笔记的评论', '写一篇秋冬口红测评草稿', '看看今天的数据'];
  return (
    <div className={`home${s.turtles.home?.active ? ' home--turtle' : ''}`}>
      {desk && <NoticeBar />}
      <div className="hero">
        <InfinityLogo />
        <h1 className="hero__title">{t('今天，想做点什么？')}</h1>
        <p className="hero__sub">{desk ? (s.prefs.lang === 'English' ? `Start with an idea. Build it with ${ext || 'Lom'}.` : `从一个想法开始，和 ${ext || 'Lom'} 一起完成。`) : t('和你的专属 Agent 一起完成。')}</p>
        {desk && ext && <p className="hero__hint"><Icon name="info" />这个任务交给 {ext} 完成，使用它自己的模型和登录；手机工具需要该 Agent 支持 HTTP MCP。</p>}
        <section className="hero__select" aria-label={desk ? '参与本次任务的手机' : '当前对话的 Agent'}>
          <SelLabel {...(desk ? { title: '参与本次任务的手机', kind: 'multi' as const, extra: `已选 ${attached('home').length} 台` } : { title: '当前对话的 Agent', kind: 'single' as const, extra: phoneModelName(phone().model || s.phoneModel) })} />
          <div className="hero__chips" role={desk ? 'group' : 'radiogroup'} aria-label={desk ? '参与本次任务的手机，可多选' : '当前对话的 Agent，单选'}>
            {phones().map(p => desk
              ? (
                <div key={p.id} className="chip-group">
                  <Chip agent={p} sub={personaOf(p)} selected={!!s.lit[p.id]} onClick={() => toggleAttachPhone('home', p.id)} select="multi" label={`${p.name}：${s.lit[p.id] ? '已加入这个任务' : '未加入这个任务'}`} />
                  <IconBtn ic="message" label={`和${p.name}一对一对话`} onClick={() => enterPhone(p.id)} size="sm" className="chip__enter ibtn--round" />
                </div>
              )
              : <Chip key={p.id} agent={p} sub={personaOf(p)} selected={s.phoneId === p.id} onClick={() => pickPhone(p.id)} select="single" label={`当前对话的 Agent：${p.name}`} />)}
            <ChipAdd label="配对新手机" onClick={pair} />
          </div>
          <p className="hero__hint"><Icon name="info" />{desk ? '勾选真实手机后，支持手机工具的 Agent 可发送图片、查看画面和派发任务' : '切换卡片会切换对话对象，左侧栏跟着换成这台手机的会话和设置'}</p>
        </section>
        <div className="hero__suggest">{suggest.map(t => <Btn key={t} label={t} variant="pill" size="sm" onClick={() => applySuggestion(t)} />)}</div>
      </div>
      <Composer ckey="home" />
    </div>
  );
}

export function Chat() {
  const s = useStore();
  const c = conv(s.activeConv);
  const stick = useStickBottom<HTMLDivElement>();
  if (!c) return <Empty ic="message" title="找不到这个任务" desc="它可能已被删除。" actions={<Btn label="新的任务" ic="plus" variant="primary" onClick={newTask} />} />;
  const loading = (c.remote || c.phoneSession) && !c.loaded;
  return (
    <div className="chat">
      <div className="chat__scroll" ref={stick.ref} onScroll={stick.onScroll}>
        <div className="chat__inner">
          {!c.remote && !agent(c.owner)?.real && <div className="msg__sys">示例会话：以下内容不代表真实执行结果。</div>}
          {loading && <div className="msg__sys"><Typing />正在加载任务记录…</div>}
          <MessageList msgs={c.messages} ctxId={c.id} />
          {s.running[c.id] && <ReplyPending c={c} />}
        </div>
      </div>
      <div className="chat__foot"><Composer ckey={`conv:${c.id}`} agentId={c.owner} /></div>
    </div>
  );
}
