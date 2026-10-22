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
it.each(['replace', 'clear'])('%s endpoint closes old sockets, cancels reconnects and ignores all late callbacks', async mode => {
  vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket);
  setEndpoint({ url: 'http://127.0.0.1:31415', token: 'old', defaultFolder: '', homeDir: '' });
  const opts = { onEvent: vi.fn(), onOpen: vi.fn(), onDown: vi.fn() };
  const connection = connectEvents(opts); const old = Socket.all[0]; old.onclose?.({ code: 1006, reason: '' });
  opts.onDown.mockClear();
  setEndpoint(mode === 'clear' ? null : { url: 'http://127.0.0.1:31416', token: 'new', defaultFolder: '', homeDir: '' });
  expect(old.close).toHaveBeenCalledOnce();
  old.onopen?.(); old.onmessage?.({ data: '{"name":"stale","data":{}}' }); old.onclose?.({ code: 1006, reason: '' });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(Socket.all).toHaveLength(mode === 'replace' ? 2 : 1); expect(opts.onEvent).not.toHaveBeenCalled(); expect(opts.onOpen).not.toHaveBeenCalled(); expect(opts.onDown).not.toHaveBeenCalled();
  if (mode === 'replace') {
    expect(Socket.all[1].url).toBe('ws://127.0.0.1:31416/ws?token=new');
    Socket.all[1].onmessage?.({ data: '{"name":"new-generation","data":{}}' });
    expect(opts.onEvent).toHaveBeenCalledWith({ name: 'new-generation', data: {} });
  }
  connection.close();
});

it('an identical endpoint report leaves the live socket connected', () => {
  vi.stubGlobal('WebSocket', Socket);
  const endpoint = { url: 'http://127.0.0.1:31415', token: 'same', defaultFolder: '', homeDir: '' };
  setEndpoint(endpoint);
  const connection = connectEvents({ onEvent: vi.fn(), onOpen: vi.fn(), onDown: vi.fn() });
  setEndpoint({ ...endpoint });
  expect(Socket.all).toHaveLength(1); expect(Socket.all[0].close).not.toHaveBeenCalled();
  connection.close();
});
