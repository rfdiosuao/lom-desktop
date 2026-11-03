import { expect, it, vi } from 'vitest';
import { S } from '@/state/store';
const m = vi.hoisted(() => ({ invoke: vi.fn(), release: undefined as undefined | (() => void), handlers: [] as string[] }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async (name: string) => {
  m.handlers.push(name);
  if (m.handlers.length === 1) await new Promise<void>(resolve => { m.release = resolve; });
  return () => {};
} }));
vi.mock('@/core/platform', () => ({ inShell: () => true }));
vi.mock('@/features/chat/runtime/tasks', () => ({ sendFromChannel: vi.fn() }));
vi.mock('./feishuCard', () => ({ streamReply: vi.fn() }));
vi.mock('./session', () => ({ ensureConversation: vi.fn() }));
import { startFeishuRelay } from './feishuRelay';
it('FEISHU-HEALTH-01 bootstrap installs all event handlers before launching any native listener', async () => {
 localStorage.clear();
 S.cloud = 'signed-in'; S.account = { id:'boot', name:'', email:'' };
 localStorage.setItem('lom.personal.v1:boot', JSON.stringify({items:[{id:'a',name:'A',directory:'/a',workspace:'/a'}]}));
 m.invoke.mockImplementation(async cmd => cmd === 'feishu_status' ? {configured:true,connected:true,app_id:'bot_a',generation:1,listener_running:true} : cmd === 'feishu_listen_start' ? 1 : {});
 startFeishuRelay();
 await new Promise(resolve => setTimeout(resolve, 0));
 expect(m.invoke).not.toHaveBeenCalled();
 m.release!();
 await vi.waitFor(() => expect(m.invoke).toHaveBeenCalledWith('feishu_listen_start', {account:'boot',assistantId:'a'}));
 expect(m.handlers).toEqual(['feishu-connect','feishu-message','feishu-approval','feishu-listen-ended']);
});
