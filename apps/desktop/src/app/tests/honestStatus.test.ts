import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { installSkill, uninstallSkill, saveUpload, unpublish } from '@/features/skills/actions/skills';
import { checkUpdate, exportData, setPref, togglePref } from '@/features/settings/actions/settings';
import { PENDING_PREFERENCES } from '@/shared/lib/unavailable';
import { doSendFiles, reconnect, revokePC, saveSoul, editSub, toggleSub } from '@/features/phones/actions/phone';
import { runSched } from '@/features/schedules/actions/schedule';
import { send, superviseNow, askInspect } from '@/features/chat/actions/composer';
import { resendEditedMessage } from '@/features/chat/actions/message';
import { sim } from '@/demo/simulator';
const { runCoreSchedule, writePhoneDocument } = vi.hoisted(() => ({ runCoreSchedule: vi.fn(), writePhoneDocument: vi.fn() }));
vi.mock('@/features/schedules/runtime/schedules', async original => ({ ...await original<object>(), runCoreSchedule }));
vi.mock('@/features/phones/runtime/phoneDocuments', async original => ({ ...await original<object>(), writePhoneDocument }));
beforeEach(() => { vi.useFakeTimers(); runCoreSchedule.mockReset(); writePhoneDocument.mockReset(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
const notExecuted = () => expect(S.toast?.text).toContain('暂未接入');
const toastText = () => S.toast?.text;

it('D06 AC1 安装卸载不改安装列表，上传下架保留草稿及状态', () => {
  const before = JSON.stringify([S.installed, S.mySkills]);
  const skill = S.skills[0].id;
  installSkill(skill, 'pc'); notExecuted();
  uninstallSkill(skill, 'pc'); notExecuted();
  S.form = { name: '我的技能', file: 'draft.lomskill' };
  S.modals = [{ id: 'upload', props: {} }];
  saveUpload(); notExecuted();
  unpublish(S.mySkills[0].id); notExecuted();
  expect(JSON.stringify([S.installed, S.mySkills])).toBe(before);
  expect(S.form.name).toBe('我的技能'); expect(S.modals[0].id).toBe('upload');
});

it('D25 检查更新打开真实更新面板；未接入的导出仍不报成功', () => {
  checkUpdate(); expect(S.modals.at(-1)?.id).toBe('update'); exportData(); notExecuted();
});

it('D06 AC3 文件发送、撤销、重连不伪造状态或延迟成功', () => {
  S.form = { progress: 0, sending: false }; const before = JSON.stringify([S.authorizedPCs, S.agents]);
  doSendFiles('p1'); notExecuted();
  revokePC('any', 'p1'); notExecuted(); reconnect('p3');
  vi.advanceTimersByTime(10000);
  expect(JSON.stringify([S.authorizedPCs, S.agents])).toBe(before);
  expect(S.form).toEqual({ progress: 0, sending: false }); expect(S.modals).toHaveLength(0);
});

it('D06 AC4 示例任务不添加执行记录；真实任务保留核心调用与失败反馈', async () => {
  const example = S.schedules.find(x => x.exec === 'p1')!;
  const before = JSON.stringify(example);
  await runSched(example.id); notExecuted(); expect(JSON.stringify(example)).toBe(before);
  expect(runCoreSchedule).not.toHaveBeenCalled();
  example.remote = true; runCoreSchedule.mockResolvedValue(undefined);
  await runSched(example.id); expect(runCoreSchedule).toHaveBeenCalledWith(example.id);
  expect(S.toast?.text).toContain('已提交运行');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  runCoreSchedule.mockRejectedValue(new Error('核心连接中断'));
  await runSched(example.id); expect(S.toast?.text).toContain('运行定时任务失败'); log.mockRestore();
});

it('D06 AC5 团队与监工不调用模拟器，保留用户消息和附件', async () => {
  const key = `team:${S.teams[0].id}:${S.teams[0].members[0].mid}`;
  S.drafts[key] = '请帮我执行'; S.attachments[key] = [{ name: '计划.md' }];
  const before = JSON.stringify([S.teams, S.convs]);
  await send(key); notExecuted();
  expect(await resendEditedMessage(key, { id:'u', type:'user', at:0 }, '新任务')).toBe(false);
  superviseNow('p1'); askInspect(key); notExecuted();
  S.drafts.home = '/接管'; await send('home'); notExecuted();
  expect(S.drafts[key]).toBe('请帮我执行'); expect(S.attachments[key]).toHaveLength(1);
  expect(S.drafts.home).toBe('/接管'); expect(JSON.stringify([S.teams, S.convs])).toBe(before);
  expect(S.running).toEqual({});
});

it('D06 AC6 未接入设置不改变偏好，子代理开关不伪装启用', () => {
  const subs = JSON.stringify(S.subagents);
  for (const key of Object.keys(S.prefs).filter(k => PENDING_PREFERENCES[k])) { togglePref(key); notExecuted(); }
  setPref('lang', 'English');
  expect(S.prefs.lang).toBe('English'); setPref('lang', '简体中文');
  toggleSub(S.subagents[S.phoneId][0].id);
  expect(JSON.stringify(S.subagents)).toBe(subs);
  // 已接入的偏好真实切换
  const sound = S.prefs.sound; togglePref('sound'); expect(S.prefs.sound).toBe(!sound); togglePref('sound');
});

it('PHONE-01 / D06 AC7 示例子代理拒绝编辑，真实人格等待回执才显示成功', async () => {
  S.form = { name:'草稿', duty:'整理', enabled:true }; const before = JSON.stringify(S.subagents);
  editSub(); expect(S.toast?.text).toContain('真实手机');
  expect(S.modals).toHaveLength(0); expect(S.form.name).toBe('草稿');
  expect(JSON.stringify(S.subagents)).toBe(before);
  await saveSoul(); expect(S.toast?.text).toContain('未同步到手机');
  S.agents[S.phoneId].real = true; S.toast = null;
  let finish!: () => void;
  writePhoneDocument.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = saveSoul(); expect(S.toast).toBeNull();
  finish(); await pending; expect(toastText()).toBe('手机已保存人格');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  writePhoneDocument.mockRejectedValue(new Error('手机离线'));
  await saveSoul(); expect(toastText()).toContain('人格未同步'); log.mockRestore();
});

it('D06 AC7 示例手机回复明确说明未实际执行', () => {
  const c = S.convs.find(x => x.owner === 'p1')!;
  c.messages = []; sim.phone(c, '回复评论'); vi.advanceTimersByTime(60000);
  expect(c.messages.length).toBeGreaterThan(1);
  for (const m of c.messages) expect(m.type === 'tool' ? m.tool : m.text).toContain('演示');
});
