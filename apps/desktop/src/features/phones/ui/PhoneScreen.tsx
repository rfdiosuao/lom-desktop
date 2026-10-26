import { t } from '@/shared/i18n/index';
import { useEffect, useState } from 'react';
import { capturePhone, saveScreen, screenError } from '../runtime/phoneScreen';
import type { ScreenFrame } from '@/core/remoteWire';
import { Btn, Dropdown } from '@/shared/ui/Button';
import { Toggle, Spinner } from '@/shared/ui/Controls';
import { Empty } from '@/shared/ui/Layout';
import { useStore, update } from '@/state/store';
import { toast, toastError } from '@/shared/overlays/controller';
import { superviseNow } from '@/features/chat/actions/composer';

/** One request at a time; late replies cannot leak a previous device's screen. */
export function PhoneScreen({ device, full = false }: { device: string; full?: boolean }) {
  const s = useStore();
  const [frame, setFrame] = useState<ScreenFrame>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const online = s.agents[device]?.status !== 'offline';
  const account = s.account?.id;
  const covered = !full && (s.layout.rightCollapsed || s.modals.some(m => m.id === 'full'));
  const signedIn = s.cloud === 'signed-in';
  useEffect(() => {
    let failures = 0;
    let active = true, timer: ReturnType<typeof setTimeout>;
    setFrame(undefined); setError('');
    if (!s.live || !online || !signedIn || covered) return;
    async function refresh() {
      if (!active) return;
      if (document.hidden) { timer = setTimeout(refresh, 1500); return; }
      try {
        const next = await capturePhone(device, s.quality);
        if (active) { failures = 0; setFrame(next); setError(''); }
      } catch (e) {
        if (active) {
          setFrame(undefined); setError(screenError(e));
          if (s.prefs.reconnect && !/permission_required|method_unknown|unsupported/.test(String(e))) timer = setTimeout(refresh, Math.min(30000, 2000 * 2 ** Math.min(failures++, 4)));
        }
        return;
      }
      if (active) timer = setTimeout(refresh, 1000);
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [device, account, signedIn, online, s.live, s.quality, retry, covered, s.prefs.reconnect, s.prefs.cellularCap]);
  return <div className={`phone-screen ${full ? 'phone-screen--full' : ''}`}>
    <div className="screen-bar"><span className="screen-bar__title">{t('手机实时画面')}</span>
      <Dropdown label={`画质 · ${s.quality}`} menu="quality" size="sm" variant="secondary" />
      <Toggle on={s.live} onChange={() => update(x => { x.live = !x.live; })} label="刷新手机画面" size="sm" />
    </div>
    {frame && s.live && online && signedIn ? <img className="phone-screen__image" src={`data:${frame.mime};base64,${frame.image}`} alt="当前手机屏幕" />
      : <Empty ic="phone" title={!s.live ? '画面已暂停' : !online ? '手机离线' : !signedIn ? '请先登录' : error ? '画面未连接' : '正在获取手机画面'}
        desc={error || '通过加密通道读取真实屏幕。'} actions={error ? <Btn label="重试连接" onClick={() => setRetry(v => v + 1)} /> : s.live && online && signedIn ? <Spinner /> : undefined} />}
    {frame && <p className="muted">截图刷新 · {new Date(Number(frame.captured_at)).toLocaleTimeString()} · 非视频流</p>}
    <div className="row">
      <Btn label="保存截图" ic="camera" size="sm" disabled={!frame || !s.live} onClick={() => { if (frame) void saveScreen(frame).then(saved => { if (saved) toast('截图已保存', 'check'); }).catch(e => toastError('保存失败', e)); }} />
      <Btn label="让总指挥检查" ic="eye" size="sm" onClick={() => superviseNow(device)} />
    </div>
  </div>;
}
