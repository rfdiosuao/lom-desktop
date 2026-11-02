import { wsUrl } from './client';
import type { CoreEvent } from './types';

/* ===== lom-core 实时事件（WebSocket）：断线后指数退避重连 ===== */

export interface EventsHandle { close: () => void; }

export function connectEvents(opts: {
  onEvent: (e: CoreEvent) => void;
  onOpen: (reconnected: boolean) => void;
  onDown: (reason: string) => void;
}): EventsHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let everOpened = false;
  let timer = 0;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      opts.onOpen(everOpened);
      everOpened = true;
      attempt = 0;
    };
    ws.onmessage = ev => {
      let msg: CoreEvent;
      try {
        msg = JSON.parse(String(ev.data));
      } catch (e) {
        console.warn('lom-core 推送了无法解析的事件', e);
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
