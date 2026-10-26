import { Icon } from '@/shared/ui/Icon';
import { cx } from '@/shared/lib/util';

/** 圆形头像保持静止，仅外圈旋转。菜单、分类和会话共用。 */
export function HistoryIcon({ src, name, lom, running = false }: { src?: string; name: string; lom?: boolean; running?: boolean }) {
  return (
    <span className={cx('history-icon', running && 'is-running')} role={running ? 'status' : undefined} aria-label={running ? `${name} 正在运行` : undefined}>
      {src ? <img className={cx('history-icon__image', lom && 'history-icon__image--lom')} src={src} alt="" /> : <Icon name="cube" />}
      {running && <span className="history-icon__ring" aria-hidden="true" />}
    </span>
  );
}
