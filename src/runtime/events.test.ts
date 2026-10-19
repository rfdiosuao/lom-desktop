import { afterEach, expect, it, vi } from 'vitest';
import { setEndpoint } from './client';
import { connectEvents } from './events';
class Socket {
  static all: Socket[] = [];
  onopen?: () => void; onclose?: (e: { code: number; reason: string }) => void; onmessage?: (e: { data: string }) => void;
  close = vi.fn();
  constructor(public url: string) { Socket.all.push(this); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); setEndpoint(null); Socket.all = []; });
it('streams real parsed events, reconnects with backoff, and cleans up on close', async () => {
  vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket);
  setEndpoint({ url: 'http://127.0.0.1:31415', token: 'launch-token', defaultFolder: '', homeDir: '' });
  const opts = { onEvent: vi.fn(), onOpen: vi.fn(), onDown: vi.fn() };
  const connection = connectEvents(opts); Socket.all[0].onopen?.();
  Socket.all[0].onmessage?.({ data: JSON.stringify({ name: 'message.stream', data: { type: 'content', text: 'hello' } }) });
  expect(opts.onEvent).toHaveBeenCalledWith(expect.objectContaining({ name: 'message.stream' }));
  Socket.all[0].onclose?.({ code: 1006, reason: '' });
  await vi.advanceTimersByTimeAsync(499); expect(Socket.all).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1); expect(Socket.all).toHaveLength(2); Socket.all[1].onopen?.();
  expect(opts.onOpen.mock.calls).toEqual([[false], [true]]);
  connection.close(); expect(Socket.all[1].close).toHaveBeenCalledOnce();
  Socket.all[1].onmessage?.({ data: '{"name":"late","data":{}}' }); expect(opts.onEvent).toHaveBeenCalledTimes(1);
});
it('does not print malformed event content or tokens', () => {
  vi.stubGlobal('WebSocket', Socket); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  setEndpoint({ url: 'http://127.0.0.1:31415', token: 'launch-token', defaultFolder: '', homeDir: '' });
  const connection = connectEvents({ onEvent: vi.fn(), onOpen: vi.fn(), onDown: vi.fn() });
  Socket.all[0].onmessage?.({ data: 'private-payload-not-json' });
  expect(warn).toHaveBeenCalledWith('runtime.invalid_event'); connection.close();
});
