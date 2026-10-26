import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { closeSide } from '../actions/commands';
import { attachFiles } from '../actions/attachments';
import { toast, toastError } from '@/shared/overlays/controller';
import { IconBtn } from '@/shared/ui/Button';
import { Typing } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { minimizeSideChat, sideChatMarkdown } from '../runtime/sideChat';
import { conv } from '@/state/selectors';
import { useStore } from '@/state/store';
import { cx } from '@/shared/lib/util';
import { useStickBottom } from './Chat';
import { Composer } from './Composer';
import { MessageList } from './MessageList';

/* ===== 侧边聊天：浮动小窗 =====
 * 拖标题栏移动；四条边、四个角都能拉；「−」缩小成右下角的小球（小球也能拖，点一下展开）；「×」关掉并删除。
 * 拖着窗口放到主任务的输入框上：把侧边聊天整理成 .md 附到主任务，主任务就知道刚才聊了什么。
 * 位置和大小只记在本机（localStorage），读不到就用默认值。 */

type Rect = { x: number; y: number; w: number; h: number };
type Dot = { x: number; y: number };
const RECT_KEY = 'lom.side-chat.rect', BALL_KEY = 'lom.side-chat.ball';
const MIN_W = 300, MIN_H = 320, BALL = 52;

const load = <T,>(key: string): T | null => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 隐私模式：只在这次打开里有效 */ } };

/** 把窗口限制在屏幕里 */
function fit(r: Rect): Rect {
  const W = window.innerWidth, H = window.innerHeight;
  const w = Math.min(Math.max(r.w, MIN_W), W - 16), h = Math.min(Math.max(r.h, MIN_H), H - 16);
  return { w, h, x: Math.min(Math.max(r.x, 8), W - w - 8), y: Math.min(Math.max(r.y, 8), H - h - 8) };
}
const defaultRect = (): Rect => fit({ w: 400, h: Math.min(620, window.innerHeight - 96), x: window.innerWidth - 416, y: 64 });
const fitBall = (d: Dot): Dot => ({ x: Math.min(Math.max(d.x, 8), window.innerWidth - BALL - 8), y: Math.min(Math.max(d.y, 8), window.innerHeight - BALL - 8) });
const defaultBall = (): Dot => fitBall({ x: window.innerWidth - BALL - 24, y: window.innerHeight - BALL - 96 });

/** 指针下面是不是主任务的输入框（不算侧边聊天自己的） */
function mainComposerAt(x: number, y: number, parent: string): HTMLElement | null {
  const els = document.elementsFromPoint(x, y);
  const box = els.map(e => e.closest<HTMLElement>('.composer')).find(e => e && !e.closest('.side-chat'));
  return box && box.querySelector(`[data-composer="conv:${parent}"]`) ? box : null;
}

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

/** 每次打开都重新挂载窗口：位置和大小按打开那一刻的窗口尺寸算（App 启动时窗口可能还很小） */
export function SideChat() {
  const sc = useStore().sideChat;
  return sc ? <SideWindow key={sc.conv || sc.parent} /> : null;
}

