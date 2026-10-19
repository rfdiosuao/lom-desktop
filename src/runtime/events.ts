import { wsUrl } from './client';
import type { CoreEvent } from './types';

/* ===== lom-core 实时事件（WebSocket）：断线后指数退避重连 ===== */

export interface EventsHandle { close: () => void; }

export function connectEvents(opts: {
  onEvent: (e: CoreEvent) => void;
  onOpen: (reconnected: boolean) => void;
  onDown: (reason: string) => void;
}): EventsHandle {
  const url = wsUrl();
  if (!url) throw new Error('本机运行时尚未连接');
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let everOpened = false;
  let timer = 0;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(url);
    ws.onopen = () => {
      opts.onOpen(everOpened);
      everOpened = true;
      attempt = 0;
    };
    ws.onmessage = ev => {
      if (closed) return;
      let msg: CoreEvent;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        console.warn('runtime.invalid_event');
        return;
      }
      if (msg && typeof msg.name === 'string') opts.onEvent(msg);
    };
    ws.onclose = ev => {
      if (closed) return;
      opts.onDown(ev.reason || `连接已断开（${ev.code}）`);
      const delay = Math.min(10000, 500 * 2 ** attempt++);
      timer = window.setTimeout(open, delay);
    };
  };

  open();
  return {
    close: () => {
      closed = true;
      window.clearTimeout(timer);
      ws?.close();
    },
  };
}
