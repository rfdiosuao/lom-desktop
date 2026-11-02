import { renameConv, exportConv } from '../actions/conversations';
import { archiveCmd, compactCmd, effortCmd, memoryCmd, sideChatCmd, startGoalCmd } from '../actions/commands';
import { effortName, lomSupportsEffort } from '../runtime/commands';
import { choiceName, effortOption } from '@/features/settings/runtime/agentOptions';
import { openModal } from '@/shared/overlays/controller';
import { newTask, openSettings, gotoPhonePage } from '@/app/navigation';
import { editSched } from '@/features/schedules/actions/schedule';
import { enableTurtle } from '../actions/turtle';
import { loadCommandSkills } from '../runtime/commandSkills';
import { isInternalSkill } from '@/features/skills/runtime/upstreamSkills';
import type { MenuItem } from '@/shared/ui/Overlay';
import { convOfKey, paneIsDesktop, paneOf } from '@/features/teams/runtime/team';
import { S, update } from '@/state/store';

const clearCommand = (key: string) => update(s => { s.drafts[key] = ''; s.menu = null; });
export function slashMenu(key: string, query: string): MenuItem[] {
  // 任务页（conv:）和团队窗格（team:）都找到对应的会话；团队窗格还没开始时也算真实会话，发送时会新建
  const c = convOfKey(key);
  const pane = paneOf(key);
  const paneDevice = pane && S.agents[pane.m.agent]?.real ? pane.m.agent : undefined;
  const device = c?.phoneSession ? c.owner : paneDevice || (key === 'home' && S.mode === 'phone' && S.agents[S.phoneId]?.real ? S.phoneId : undefined);
  const real = key === 'home' ? S.mode === 'desktop' : pane ? paneIsDesktop(key) : !!c?.remote;
  const run = (action: () => void) => () => { clearCommand(key); action(); };
  // 电脑上的真实任务（任务页或团队里的 Lom / 电脑 Agent 成员）
  const task = c?.remote && !c.sideOf ? c : undefined;
  const desk = !!task || (key === 'home' && S.mode === 'desktop');
  const goal = S.goals[task ? `conv:${task.id}` : 'home'];
  const extEffort = task?.agentId ? effortOption(S.agentOptions[task.id]) : undefined;
  // 推理强度四态：外部 Agent 要分清「支持 / 不支持 / 还没读到选项」；Lom 任务看当前模型平台。
  // home 页还要看选中的 Agent：选了外部 Agent 时不该列出 Lom 的低/中/高。
  const homeAgent = key === 'home' ? S.agentPick : '';
  const effortOk = task
    ? (task.agentId ? !!extEffort?.options?.length : lomSupportsEffort(task.providerId))
    : key === 'home' && S.mode === 'desktop' && !homeAgent;
  const effortDesc = !effortOk
    ? (task?.agentId ? (extEffort ? '还没读到这个 Agent 的推理选项' : `${task.agentName || '这个 Agent'} 没有推理强度选项`) : task ? '当前模型不支持调整推理强度' : homeAgent ? `${homeAgent === 'pc' ? 'Lom' : S.agentCatalog?.find(a => a.id === homeAgent)?.name || '这个 Agent'} 的推理强度由它自己的设置决定` : '先打开一个任务')
    : task?.agentId ? `${task.agentName}：${choiceName(extEffort, extEffort?.current_value) || '默认'}` : `当前：${effortName(task ? task.effort : S.effortPick)}（低 / 中 / 高）`;
  const commands: MenuItem[] = [
    { label: '海龟汤提问卡', desc: 'AI 提问，你回答对、不对或其他', ic: 'message', disabled: !real, onSelect: () => enableTurtle(key) },
    { label: '定时任务', desc: '设置时间和任务内容', ic: 'clock', disabled: !real && !device, onSelect: run(() => editSched({exec: device || 'pc'})) },
    { label: '使用情况和计费', desc: '打开模型、积分和充值设置', ic: 'wallet', onSelect: run(() => openSettings('models')) },
    { label: '重命名', desc: c ? '重命名当前聊天' : '先打开一个聊天', ic: 'edit', disabled: !c, onSelect: run(() => c && renameConv(c.id)) },
    { label: '导出聊天', desc: '保存当前聊天为 Markdown', ic: 'download', disabled: !c, onSelect: run(() => c && exportConv(c.id)) },
    { label: '新聊天', desc: '在当前工作文件夹开启空白聊天', ic: 'plus', onSelect: run(newTask) },
    { label: '清空输入', desc: '只清空当前输入框', ic: 'close', onSelect: () => clearCommand(key) },
    { label: 'MCP', desc: '添加、管理和测试工具服务', ic: 'link', onSelect: run(() => openModal('mcp')) },
    device
      ? { label: '记忆', desc: '查看与编辑当前手机记忆', ic: 'database', onSelect: run(() => gotoPhonePage(device, 'phone-memory')) }
      : { label: '记忆', desc: desk ? 'Lom 在这个工作文件夹里记住的事：查看、修改、新增' : '先打开一个任务', ic: 'database', disabled: !desk, onSelect: () => memoryCmd(key) },
    { label: '目标', desc: goal ? `当前：${goal.text.slice(0, 24)}${goal.done ? '（已达成）' : ''}` : '/goal 设定任务目标，之后每一轮都朝它推进', ic: 'flag', disabled: !desk && key !== 'home', onSelect: () => startGoalCmd(key) },
    { label: '侧边聊天', desc: task && !task.agentId ? '在旁边临时问几句，不写进这个任务' : task ? '外部 Agent 暂不支持侧边聊天' : '先打开一个任务', ic: 'message', disabled: !task || !!task.agentId, onSelect: () => sideChatCmd(key) },
    { label: '压缩', desc: task ? '把前面的对话整理成摘要，后面更省额度' : '先打开一个任务', ic: 'refresh', disabled: !task, onSelect: () => compactCmd(key) },
    { label: '归档', desc: task ? '归档当前任务，随时可以恢复' : '先打开一个任务', ic: 'archive', disabled: !task, onSelect: run(() => archiveCmd(task)) },
    { label: '推理', desc: effortDesc, ic: 'brain', disabled: !effortOk, onSelect: () => effortCmd(key) },
  ];
  const matches = (it: MenuItem) => typeof it !== 'string' && !it.header && `${it.label} ${it.desc || ''}`.toLowerCase().includes(query.toLowerCase());
  const rows = commands.filter(matches);
  /* 上游内部技能（管理 AionUi 自身、给 Agent 自己用的工具）不在菜单里展示，见 core/upstreamSkills */
  const skills: MenuItem[] = S.commandSkills.items.filter(skill => !isInternalSkill(skill)).map(skill => ({
    label: skill.name, desc: skill.description, ic: 'cube', hint: ({builtin:'内置',custom:'个人',cron:'定时任务',extension:'扩展'})[skill.source] || '技能', disabled: !real,
    onSelect: () => update(s => { s.drafts[key] = `使用技能「${skill.name}」：`; s.focusNext = `composer:${key}`; s.menu = null; }),
  })).filter(matches);
  const status: MenuItem[] = S.commandSkills.loading ? [{header:true,label:'正在读取技能…'}] : S.commandSkills.error
    ? [{label:'技能加载失败，点击重试',desc:S.commandSkills.error,ic:'refresh',keepOpen:true,onSelect:()=>void loadCommandSkills()}]
    : !skills.length ? [{header:true,label:query ? '没有匹配的技能' : '暂无可用技能'}] : [];
  return [{header:true,label:'命令'}, ...rows, {header:true,label:'技能'}, ...skills, ...status];
}

/** 斜杠菜单里是否有可选的项；没有时 Enter 应该当作普通发送（例如消息以路径 /Users/... 开头） */
export const slashHasChoice = (key: string, query: string) =>
  slashMenu(key, query).some(it => it !== '-' && !it.header && !it.disabled);
