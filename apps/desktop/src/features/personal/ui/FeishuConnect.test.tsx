import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ invoke: vi.fn(), handler: undefined as undefined | ((e: { payload: unknown }) => void), shell: true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: m.invoke, isTauri: () => m.shell }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_name: string, fn: (e: { payload: unknown }) => void) => { m.handler = fn; return () => { m.handler = undefined; }; }) }));
vi.mock('@/core/platform', () => ({ inShell: () => m.shell }));
import { FeishuConnect } from './FeishuConnect';
import { S } from '@/state/store';

const assistant = { id: 'pa_a', name: '小麓', directory: '/a', workspace: '/a' };
let host: HTMLDivElement, root: Root;
let status = { configured: false, app_id: null as string | null, authorized: false, connected: false };
const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); localStorage.setItem('lom.personal.v1:acc-1', JSON.stringify({ items: [assistant] }));
  m.shell = true; m.handler = undefined; m.invoke.mockReset();
  status = { configured: false, app_id: null, authorized: false, connected: false };
  S.cloud = 'signed-in'; S.account = { id: 'acc-1', name: 'A', email: '' };
  m.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'feishu_status') return {...status,generation:1};
    if (cmd === 'feishu_connect_begin') return { url: 'https://open.feishu.cn/page/cli?user_code=AB', qr: svg };
    if (cmd === 'feishu_authorize_begin') return { url: 'https://accounts.feishu.cn/oauth/v1/device/verify?code=CD', qr: svg };
    return undefined;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const render = async () => { await act(async () => root.render(<FeishuConnect assistant={assistant} />)); };
const click = async (label: string) => {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(label));
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
};
const step = async (payload: object) => { await act(async () => { m.handler!({ payload: {account:'acc-1',assistant_id:'pa_a',generation:1,app_id:status.app_id,...payload} }); }); };

it('FEISHU-06 one scan takes an unconnected account straight to connected; authorizing as the user is optional', async () => {
  await render();
  expect(host.textContent).toContain('未连接');
  await click('扫码连接飞书');
  expect(m.invoke).toHaveBeenCalledWith('feishu_connect_begin', { account: 'acc-1', assistantId: 'pa_a' });
  expect(host.textContent).toContain('扫码连接');
  expect(host.textContent).not.toContain('第 1 步');
  expect(host.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  // 扫完：应用建好、主人已记下，不再要第二个二维码
  status = { configured: true, app_id: 'cli_a1', authorized: false, connected: true } as typeof status;
  await step({ stage: 'app', ok: true });
  expect(m.invoke).not.toHaveBeenCalledWith('feishu_authorize_begin', expect.anything());
  expect(host.textContent).toContain('已连接');
  expect(host.textContent).toContain('cli_a1');
  await vi.waitFor(() => expect(m.invoke).toHaveBeenCalledWith('feishu_listen_start', { account: 'acc-1', assistantId: 'pa_a' }));
  // 以本人身份用文档、日历是可选的再授权
  await click('授权访问我的飞书（可选）');
  expect(m.invoke).toHaveBeenCalledWith('feishu_authorize_begin', { account: 'acc-1', assistantId: 'pa_a' });
  expect(host.textContent).toContain('扫码授权');
});

it('FEISHU-01 an app created but not yet authorized offers only the authorization scan', async () => {
  status = { configured: true, app_id: 'cli_a1', authorized: false, connected: false };
  await render();
  expect(host.textContent).toContain('还差授权');
  await click('扫码授权');
  expect(m.invoke).toHaveBeenCalledWith('feishu_authorize_begin', { account: 'acc-1', assistantId: 'pa_a' });
  expect(m.invoke).not.toHaveBeenCalledWith('feishu_connect_begin', expect.anything());
});

it('FEISHU-01 a refused or expired scan shows a plain message and lets the user scan again', async () => {
  await render();
  await click('扫码连接飞书');
  await step({ stage: 'app', ok: false, error: 'authentication: app registration failed: access_denied' });
  expect(host.textContent).toContain('拒绝了这次请求');
  expect(host.textContent).not.toContain('access_denied');
  await click('重新扫码连接');
  expect(m.invoke.mock.calls.filter(c => c[0] === 'feishu_connect_begin')).toHaveLength(2);
});

it('FEISHU-01 a missing bundled component is explained instead of failing silently', async () => {
  m.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'feishu_status') throw new Error('feishu.binary_not_found: /Applications/Lom.app/Contents/MacOS/lark-cli');
    return undefined;
  });
  await render();
  expect(host.textContent).toContain('缺少飞书组件');
});

