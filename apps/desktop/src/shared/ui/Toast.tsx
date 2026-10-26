import { Icon } from './Icon';
import { useStore } from '@/state/store';

/* 轻提示：底部居中，2.6 秒后自动消失 */
export function Toast() {
  const s = useStore();
  return (
    <div id="toast" role={s.toast?.tone === 'error' ? 'alert' : 'status'} aria-live="polite" className={s.toast ? `is-visible is-${s.toast.tone || 'ok'}` : ''}>
      {s.toast && <><Icon name={s.toast.icon} /><span>{s.toast.text}</span></>}
    </div>
  );
}
