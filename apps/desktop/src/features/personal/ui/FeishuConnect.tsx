import { useEffect, useRef, useState, type ReactNode } from 'react';
import { authAccount } from '@/features/account/runtime/authScope';
import { inShell } from '@/core/platform';
import { openExternalUrl } from '@/core/links';
import { confirm, toastError } from '@/shared/overlays/controller';
import { Btn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Spinner } from '@/shared/ui/Controls';
import { useStore } from '@/state/store';
import { beginFeishuApp, beginFeishuAuth, cancelFeishu, disconnectFeishu, feishuError, onFeishuStep, revokeFeishuAuth, type FeishuPrompt, type FeishuStatus } from '../runtime/feishu';
import type { PersonalAssistant } from '../runtime/catalog';
import { bindFeishuAssistant, scopedFeishuStatus, claimLegacyFeishu } from '../runtime/feishuBinding';
import { restartFeishuRelay } from '../runtime/feishuRelay';

/* ===== FEISHU-01：通道连接里的飞书一栏 =====
 * 未连接 → 扫一次码（建机器人并记下主人）→ 已连接（FEISHU-06）。
 * 以你的身份用文档、日历等是可选的再授权；早期只建了机器人、没记下主人的，走一次授权补上。 */

type View =
  | { kind: 'loading' }
  | { kind: 'off'; status?: FeishuStatus }
  | { kind: 'qr'; stage: 'app' | 'auth'; prompt: FeishuPrompt; warning?: string | null }
  | { kind: 'busy'; text: string }
  | { kind: 'on'; status: FeishuStatus }
  | { kind: 'error'; text: string; stage?: 'app' | 'auth' };

const qrSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function FeishuConnect({ assistant }: { assistant?: PersonalAssistant }) {
  const s = useStore();
  const account = s.account?.id || '';
  const generation = useRef(0);
  const appId = useRef<string | undefined>(undefined);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const auth = authAccount();
  const scope = `${account}:${assistant?.id ?? ''}`;
  const live = useRef(scope);
  live.current = scope;

  const relay = () => restartFeishuRelay(account, assistant?.id).catch(e => console.warn('feishu.relay_restart_failed', e));

  const refresh = async () => {
    const owner = account;
    try {
      const status = await scopedFeishuStatus(owner, assistant!.id);
      if (!auth() || live.current !== scope) return;
      generation.current = Math.max(generation.current, status.generation || 0);
      appId.current = status.app_id || undefined;
      if (status.app_id) bindFeishuAssistant(owner, status.app_id, assistant!.id);
      if (status.auth?.pending) {
        setView(status.auth.prompt ? { kind: 'qr', stage: 'auth', prompt: status.auth.prompt, warning: status.auth.warning } : { kind: 'busy', text: '正在准备授权…' });
        return;
      }
      if (status.auth?.error) { setView({ kind: 'error', stage: 'auth', text: feishuError(status.auth.error) }); return; }
      setView(status.configured && (status.connected ?? status.authorized) ? { kind: 'on', status } : { kind: 'off', status });
    } catch (e) { if (auth() && live.current === scope) setView({ kind: 'error', text: feishuError(e) }); }
  };

  const authorize = async () => {
    const owner = account;
    setView({ kind: 'busy', text: '正在准备授权…' });
    try {
      const prompt = await beginFeishuAuth(owner, assistant!.id);
      if (!auth() || live.current !== scope) return;
      generation.current = Math.max(generation.current, prompt.generation || 0);
      if (auth() && live.current === scope) setView({ kind: 'qr', stage: 'auth', prompt });
    } catch (e) { if (auth() && live.current === scope) setView({ kind: 'error', stage: 'auth', text: feishuError(e) }); }
  };

  useEffect(() => {
    if (!account || !assistant || !inShell()) return;
    live.current = scope;
    generation.current = 0;
    appId.current = undefined;
    setView({kind: 'loading'});
    void refresh();
    let stop: (() => void) | undefined, gone = false;
    void onFeishuStep(step => {
      if (gone || !auth() || live.current !== scope || (step.account !== account || step.assistant_id !== assistant.id) || step.generation < generation.current || (appId.current && step.app_id !== appId.current)) return;
      generation.current = step.generation;
      if (!step.ok) { setView({ kind: 'error', stage: step.stage, text: feishuError(step.error) }); return; }
      void refresh().then(relay);
    }).then(fn => { if (gone) fn(); else stop = fn; }).catch(e => setView({ kind: 'error', text: feishuError(e) }));
    // Native owns pending authorization; closing or minimizing this panel only removes its listener.
    return () => { gone = true; live.current = ''; stop?.(); };
  }, [scope]);

  const start = async () => {
    const owner = account;

    appId.current = undefined;
    setView({ kind: 'busy', text: '正在向飞书申请二维码…' });
    try {
      const prompt = await beginFeishuApp(owner, assistant!.id);
      if (!auth() || live.current !== scope) return;
      generation.current = Math.max(generation.current, prompt.generation || 0);
      if (auth() && live.current === scope) setView({ kind: 'qr', stage: 'app', prompt });
    } catch (e) { if (auth() && live.current === scope) setView({ kind: 'error', stage: 'app', text: feishuError(e) }); }
  };

  const cancel = async () => {

    try { await cancelFeishu(account, assistant!.id); } catch (e) { toastError('取消失败', e); }
    void refresh();
  };

  const disconnect = () => confirm({
    title: '断开飞书？', desc: '会清除这台电脑上的飞书机器人凭据和授权。飞书里已创建的应用不会被删除，之后可以重新扫码连接。', okText: '断开', danger: true,
    onOk: () => { if (!auth() || live.current !== scope) { toastError('断开飞书失败', new Error('助理或账号已切换，请重新确认')); return; } void disconnectFeishu(account, assistant!.id).then(() => { void relay(); return refresh(); }, e => toastError('断开飞书失败', new Error(feishuError(e)))); },
  });

  const head = (right: ReactNode) => (
    <div className="pa-channel pa-channel--live"><span className="pa-channel__icon pa-channel__icon--feishu" aria-hidden="true" /><strong>飞书</strong>{right}</div>
  );

  if (!inShell()) return head(<span>请在桌面应用里连接</span>);
  if (!account) return head(<span>登录后可连接</span>);
  if (!assistant) return head(<span>创建助理后可连接</span>);
  switch (view.kind) {
    case 'loading': return head(<span><Spinner size={12} /></span>);
    case 'busy': return <>{head(<span><Spinner size={12} /></span>)}<p className="pa-muted">{view.text}</p></>;
    case 'on': return <>{head(<span className="pa-channel__ok"><Icon name="check" />已连接</span>)}
      <p className="pa-muted">机器人 {view.status.app_id} 已连接。在飞书里私聊它，{assistant.name}会处理消息并把回复发回飞书，切换助理不会改变绑定。</p>
      {view.status.authorized && <p className="pa-muted">已授权访问你的飞书。{view.status.auth?.warning && `以下权限被管理员限制：${view.status.auth.warning}`}</p>}
      {!view.status.authorized && <p className="pa-muted">想让助理以你的身份查看文档、日历、任务？可以再授权一次（可选）。</p>}
      <div className="row">
        {!view.status.authorized && <Btn label="授权访问我的飞书（可选）" variant="ghost" size="sm" onClick={() => void authorize()} />}
        {view.status.authorized && <Btn label="撤销授权" variant="ghost" size="sm" onClick={() => void revokeFeishuAuth(account, assistant!.id).then(refresh, e => toastError('撤销授权失败', new Error(feishuError(e))))} />}
        <Btn label="断开" variant="ghost" size="sm" onClick={disconnect} />
      </div></>;
    case 'error': return <>{head(<span>{view.stage === 'auth' ? '授权失败' : '未连接'}</span>)}<p className="pa-error" role="alert">{view.text}</p><Btn label={view.stage === 'auth' ? '重试授权' : '重新扫码连接'} size="sm" onClick={() => void (view.stage === 'auth' ? authorize() : start())} /></>;
    case 'qr': return <>{head(<span>{view.stage === 'app' ? '扫码连接' : '扫码授权'}</span>)}
      <div className="pa-feishu-qr">
        <img src={qrSrc(view.prompt.qr)} alt={view.stage === 'app' ? '扫码创建飞书机器人' : '扫码授权飞书权限'} />
        <p>{view.stage === 'app'
          ? '用飞书 App 扫一扫并确认：自动创建你的专属机器人，扫完就连上。'
          : '在手机飞书私聊里点“去授权”，或扫码同意授权。关闭面板后仍会等待。'}</p>
        {view.warning && <p className="pa-error" role="alert">{feishuError(view.warning)}</p>}
        <div className="row">
          <Btn label="在浏览器打开" variant="ghost" size="sm" onClick={() => void openExternalUrl(view.prompt.url).catch(e => toastError('打开链接失败', e))} />
          <Btn label="取消" variant="ghost" size="sm" onClick={() => void cancel()} />
        </div>
      </div></>;
    case 'off': return <>{view.status?.legacy_app_id && <><p className="pa-muted">旧飞书机器人的归属尚未确认，请选择接收消息的助理。</p><Btn label="绑定旧机器人到此助理" size="sm" onClick={() => void claimLegacyFeishu(account, assistant.id, view.status!.legacy_app_id!).then(() => refresh().then(relay), e => toastError('绑定失败', e))} /></>}{head(<span>{view.status?.configured ? '还差授权' : '未连接'}</span>)}
      {view.status?.configured
        ? <Btn label="扫码授权" variant="primary" size="sm" onClick={() => void authorize()} />
        : <Btn label="扫码连接飞书" variant="primary" size="sm" onClick={() => void start()} />}</>;
  }
}
