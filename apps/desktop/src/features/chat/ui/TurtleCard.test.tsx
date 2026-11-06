import { send as sendComposer } from '../actions/composer';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { enableTurtle, finishTurtle, submitTurtle, turtleQuestion } from '../actions/turtle';
import { resendEditedMessage } from '../actions/message';
import { S, update } from '@/state/store';
import { loadPersisted, initialState, persist } from '@/state/state';
import { turtleAnswerPrompt, turtleDisplayText, turtleStartPrompt } from '../runtime/turtlePrompt';
import { TurtleCard } from './TurtleCard';
import { legacyTurtleStart, legacyTurtleAnswer } from '@/test/fixtures/turtleFeedbackV1';
const send = vi.fn(), start = vi.fn(), stop = vi.fn(), resend = vi.fn();
vi.mock('../runtime/conversationSend', () => ({ resendToConversation: (...args: unknown[]) => resend(...args) }));
vi.mock('../runtime/tasks', () => ({ sendToTask: (...args: unknown[]) => send(...args), startDesktopTask: (...args: unknown[]) => start(...args), stopTask: (...args: unknown[]) => stop(...args) }));
vi.mock('@/app/navigation', () => ({ navigate: vi.fn(), go: vi.fn() }));
let host: HTMLDivElement, root: Root;
const key = 'conv:turtle-test';
const session = () => S.turtles[key];
const click = async (label: string) => act(async () => { const btn = [...host.querySelectorAll('button')].find(b => b.textContent === label); expect(btn).toBeDefined(); btn!.click(); });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  send.mockReset().mockResolvedValue(true); start.mockReset(); stop.mockReset(); resend.mockReset().mockResolvedValue(true);
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

