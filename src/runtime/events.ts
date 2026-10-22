import { wsUrl, onEndpointChange } from './client';
import type { CoreEvent } from './types';

/* ===== lom-core 实时事件（WebSocket）：断线后指数退避重连 ===== */

export interface EventsHandle { close: () => void; }

export function connectEvents(opts: {
  onEvent: (e: CoreEvent) => void;
  onOpen: (reconnected: boolean) => void;
  onDown: (reason: string) => void;
}): EventsHandle {
  if (!wsUrl()) throw new Error('本机运行时尚未连接');
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let everOpened = false;
  let timer = 0;
  let unsubscribe = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    window.clearTimeout(timer);
    unsubscribe();
    ws?.close();
  };
  const open = () => {
    if (closed) return;
    const socket = new WebSocket(wsUrl());
    ws = socket;
    socket.onopen = () => {
      if (closed || ws !== socket) return;
      opts.onOpen(everOpened);
      everOpened = true;
      attempt = 0;
    };
    socket.onmessage = ev => {
      if (closed || ws !== socket) return;
      let msg: CoreEvent;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        console.warn('runtime.invalid_event');
        return;
      }
      if (msg && typeof msg.name === 'string') opts.onEvent(msg);
    };
    socket.onclose = ev => {
      if (closed || ws !== socket) return;
      opts.onDown(ev.reason || `连接已断开（${ev.code}）`);
      const delay = Math.min(10000, 500 * 2 ** attempt++);
      timer = window.setTimeout(open, delay);
    };
  };

  unsubscribe = onEndpointChange(() => {
    if (!wsUrl()) { close(); return; }
    window.clearTimeout(timer);
    const previous = ws;
    ws = null;
    previous?.close();
    attempt = 0;
    open();
  });

  open();
  return { close };
}
