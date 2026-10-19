import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, CoreError, getEndpoint, setEndpoint, wsUrl } from './client';
import { createConversation, listAgents, sendMessage } from './cli';
const endpoint = { url: 'http://127.0.0.1:31415', token: 'test-launch-token', defaultFolder: '/workspace', homeDir: '/workspace' };
const agent = { id: 'codex', name: 'Codex', installed: true, enabled: true, status: 'online' as const, agent_type: 'acp', agent_source: 'external', backend: 'codex' };
afterEach(() => { setEndpoint(null); vi.unstubAllGlobals(); vi.useRealTimers(); });
const response = (data: unknown) => new Response(JSON.stringify({ success: true, data }));

describe('desktop-local runtime boundary', () => {
  it.each(['https://example.invalid:31415', 'http://127.0.0.1.evil.invalid:31415', 'http://user:pass@127.0.0.1:31415', 'http://127.0.0.1:31415?token=x', 'http://localhost:31415'])('refuses remote or ambiguous endpoint %s', url => {
    expect(() => setEndpoint({ ...endpoint, url })).toThrow();
    expect(getEndpoint()).toBeNull();
  });
  it('fails clearly without a runtime; private routes never make a request', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(listAgents()).rejects.toMatchObject({ code: 'LOM_CORE_NOT_READY' });
    setEndpoint(endpoint);
    for (const path of ['/api/account', '/api/phones', '/api/conversations/../account', '//example.invalid', '/api/conversations/a%2fb/messages'])
      await expect(api('GET', path)).rejects.toMatchObject({ code: 'DESKTOP_ROUTE_ONLY' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('captures endpoint/auth and unwraps the response, retaining no credentials on disk', async () => {
    const fetcher = vi.fn().mockResolvedValue(response([agent])); vi.stubGlobal('fetch', fetcher);
    setEndpoint(endpoint);
    expect(await listAgents()).toEqual([agent]);
    expect(fetcher).toHaveBeenCalledWith(endpoint.url + '/api/agents/management', expect.objectContaining({ headers: { 'x-lom-token': endpoint.token } }));
    expect(wsUrl()).toBe('ws://127.0.0.1:31415/ws?token=test-launch-token');
  });
  it('deduplicates external agents and never lists internal commercial models', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{ ...agent, id: 'gateway', agent_type: 'gateway' }, agent, { ...agent, id: 'internal', agent_source: 'internal' }])));
    setEndpoint(endpoint); expect(await listAgents()).toEqual([agent]);
  });
  it('creation is default permission and sends only after explicit sendMessage', async () => {
    const fetcher = vi.fn().mockImplementation(async () => response({ id: 'c1', type: 'acp', name: 'new' })); vi.stubGlobal('fetch', fetcher); setEndpoint(endpoint);
    await createConversation(agent, 'new', '/workspace');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ type: 'acp', extra: { session_mode: 'default', agent_id: 'codex' } });
    await sendMessage('c1', 'hello');
    expect(fetcher.mock.calls[1][0]).toBe(endpoint.url + '/api/conversations/c1/messages');
    expect(() => createConversation({ ...agent, installed: false }, '', '')).toThrow('请选择');
  });
  it('bad JSON and service failure stay errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('broken', { status: 502 })).mockResolvedValueOnce(new Response(JSON.stringify({ success: false, code: 'DENIED', error: 'not allowed' }), { status: 403 }));
    vi.stubGlobal('fetch', fetcher); setEndpoint(endpoint);
    await expect(listAgents()).rejects.toMatchObject({ code: 'LOM_CORE_BAD_RESPONSE', status: 502 });
    await expect(listAgents()).rejects.toMatchObject({ code: 'DENIED', status: 403 });
  });
  it('times out even if a transport ignores AbortSignal; status remains unknown', async () => {
    vi.useFakeTimers(); setEndpoint(endpoint); vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const result = api('POST', '/api/conversations/c1/messages', {}, { timeoutMs: 10 });
    const assertion = expect(result).rejects.toMatchObject({ code: 'LOM_CORE_CANCELLED' });
    await vi.advanceTimersByTimeAsync(11); await assertion;
    expect(CoreError.prototype).toBeInstanceOf(Error);
  });
  it('an already-aborted call does not send', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); setEndpoint(endpoint);
    const controller = new AbortController(); controller.abort();
    await expect(api('POST', '/api/conversations/c1/messages', {}, { signal: controller.signal })).rejects.toMatchObject({ code: 'LOM_CORE_CANCELLED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
