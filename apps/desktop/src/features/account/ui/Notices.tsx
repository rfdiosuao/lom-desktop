import { useEffect } from 'react';
import { closeModal, openModal } from '@/shared/overlays/controller';
import { feedback } from '@/features/settings/actions/settings';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Section } from '@/shared/ui/Layout';
import { Markdown } from '@/shared/ui/Markdown';
import { Modal } from '@/shared/ui/Overlay';
import { loadFeedback } from '../runtime/feedback';
import { bannerNotice, loadNotices, markNotice, urgentNotice, type Notice } from '../runtime/notices';
import { S, useStore } from '@/state/store';

/* ===== 公告（A04 §2.1）：首页横条、重要公告弹窗、设置里的公告列表；同时负责定时读取反馈回复 ===== */

const REFRESH_MS = 30 * 60 * 1000;

/** 登录后读取一次，之后每 30 分钟一次；有没读过的「重要」公告就弹出来 */
export function useCloudInbox() {
  const s = useStore();
  const signedIn = s.cloud === 'signed-in';
  useEffect(() => {
    if (!signedIn) return;
    const pull = () => { void loadNotices(); void loadFeedback(); };
    pull();
    const t = window.setInterval(pull, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [signedIn]);
  const urgent = signedIn ? urgentNotice() : undefined;
  useEffect(() => {
    if (urgent && !S.modals.some(m => m.id === 'notice')) openModal('notice', { id: urgent.id, dismissible: false });
  }, [urgent?.id]);
}

const date = (s: number) => new Date(s * 1000).toLocaleDateString('zh-CN');

/** 首页顶部横条：一条没关闭过的「通知」级公告 */
export function NoticeBar() {
  useStore();
  const n = bannerNotice();
  if (!n) return null;
  return (
    <div className="notice-bar" role="status">
      <Icon name="bell" />
      <button type="button" className="notice-bar__text" onClick={() => openModal('notice', { id: n.id })}>
        <b>{n.title}</b><span>{n.body.replace(/[#*`>\-]/g, '').split('\n').find(Boolean)}</span>
      </button>
      <IconBtn ic="close" label="关闭这条公告" size="sm" onClick={() => markNotice(n.id)} />
    </div>
  );
}

export function NoticeModal({ p }: { p: Record<string, unknown> }) {
  const n = S.notices.find(x => x.id === p.id);
  const done = () => { if (n) markNotice(n.id); closeModal(); };
  if (!n) return <Modal title="公告" foot={<Btn label="关闭" variant="primary" onClick={closeModal} />}>这条公告已结束。</Modal>;
  return (
    <Modal title={n.title} desc={`${n.level === 'important' ? '重要公告' : '公告'} · ${date(n.starts_at)}`}
      foot={<Btn label="我知道了" variant="primary" onClick={done} />}>
      {/* 公告正文按 Markdown 显示：只生成 React 节点，不渲染其中的 HTML */}
      <div className="notice-body"><Markdown text={n.body} /></div>
    </Modal>
  );
}

function Row({ n }: { n: Notice }) {
  return (
    <button type="button" className="list-row list-row--btn" onClick={() => openModal('notice', { id: n.id })}>
      <div className="list-row__main">
        <div className="list-row__title">{n.title}{n.level === 'important' && <Badge text="重要" tone="warn" />}{n.pinned && <Badge text="置顶" />}</div>
        <div className="list-row__sub">{date(n.starts_at)}{n.ends_at ? ` – ${date(n.ends_at)}` : ''}</div>
      </div>
    </button>
  );
}

/** 设置 → 关于：当前有效的公告和反馈入口 */
export function NoticeSection() {
  const s = useStore();
  return (
    <Section title="公告" extra={<Btn label="意见反馈" ic="message" variant="ghost" size="sm" onClick={feedback} />}>
      <div className="list">{s.notices.length ? s.notices.map(n => <Row key={n.id} n={n} />) : <div className="list-row muted">现在没有公告</div>}</div>
    </Section>
  );
}
