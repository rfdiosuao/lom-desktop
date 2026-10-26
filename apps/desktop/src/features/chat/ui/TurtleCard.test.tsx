import { send as sendComposer } from '../actions/composer';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { enableTurtle, finishTurtle, submitTurtle, turtleQuestion } from '../actions/turtle';
import { S, update } from '@/state/store';
import { loadPersisted, initialState, persist } from '@/state/state';
import { turtleAnswerPrompt, turtleDisplayText, turtleStartPrompt } from '../runtime/turtlePrompt';
import { TurtleCard } from './TurtleCard';
const send = vi.fn(), start = vi.fn(), stop = vi.fn();
vi.mock('../runtime/tasks', () => ({ sendToTask: (...args: unknown[]) => send(...args), startDesktopTask: (...args: unknown[]) => start(...args), stopTask: (...args: unknown[]) => stop(...args) }));
vi.mock('@/app/navigation', () => ({ navigate: vi.fn(), go: vi.fn() }));
let host: HTMLDivElement, root: Root;
const key = 'conv:turtle-test';
const session = () => S.turtles[key];
const click = async (label: string) => act(async () => { const btn = [...host.querySelectorAll('button')].find(b => b.textContent === label); expect(btn).toBeDefined(); btn!.click(); });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  send.mockReset().mockResolvedValue(true); start.mockReset(); stop.mockReset();
  S.convs = [{ id: 'turtle-test', owner: 'pc', remote: true, loaded: true, title: '测试', updated: 0, messages: [{id:'u',type:'user',at:1,text:'开始'}, {id:'q',type:'assistant',at:2,text:'你想做一个网站吗？'}] }];
  enableTurtle(key); session().started = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); });
it('D03 点击对提交真实会话续问指令', async () => {
  await act(async () => root.render(<TurtleCard ckey={key} />));
  expect(host.textContent).toContain('你想做一个网站吗？');
  await click('对'); expect(send).toHaveBeenCalledWith(S.convs[0], turtleAnswerPrompt('对'), []);
});
it('D03 其他需输入内容并确认', async () => {
  await act(async () => root.render(<TurtleCard ckey={key} />));
  await click('其他'); expect(send).not.toHaveBeenCalled();
  expect([...host.querySelectorAll('button')].find(b => b.textContent === '发送回答')?.disabled).toBe(true);
  const input = host.querySelector('textarea')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '不确定，我想先做手机端');
    input.dispatchEvent(new Event('input', {bubbles:true}));
  });
  await click('发送回答'); expect(send.mock.calls[0][1]).toContain('不确定，我想先做手机端'); expect(host.querySelector('textarea')).toBeNull();
});
it('D03 等待请求时连续点击只提交一次', async () => {
  let done!: (v: boolean) => void; send.mockReturnValue(new Promise<boolean>(resolve => { done = resolve; }));
  const first = submitTurtle(key, '不对'); await submitTurtle(key, '不对');
  expect(send).toHaveBeenCalledTimes(1); done(true); await first;
});
it('D03 失败保留补充回答并原样重试', async () => {
  send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  session().other = '部分正确'; session().showOther = true;
  await submitTurtle(key, '部分正确'); expect(session().other).toBe('部分正确'); expect(session().error).not.toBe('');
  await submitTurtle(key); expect(send.mock.calls[1][1]).toBe(send.mock.calls[0][1]); expect(session().error).toBe('');
});
it('D03 新轮次失败或流式输出不复用旧题', () => {
  S.convs[0].messages.push({id:'u2',type:'user',at:3,text:'对'}, {id:'e',type:'system',at:4,text:'发送失败：网络错误'});
  expect(turtleQuestion(key)).toEqual({question:'',failed:true});
  S.convs[0].messages.pop(); S.convs[0].messages.push({id:'partial',type:'assistant',at:5,text:'你想',streaming:true});
  expect(turtleQuestion(key).question).toBe('');
});
it('D03 首页创建真实会话并迁移卡片，不发送附件', async () => {
  S.drafts.home = '/海龟汤 我想做网站'; S.attachments.home = [{name:'private.txt'}]; enableTurtle('home'); start.mockResolvedValue('new');
  await submitTurtle('home'); expect(start).toHaveBeenCalledWith(turtleStartPrompt('我想做网站'), [], { title: '海龟汤 · 我想做网站' });
  expect(S.turtles['conv:new'].started).toBe(true); expect(S.turtles.home).toBeUndefined(); expect(S.attachments.home).toHaveLength(1);
});
it('D03 手机演示不创建真实提问模式', () => { S.mode = 'phone'; enableTurtle('home'); expect(S.turtles.home).toBeUndefined(); });
it('D03 结束等待停止确认，失败时保留卡片', async () => {
  S.running['turtle-test'] = true; stop.mockResolvedValue(undefined);
  await finishTurtle(key); expect(session().active).toBe(true);
  stop.mockImplementation(async () => { delete S.running['turtle-test']; }); await finishTurtle(key); expect(session().active).toBe(false);
});
it('D03 会话卡片恢复与模板显示保持原回答', () => {
  persist(S); const restored = initialState(); loadPersisted(restored); expect(restored.turtles[key].active).toBe(true);
  expect(turtleDisplayText(turtleAnswerPrompt('对\n补充一句'))).toBe('对\n补充一句'); expect(turtleDisplayText('普通消息')).toBe('普通消息');
});
it('D03 运行中禁止点击回答', async () => {
  await act(async () => { update(s => { s.running['turtle-test'] = true; }); root.render(<TurtleCard ckey={key} />); });
  expect([...host.querySelectorAll('button')].find(b=>b.textContent === '对')?.disabled).toBe(true);
  await click('对'); expect(send).not.toHaveBeenCalled(); expect(host.textContent).toContain('正在准备下一问');
});

it('D03 结束提问后原有快捷命令仍在本地执行', async () => {
  session().active = false; S.drafts[key] = '/技能';
  await sendComposer(key); expect(send).not.toHaveBeenCalled(); expect(S.drafts[key]).toBe('');
});