it('FEISHU-08 leaving the panel keeps a pending authorization; outside the desktop app nothing is spawned', async () => {
  await render();
  await click('扫码连接飞书');
  await act(async () => root.unmount());
  expect(m.invoke).not.toHaveBeenCalledWith('feishu_cancel');
  root = createRoot(host);
  m.shell = false; m.invoke.mockClear();
  await render();
  expect(host.textContent).toContain('请在桌面应用里连接');
  expect(m.invoke).not.toHaveBeenCalled();
});
it('FEISHU-MULTI B gets an independent connect QR while A remains connected', async () => {
 status = { configured:true,app_id:'cli_a1',authorized:false,connected:true };await render();
 const other={...assistant,id:'pa_b',name:'B'};
 localStorage.setItem('lom.personal.v1:acc-1',JSON.stringify({items:[assistant,other]}));
 m.invoke.mockImplementation(async(cmd,args)=>cmd==='feishu_status'?(args.assistantId==='pa_a'?{...status,generation:1}:{configured:false,generation:0}):cmd==='feishu_connect_begin'?{url:'https://open.feishu.cn/scan',qr:svg,generation:1}:undefined);
 await act(async()=>root.render(<FeishuConnect key="b" assistant={other}/>));
 expect(host.textContent).toContain('未连接');await click('扫码连接飞书');
 expect(m.invoke).toHaveBeenCalledWith('feishu_connect_begin',{account:'acc-1',assistantId:'pa_b'});
 expect(host.querySelector('img')).toBeTruthy();
 expect(m.invoke.mock.calls.some(c=>c[0]==='feishu_disconnect')).toBe(false);
});
it('FEISHU-MULTI ambiguous legacy asks explicit ownership and migrates using app match',async()=>{
 localStorage.setItem('lom.personal.v1:acc-1',JSON.stringify({items:[assistant,{...assistant,id:'pa_b'}]}));
 m.invoke.mockImplementation(async(cmd,args)=>cmd==='feishu_status'?(args.assistantId?{configured:false,generation:0}:{configured:true,app_id:'legacy'}):cmd==='feishu_migrate_legacy'?{configured:true,app_id:'legacy',connected:true,generation:1}:undefined);
 await render();expect(host.textContent).toContain('归属尚未确认');await click('绑定旧机器人到此助理');
 expect(m.invoke).toHaveBeenCalledWith('feishu_migrate_legacy',{account:'acc-1',assistantId:'pa_a',appId:'legacy'});
});
it('FEISHU-ISOLATE a successful scan records the assistant that started it', async () => {
  localStorage.setItem('lom.personal.v1:acc-1', JSON.stringify({ items: [assistant, { ...assistant, id: 'pa_b', name: 'B' }], selected: 'pa_b' }));
  await render();
  await click('扫码连接飞书');
  status = { configured: true, app_id: 'cli_new', authorized: false, connected: true };
  await step({ stage: 'app', ok: true });
  expect(host.textContent).toContain('已连接');
  expect(JSON.parse(localStorage.getItem('lom.personal.feishu-binding.v2:acc-1')!)).toContainEqual({ appId: 'cli_new', assistantId: 'pa_a' });
});
it('FEISHU-MULTI deleted ownership remains recoverable without silently transferring to this assistant',async()=>{
 status={configured:true,app_id:'cli_a1',authorized:false,connected:true};
 const old=JSON.stringify({appId:'cli_a1',assistantId:'pa_gone'});localStorage.setItem('lom.personal.feishu-binding.v1:acc-1',old);
 await render();expect(host.textContent).toContain('连接飞书没有成功');
 expect(localStorage.getItem('lom.personal.feishu-binding.v1:acc-1')).toBe(old);
});
it('FEISHU-ISOLATE a disconnect confirmation from a closed assistant cannot affect another panel', async () => {
  status = { configured: true, app_id: 'cli_a1', authorized: false, connected: true };
  await render();
  await click('断开');
  const disconnect = S.modals.at(-1)!.props.onOk as () => void;
  const other = { ...assistant, id: 'pa_b', name: 'B' };
  localStorage.setItem('lom.personal.v1:acc-1', JSON.stringify({ items: [assistant, other] }));
  await act(async () => root.render(<FeishuConnect key="other" assistant={other} />));
  await act(async () => disconnect());
  expect(m.invoke).not.toHaveBeenCalledWith('feishu_disconnect', expect.anything());
});

it('FEISHU-08 auth failure retries user authorization without rebuilding the connected bot', async () => {
  status = { configured: true, app_id: 'cli_a1', authorized: false, connected: true };
  await render(); await click('授权访问我的飞书');
  await step({ stage: 'auth', ok: false, error: 'feishu.auth_not_saved' });
  expect(host.textContent).toContain('未保存');
  expect(host.textContent).not.toContain('重新扫码连接');
  await click('重试授权');
  expect(m.invoke.mock.calls.filter(c => c[0] === 'feishu_authorize_begin')).toHaveLength(2);
  expect(m.invoke).not.toHaveBeenCalledWith('feishu_connect_begin', expect.anything());
});
it('FEISHU-08 reopening resumes a pending native authorization prompt', async () => {
  status = { configured: true, app_id: 'cli_a1', authorized: false, connected: true,
    auth: { account: 'acc-1', pending: true, prompt: { url: 'https://accounts.feishu.cn/verify', qr: svg } } } as typeof status;
  await render();
  expect(host.textContent).toContain('扫码授权'); expect(host.querySelector('img')).toBeTruthy();
  expect(m.invoke).not.toHaveBeenCalledWith('feishu_authorize_begin', expect.anything());
});

it('FEISHU-MULTI foreign assistant and stale connection events cannot replace the panel',async()=>{
 await render();await click('扫码连接飞书');
 await step({assistant_id:'pa_b',stage:'app',ok:false,error:'access_denied'});
 expect(host.textContent).toContain('扫码连接');
 await step({stage:'app',ok:false,generation:-1,error:'access_denied'});
 expect(host.textContent).toContain('扫码连接');
});