const historyWithAnswers = (count: number) => {
  S.convs[0].messages = [{ id: 'start', type: 'user', at: 0, text: turtleStartPrompt('做一个网站') }, { id: 'first', type: 'assistant', at: 1, text: '网站面向学生吗？' }];
  for (let i = 1; i <= count; i++) S.convs[0].messages.push(
    { id: `answer-${i}`, type: 'user', at: i * 2, text: turtleAnswerPrompt('对') },
    { id: `question-${i}`, type: 'assistant', at: i * 2 + 1, text: '需要登录吗？' },
  );
};
it.each([[8, false], [9, true], [10, false], [19, true]])('TURTLE-FEEDBACK-01 A 已完成 %i 次后的请求按十次周期反馈', async (completed, summary) => {
  historyWithAnswers(completed);
  await submitTurtle(key, '对');
  expect(send.mock.calls[0][1].includes('阶段总结')).toBe(summary);
  expect(turtleDisplayText(send.mock.calls[0][1])).toBe('对');
});
it('TURTLE-FEEDBACK-01 B 总结请求失败后原样重试且不重复计数', async () => {
  historyWithAnswers(9); send.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await submitTurtle(key, '部分正确'); await submitTurtle(key);
  expect(send.mock.calls[0][1]).toContain('阶段总结');
  expect(send.mock.calls[1][1]).toBe(send.mock.calls[0][1]);
});
it('TURTLE-FEEDBACK-01 B 失败、流式与普通对话不增加已完成回答数', async () => {
  historyWithAnswers(9);
  S.convs[0].messages.push(
    {id:'bad',type:'user',at:30,text:turtleAnswerPrompt('对')}, {id:'error',type:'system',at:31,text:'发送失败'},
    {id:'retry',type:'user',at:32,text:turtleAnswerPrompt('对')}, {id:'partial',type:'assistant',at:33,text:'你想',streaming:true},
    {id:'normal',type:'user',at:34,text:'普通消息'}, {id:'normal-reply',type:'assistant',at:35,text:'知道了'},
  );
  await submitTurtle(key, '对'); expect(send.mock.calls[0][1]).toContain('阶段总结');
});
it('TURTLE-FEEDBACK-01 C 重新开始从零计数，旧历史不影响本次模式', async () => {
  historyWithAnswers(19);
  S.convs[0].messages.push({id:'restart',type:'user',at:50,text:turtleStartPrompt('新主题')}, {id:'new-question',type:'assistant',at:51,text:'你想做手机应用吗？'});
  await submitTurtle(key, '不对'); expect(send.mock.calls[0][1]).not.toContain('阶段总结');
});
it('TURTLE-FEEDBACK-01 C 恢复历史后显示进度并在第十次请求总结', async () => {
  historyWithAnswers(9); persist(S);
  const restored = initialState(); loadPersisted(restored); S.turtles = restored.turtles;
  await act(async () => root.render(<TurtleCard ckey={key} />));
  expect(host.textContent).toContain('已完成 9 次回答');
  await click('对'); expect(send.mock.calls[0][1]).toContain('阶段总结');
});
it('TURTLE-FEEDBACK-01 D 总结等待有明确反馈，完成后展示总结与下一问', async () => {
  historyWithAnswers(9);
  let done!: (v: boolean) => void; send.mockReturnValueOnce(new Promise<boolean>(resolve => { done = resolve; }));
  let sending!: Promise<void>;
  await act(async () => { sending = submitTurtle(key, '对'); root.render(<TurtleCard ckey={key} />); });
  expect(host.textContent).toContain('正在梳理你的需求');
  await act(async () => { done(true); await sending; S.convs[0].messages.push(
    {id:'tenth',type:'user',at:40,text:send.mock.calls[0][1]},
    {id:'summary',type:'assistant',at:41,text:'需求梳理\n当前需求理解：学生课程网站。\n已确认需求：网站面向学生。\n待确认事项：账号和登录要求。\n下一问：需要邮箱登录吗？'},
  ); update(); });
  expect(host.textContent).toContain('已完成 10 次回答');
  expect(host.textContent).toContain('已确认需求：网站面向学生'); expect(host.textContent).toContain('需要邮箱登录吗');
});
it.each(['failed', 'cancelled'] as const)('TURTLE-FEEDBACK-01 B %s 部分回复不算完成回答', async outcome => {
  historyWithAnswers(9);
  S.convs[0].messages.push(
    {id:'incomplete-user',type:'user',at:40,text:turtleAnswerPrompt('对'),turnOutcome:outcome},
    {id:'partial-result',type:'assistant',at:41,text:'尚未完整输出'},
    {id:'terminal',type:'system',at:42,text:'这一轮没有正常完成',turnOutcome:outcome},
  );
  await submitTurtle(key, '对'); expect(send.mock.calls[0][1]).toContain('阶段总结');
});
it('TURTLE-FEEDBACK-01 B 原消息重试成功后旧错误提示不抵消本轮成功', async () => {
  historyWithAnswers(8);
  S.convs[0].messages.push(
    {id:'retried-user',type:'user',at:40,text:turtleAnswerPrompt('对'),turnOutcome:'completed'},
    {id:'old-error',type:'system',at:41,text:'发送失败',turnOutcome:'failed'},
    {id:'retried-answer',type:'assistant',at:42,text:'完整的下一问？'},
  );
  await submitTurtle(key, '对'); expect(send.mock.calls[0][1]).toContain('阶段总结');
});
it('TURTLE-FEEDBACK-01 E 编辑后重发同样在第十次请求阶段总结', async () => {
  historyWithAnswers(9);
  await resendEditedMessage('turtle-test', S.convs[0].messages[2], '部分正确');
  expect(resend.mock.calls[0][1]).toContain('阶段总结');
  expect(turtleDisplayText(resend.mock.calls[0][1])).toBe('部分正确');
});
it('TURTLE-FEEDBACK-01 E 编辑发送失败后卡片保留并重试同一总结请求', async () => {
  historyWithAnswers(9); resend.mockResolvedValueOnce(false);
  await resendEditedMessage('turtle-test', S.convs[0].messages[2], '修改后的回答');
  expect(session().error).not.toBe('');
  await submitTurtle(key);
  expect(send.mock.calls[0][1]).toBe(resend.mock.calls[0][1]);
  expect(send.mock.calls[0][1]).toContain('阶段总结');
});
it('TURTLE-FEEDBACK-02 A 第十次梳理累计用户需求，不输出猜测清单', async () => {
  historyWithAnswers(9); await submitTurtle(key, '对');
  const request = send.mock.calls[0][1];
  expect(request).toContain('当前需求理解'); expect(request).toContain('已确认需求'); expect(request).toContain('待确认事项');
  expect(request).toContain('累计'); expect(request).not.toContain('当前推测');
});
it('TURTLE-FEEDBACK-02 B 新会话明确需求澄清与需求梳理目的', () => {
  const request = turtleStartPrompt('课程网站');
  expect(request).toContain('用户需求'); expect(request).not.toContain('还原事实'); expect(request).not.toContain('谜底');
  expect(turtleDisplayText(request)).toBe('海龟汤提问卡 · 课程网站');
});
it('TURTLE-FEEDBACK-02 C 旧版开始和总结回答可恢复计数并折叠提示', async () => {
  historyWithAnswers(8); S.convs[0].messages[0].text = legacyTurtleStart;
  S.convs[0].messages.push({id:'legacy-answer',type:'user',at:40,text:legacyTurtleAnswer}, {id:'legacy-response',type:'assistant',at:41,text:'旧总结和问题？'});
  expect(turtleDisplayText(legacyTurtleStart)).toBe('海龟汤提问卡 · 旧主题');
  expect(turtleDisplayText(legacyTurtleAnswer)).toBe('部分正确\n请保留补充');
  await submitTurtle(key, '对'); expect(send.mock.calls[0][1]).toContain('已确认需求');
});
it('TURTLE-FEEDBACK-02 C 旧版总结重试升级成需求梳理并保留原回答', async () => {
  session().request = legacyTurtleAnswer;
  await submitTurtle(key);
  const request = send.mock.calls[0][1];
  expect(request).toContain('已确认需求'); expect(request).not.toContain('当前推测');
  expect(turtleDisplayText(request)).toBe('部分正确\n请保留补充');
});
it('TURTLE-FEEDBACK-02 C 旧版首问重试升级需求语义且保留主题', async () => {
  session().request = legacyTurtleStart;
  await submitTurtle(key);
  expect(send.mock.calls[0][1]).toContain('用户需求');
  expect(turtleDisplayText(send.mock.calls[0][1])).toBe('海龟汤提问卡 · 旧主题');
});
it('TURTLE-FEEDBACK-02 C 重新开启的旧版开始记录也能分隔计数', async () => {
  historyWithAnswers(19);
  S.convs[0].messages.push({id:'old-restart',type:'user',at:50,text:legacyTurtleStart}, {id:'old-question',type:'assistant',at:51,text:'新主题问题？'});
  await submitTurtle(key, '对');
  expect(send.mock.calls[0][1]).not.toContain('已确认需求');
});
