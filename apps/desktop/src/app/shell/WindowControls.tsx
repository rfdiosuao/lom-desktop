import { useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { toastError } from '@/shared/overlays/controller';
import { Icon } from '@/shared/ui/Icon';

/* ===== Windows 自绘窗口按钮：原生标题栏在 shell 启动时隐藏（见 src-tauri/src/lib.rs）=====
   关闭走外壳的 `close_main_window` command，渲染进程没有 `core:window:allow-close` 权限。 */

const RESIZE_DIRECTIONS = ['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const;

function fail(action: string) {
  return (error: unknown) => toastError(action, error);
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void win.isMaximized().then(value => { if (!disposed) setMaximized(value); }).catch(fail('读取窗口状态失败'));
    void win.onResized(() => {
      void win.isMaximized().then(value => { if (!disposed) setMaximized(value); }).catch(fail('读取窗口状态失败'));
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(fail('监听窗口状态失败'));

    return () => { disposed = true; unlisten?.(); };
  }, []);

  const win = () => getCurrentWindow();
  const resize = (direction: (typeof RESIZE_DIRECTIONS)[number]) => (e: ReactMouseEvent) => {
    e.preventDefault();
    void win().startResizeDragging(direction).catch(fail('调整窗口大小失败'));
  };

  return (
    <>
      <div className="window-controls" role="group" aria-label="窗口控制">
        <button type="button" aria-label="最小化" onClick={() => void win().minimize().catch(fail('最小化窗口失败'))}>
          <Icon name="minus" />
        </button>
        <button type="button" aria-label={maximized ? '向下还原' : '最大化'} onClick={() => void win().toggleMaximize().catch(fail('切换窗口大小失败'))}>
          <Icon name={maximized ? 'restore' : 'square'} />
        </button>
        <button type="button" className="window-controls__close" aria-label="关闭" onClick={() => void invoke('close_main_window').catch(fail('关闭窗口失败'))}>
          <Icon name="close" />
        </button>
      </div>
      <div className="window-resizers" aria-hidden="true">
        {!maximized && RESIZE_DIRECTIONS.map(direction => (
          <span key={direction} className={`window-resizers__edge window-resizers__edge--${direction.toLowerCase()}`} onMouseDown={resize(direction)} />
        ))}
      </div>
    </>
  );
}