function SideWindow() {
  const s = useStore();
  const stick = useStickBottom<HTMLDivElement>();
  const [rect, setRect] = useState<Rect>(() => fit(load<Rect>(RECT_KEY) || defaultRect()));
  const [ball, setBall] = useState<Dot>(() => fitBall(load<Dot>(BALL_KEY) || defaultBall()));
  const [dropTarget, setDropTarget] = useState(false);
  const hoverBox = useRef<HTMLElement | null>(null);
  const markBox = (box: HTMLElement | null) => {
    if (hoverBox.current === box) return;
    hoverBox.current?.classList.remove('is-drop-target');
    box?.classList.add('is-drop-target');
    hoverBox.current = box;
  };
  const drag = useRef<null | { kind: 'move' | 'ball' | typeof EDGES[number]; sx: number; sy: number; start: Rect; ball: Dot; moved: boolean }>(null);
  const sc = s.sideChat;
  useEffect(() => { const onResize = () => { setRect(r => fit(r)); setBall(b => fitBall(b)); }; window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize); }, []);
  if (!sc) return null;
  const parent = conv(sc.parent), c = sc.conv ? conv(sc.conv) : undefined;

  const begin = (kind: NonNullable<typeof drag.current>['kind']) => (e: RPointerEvent) => {
    if (e.button !== 0) return;
    if (kind === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    // 指针已经抬起时浏览器会拒绝捕获；不捕获也能拖，只是指针移出窗口时会停下
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch (err) { console.warn('side_chat.capture_failed', err); }
    drag.current = { kind, sx: e.clientX, sy: e.clientY, start: rect, ball, moved: false };
  };
  const onMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.kind === 'ball') { setBall(fitBall({ x: d.ball.x + dx, y: d.ball.y + dy })); return; }
    if (d.kind === 'move') {
      setRect({ ...d.start, x: d.start.x + dx, y: d.start.y + dy });
      const box = c?.messages.length ? mainComposerAt(e.clientX, e.clientY, sc.parent) : null;
      markBox(box);
      setDropTarget(!!box);
      return;
    }
    let { x, y, w, h } = d.start;
    if (d.kind.includes('e')) w = d.start.w + dx;
    if (d.kind.includes('s')) h = d.start.h + dy;
    if (d.kind.includes('w')) { w = d.start.w - dx; x = d.start.x + dx; if (w < MIN_W) { x -= MIN_W - w; w = MIN_W; } }
    if (d.kind.includes('n')) { h = d.start.h - dy; y = d.start.y + dy; if (h < MIN_H) { y -= MIN_H - h; h = MIN_H; } }
    setRect(fit({ x, y, w, h }));
  };
  const end = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'ball') {
      if (!d.moved) minimizeSideChat(false); else save(BALL_KEY, fitBall({ x: d.ball.x + e.clientX - d.sx, y: d.ball.y + e.clientY - d.sy }));
      return;
    }
    setDropTarget(false);
    markBox(null);
    if (d.kind === 'move' && d.moved && mainComposerAt(e.clientX, e.clientY, sc.parent)) {
      setRect(d.start); // 附上之后窗口回到原位
      attachToMain();
      return;
    }
    setRect(r => { const f = fit(r); save(RECT_KEY, f); return f; });
  };
  const attachToMain = () => {
    const md = sideChatMarkdown();
    if (!md) { toast('侧边聊天里还没有内容', 'info'); return; }
    const file = new File([md.text], md.name, { type: 'text/markdown' });
    void attachFiles(`conv:${sc.parent}`, [file]).then(() => toast('已把侧边聊天附到主任务的输入框，发送后主任务就能读到', 'paperclip'), e => toastError('附加失败', e));
  };

  if (sc.minimized) {
    return (
      <button type="button" className="side-ball" style={{ left: ball.x, top: ball.y }} aria-label="展开侧边聊天" title="侧边聊天（点一下展开，按住可以拖动）"
        onPointerDown={begin('ball')} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}
        onClick={e => { if (e.detail === 0) minimizeSideChat(false); /* 键盘回车 / 空格 */ }}>
        <span aria-hidden="true">−</span>
        {c && s.running[c.id] && <span className="side-ball__dot" />}
      </button>
    );
  }
  return (
    <aside className={cx('side-chat', dropTarget && 'is-dropping')} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} aria-label="侧边聊天"
      onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
      <header className="side-chat__head" onPointerDown={begin('move')} title="按住拖动；拖到主任务的输入框上，可以把这段聊天附过去">
        <div className="grow" style={{ minWidth: 0 }}><b>侧边聊天</b><div className="muted side-chat__sub">在「{parent?.title || '任务'}」旁边临时问，不写进这个任务</div></div>
        <IconBtn ic="paperclip" label="附到主任务（也可以把窗口拖到主任务的输入框上）" onClick={attachToMain} size="sm" />
        <IconBtn ic="minus" label="缩小" onClick={() => minimizeSideChat(true)} size="sm" />
        <IconBtn ic="close" label="关闭并删除这段侧边聊天" onClick={closeSide} size="sm" />
      </header>
      {dropTarget && <div className="side-chat__drop"><Icon name="paperclip" />松开：把这段聊天作为 .md 附到主任务</div>}
      <div className="side-chat__scroll" ref={stick.ref} onScroll={stick.onScroll}>
        {sc.error ? <div className="msg__sys">开不了侧边聊天：{sc.error}</div>
          : !c ? <div className="msg__sys"><Typing />正在准备…</div>
          : c.messages.length ? <MessageList msgs={c.messages} ctxId={c.id} />
          : <div className="muted side-chat__empty">问点什么都行，比如「刚才那一步为什么失败？」「这个方案还有别的做法吗？」。它看得到主任务最近的对话。</div>}
        {c && s.running[c.id] && <div className="msg__sys"><Typing />正在回答…</div>}
      </div>
      {c && <div className="side-chat__foot"><Composer ckey={`conv:${c.id}`} compact toolbar={false} note={false} placeholder="在这里临时问一句…" /></div>}
      {EDGES.map(k => <span key={k} className={`side-chat__edge side-chat__edge--${k}`} onPointerDown={begin(k)} aria-hidden="true" />)}
    </aside>
  );
}
