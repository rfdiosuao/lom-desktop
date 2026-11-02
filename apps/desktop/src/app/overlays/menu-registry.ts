import { openPersonalPanel } from '@/features/personal/runtime/panel';
import { ensureCloudConfig, repairBuiltin } from '@/features/account/runtime/cloud';
import { historyMenu } from '@/features/chat/slash/historyMenu';
import { slashMenu } from '@/features/chat/slash/slashMenu';
import { addAgents, pickAgent } from '@/features/settings/actions/agents';
import { agentRow, externalModel, logoUrl, pinnedAgents, usable } from '@/features/settings/runtime/agents';
import { archiveCmd, pickEffort, sideChatCmd } from '@/features/chat/actions/commands';
import { sendFiles } from '@/features/phones/actions/phone';
import { EFFORTS, lomSupportsEffort } from '@/features/chat/runtime/commands';
import { convOfKey } from '@/features/teams/runtime/team';
import { cachedOptions, choiceName, effortOption, isProbing, probeAgentOptions, setConvOption } from '@/features/settings/runtime/agentOptions';
import { planLabel } from '@/features/account/runtime/plans';
import { unreadFeedback } from '@/features/account/runtime/feedback';
import { enableTurtle } from '@/features/chat/actions/turtle';
import { addAttach, askInspect, attachAll, browseFolder, insertMention, pickFolderPath, pickModel, pickPerm, toggleAttachPhone } from '@/features/chat/actions/composer';
import { deleteConv, deleteGroup, exportConv, moveConv, newGroup, pinConv, renameConv, renameGroup } from '@/features/chat/actions/conversations';
import { addMember, deleteTeam, renameTeam } from '@/features/teams/actions/teams';
import { installSkill } from '@/features/skills/actions/skills';
import { setTheme, watchPhone } from '../shell/layout';
import { enterPhone, gotoPhonePage, openSettings, pickPhone } from '../navigation';
import { openMenu, toast, toastError } from '@/shared/overlays/controller';
import { applySoulTpl, pair, renamePhone, unpair } from '@/features/phones/actions/phone';
import { deleteSched, dupSched, editSched, schedRuns } from '@/features/schedules/actions/schedule';
import { feedback, logout, recharge, setPref, shortcuts } from '@/features/settings/actions/settings';
import { formSet } from '@/features/schedules/actions/schedule';
import { getEndpoint } from '@/core/client';
import { signIn } from '@/features/account/runtime/cloud';
import type { MenuItem } from '@/shared/ui/Overlay';
import { agent, attached, conv, convsOf, currentPcModel, PERMISSIONS, personaOf, phoneModelChoice, phoneModels, phones, pcModels, quotaLeft, skill, team } from '@/state/selectors';
import { S, update } from '@/state/store';
import type { MenuCtx } from '@/state/types';
import { basename, prettyPath } from '@/shared/lib/util';

/* ===== 下拉菜单内容：每个菜单是一个函数，返回菜单项（统一由 MenuHost 渲染） ===== */

type MenuFn = (ctx: MenuCtx) => MenuItem[];

const account: MenuFn = () => {
  const a = S.account;
  if (!a) {
    return [
      { header: true, label: '未登录' },
      { label: S.cloud === 'signing-in' ? '正在登录…' : '登录 HEANG 账号', ic: 'person', onSelect: () => void signIn(), disabled: S.cloud === 'signing-in', desc: '登录后可用 Lom 云端模型，每月送 300 点' },
      '-',
      { label: S.theme === 'dark' ? '切换到浅色' : '切换到深色', ic: S.theme === 'dark' ? 'sun' : 'moon', onSelect: () => setTheme(S.theme === 'dark' ? 'light' : 'dark') },
      { label: '快捷键', ic: 'keyboard', onSelect: shortcuts, hint: '⌘/' },
      { label: '帮助与反馈', ic: 'help', onSelect: feedback },
    ];
  }
  return [
    { header: true, label: `${a.name || a.email} · ${planLabel()}` },
    { label: '账号设置', ic: 'person', onSelect: () => openSettings('account') },
    { label: '模型与额度', ic: 'wallet', onSelect: () => openSettings('models'), hint: `${S.points?.total ?? '—'} 点` },
    { label: '充值积分', ic: 'zap', onSelect: recharge },
    { label: 'Personal Agent', ic: 'sparkles', onSelect: openPersonalPanel },
    '-',
    { label: S.theme === 'dark' ? '切换到浅色' : '切换到深色', ic: S.theme === 'dark' ? 'sun' : 'moon', onSelect: () => setTheme(S.theme === 'dark' ? 'light' : 'dark') },
    { label: '快捷键', ic: 'keyboard', onSelect: shortcuts, hint: '⌘/' },
    { label: '帮助与反馈', ic: 'help', onSelect: feedback, hint: unreadFeedback() ? `${unreadFeedback()} 条新回复` : undefined },
    '-',
    { label: '退出登录', ic: 'logout', onSelect: logout, danger: true },
  ];
};

const phonePick: MenuFn = () => [
  { header: true, label: '选择手机' },
  ...phones().map(p => ({ label: p.name, desc: `${personaOf(p)} · ${p.status === 'online' ? '在线' : '离线'}`, avatar: p, onSelect: () => pickPhone(p.id), select: 'single' as const, checked: S.phoneId === p.id })),
  '-',
  { label: '配对新手机…', ic: 'plus', onSelect: pair },
  { label: '管理手机', ic: 'settings', onSelect: () => openSettings('connections') },
];

/** 模型菜单分组：Lom 内置三档 / 订阅包含的星钥模型 / 自带 Key；只有一组时不加小标题 */
function modelGroups(options: ReturnType<typeof pcModels>): [string, ReturnType<typeof pcModels>][] {
  const groups: [string, ReturnType<typeof pcModels>][] = [
    ['Lom 内置', options.filter(m => !m.byok && m.desc !== '订阅包含的模型')],
    ['订阅包含', options.filter(m => m.desc === '订阅包含的模型')],
    ['自带 Key', options.filter(m => m.byok)],
  ];
  const used = groups.filter(([, list]) => list.length);
  return used.length > 1 ? used : used.map(([, list]) => ['', list]);
}

const model: MenuFn = ctx => {
  void ensureCloudConfig().catch(() => { /* cloudError is shown and send will retry configuration, never messages. */ });
  const isPhone = (ctx.agent && ctx.agent !== 'pc') || (ctx.team && agent(team(ctx.team)?.members.find(x => x.mid === ctx.mid)?.agent ?? '')?.kind === 'phone');
  let cur: string;
  if (ctx.team) { const m = team(ctx.team)?.members.find(x => x.mid === ctx.mid); cur = m?.model || (isPhone ? agent(m?.agent ?? '')?.model ?? S.phoneModel : currentPcModel()?.id ?? ''); }
  else if (ctx.agent === 'phones') cur = S.phoneModel;
  else if (isPhone) cur = agent(ctx.agent ?? '')?.model || S.phoneModel;
  else cur = (ctx.ckey ? (() => { const c = convOfKey(ctx.ckey); return c?.lomTier ? `lom-${c.lomTier}` : c?.modelId; })() : undefined) ?? currentPcModel()?.id ?? '';
  const forPhone = isPhone || ctx.agent === 'phones';
  const options = forPhone ? phoneModels() : ctx.ckey?.startsWith('personal:') ? pcModels().filter(m => !m.byok) : pcModels();
  const chosen = phoneModelChoice(cur);
  const curId = chosen?.id ?? cur;
  const pick = (id: string) => () => pickModel({ model: id, agent: ctx.agent, team: ctx.team, mid: ctx.mid, ckey: ctx.ckey });
  return [
    { header: true, label: forPhone ? '手机 Agent 的模型（发任务时同步到手机）' : quotaLeft() === null ? '总指挥使用的模型' : `总指挥使用的模型 · 积分 ${quotaLeft()} 点` },
    ...modelGroups(options).flatMap(([title, list]) => [
      ...(title ? [{ header: true as const, label: title }] : []),
      ...list.map(m => ({
        label: m.name, desc: `${m.desc} · ${m.cost}`, ic: m.byok ? 'key' : 'cube', onSelect: pick(m.lomTier ? `lom-${m.lomTier}` : m.id),
        select: 'single' as const, checked: chosen?.lomTier ? chosen.lomTier === m.lomTier : curId === m.id, disabled: m.unavailable,
      })),
    ]),
    '-',
    ...(S.account ? [] : [{ label: '登录 HEANG 账号', ic: 'person', onSelect: () => void signIn(), desc: '使用 Lom Pro / Max / Mini' }]),
    ...(S.account ? [{ label: '重新同步内置模型', ic: 'refresh', onSelect: () => void repairBuiltin(), desc: S.cloudError || '同步后台模型与权限配置' }] : []),
    ...(ctx.ckey?.startsWith('personal:') ? [] : [{ label: '添加 API Key', ic: 'key', onSelect: () => openSettings('models') }]),
    { label: '充值积分', ic: 'wallet', onSelect: recharge },
  ];
};

/* 输入框上方「添加手机」：多选，决定这个任务可以查看和操作哪些手机 */
const attachPhones: MenuFn = ctx => {
  const key = ctx.ckey || 'home', ids = attached(key);
  const c = convOfKey(key);
  const locked = c && c.owner !== 'pc' ? c.owner : key === 'home' && S.mode === 'phone' ? S.phoneId : null;
  const lastTask = (id: string) => {
    const cv = convsOf(id)[0];
    const fail = S.schedules.find(x => x.exec === id && x.runs[0] && !x.runs[0].ok);
    return fail ? `上次「${fail.name}」需要处理` : cv ? `最近：${cv.title}` : '暂无任务';
  };
  return [
    { header: true, label: '选择手机 · 自动调度尚未接入' },
    ...phones().map(p => ({
      label: p.name + (p.id === locked ? '（当前对话）' : ''), desc: `${personaOf(p)} · ${p.status === 'online' ? '在线' : '离线'} · ${lastTask(p.id)}`,
      avatar: p, onSelect: () => toggleAttachPhone(key, p.id), select: 'multi' as const, checked: ids.includes(p.id), keepOpen: true, disabled: p.id === locked,
    })),
    '-',
    { label: '全部添加', ic: 'check', onSelect: () => attachAll(key, true), keepOpen: true },
    { label: '清空', ic: 'close', onSelect: () => attachAll(key, false), keepOpen: true, disabled: !ids.filter(id => id !== locked).length },
    { label: '检查已添加手机的任务情况', ic: 'eye', onSelect: () => askInspect(key), disabled: !ids.length, desc: '暂未接入，请进入手机会话直接提问' },
    '-',
    { label: '配对新手机…', ic: 'plus', onSelect: pair },
  ];
};

const permission: MenuFn = ctx => [
  { header: true, label: '总指挥在电脑上的权限（远程操作手机不受此限制）' },
  ...PERMISSIONS.map(p => ({ label: p.name, desc: p.desc, ic: p.ic, onSelect: () => pickPerm(p.id, ctx.ckey), select: 'single' as const, checked: S.permission === p.id })),
];

/** 「+」打开的子菜单：等「+」菜单关掉后，在同一个输入框上打开 */
const thenOpen = (id: string, key: string, ctx: Record<string, string>) => () => setTimeout(() => {
  const el = document.querySelector<HTMLElement>(`[data-composer="${key}"]`)?.closest<HTMLElement>('.composer');
  if (el) openMenu(id, el, { ...ctx, matchWidth: 'true' });
}, 0);

const attach: MenuFn = ctx => {
  const key = ctx.ckey || 'home';
  const c = convOfKey(key);
  const isPhone = c ? c.owner !== 'pc' : S.mode === 'phone';
  const device = c && c.owner !== 'pc' ? c.owner : S.phoneId;
  const ext = !!c?.agentId || (key === 'home' && !!S.agentPick);
  // 打开的任务显示它自己的工作文件夹；新任务页才是全局默认
  const folderNow = c?.remote ? c.workspace || '' : S.folder;
  const ids = attached(key), names = ids.map(id => agent(id)?.name ?? '');
  const phonesDesc = !ids.length ? '让总指挥能看屏、操作、派活给手机' : ids.length <= 2 ? `已添加：${names.join('、')}` : `已添加 ${names[0]} 等 ${ids.length} 台`;
  return [
    { header: true, label: '添加' },
    { label: '文件', desc: '添加任务所需的资料', ic: 'paperclip', onSelect: () => void addAttach(key, 'file') },
    { label: '添加图片', ic: 'image', onSelect: () => void addAttach(key, 'image') },
    ...(isPhone ? [{ label: '发送文件到手机', desc: agent(device)?.name || '手机', ic: 'upload', onSelect: () => sendFiles(device) }]
      : [{ label: '工作文件夹', desc: folderNow ? prettyPath(folderNow, S.homeDir) : '选择任务的工作目录', ic: 'folder', onSelect: thenOpen('folder', key, { ckey: key, key: `fold${key}` }) }]),
    ...(!ext && !key.startsWith('team:') ? [{ label: isPhone ? '手机' : '添加手机', desc: phonesDesc, ic: 'phone', onSelect: thenOpen('attachPhones', key, { ckey: key, key: `ap${key}` }) }] : []),
    { label: '海龟汤提问卡', desc: 'AI 提问，你回答对、不对或其他', ic: 'message', disabled: isPhone, onSelect: () => enableTurtle(key) },
    { label: '侧边对话', desc: c?.remote && !isPhone && !c.sideOf && !c.agentId ? '在旁边临时问，不打断当前任务' : c?.agentId ? '外部 Agent 暂不支持侧边聊天' : '先打开一个电脑上的主任务', ic: 'message', disabled: !c?.remote || isPhone || !!c.sideOf || !!c.agentId, onSelect: () => sideChatCmd(key, true) },
  ];
};

const folder: MenuFn = ctx => {
  const key = ctx.ckey || '';
  const c = convOfKey(key);
  const inTask = !!c?.remote;
  const current = inTask ? c?.workspace || '' : S.folder;
  // 任务当前的文件夹可能不在最近列表里，也要能看到并打勾
  const folders = current && !S.recentFolders.includes(current) ? [current, ...S.recentFolders] : S.recentFolders;
  return [
    { header: true, label: inTask ? '这个任务的工作文件夹' : '总指挥的工作文件夹' },
    ...folders.map(f => ({ label: basename(f), desc: prettyPath(f, S.homeDir), ic: 'folder', onSelect: () => void pickFolderPath(f, key), select: 'single' as const, checked: current === f })),
    '-',
    { label: '选择其他文件夹…', ic: 'plus', onSelect: () => void browseFolder(key) },
  ];
};

const QUALITY: Record<string, string> = { 自动: '默认 720 · 平衡画质与流量', 流畅: '480p · 省流量', 标准: '720p', 高清: '1080p · 消耗较多流量' };
const quality: MenuFn = () => Object.keys(QUALITY).map(q => ({ label: q, desc: QUALITY[q], onSelect: () => update(s => { s.quality = q; }), select: 'single' as const, checked: S.quality === q }));

const convMenu: MenuFn = ctx => {
  const c = conv(ctx.id);
  if (!c) return [];
  const isPhone = c.owner !== 'pc', groups = isPhone ? S.customGroups[c.owner] || [] : [];
  return [
    { label: '重命名', ic: 'edit', onSelect: () => renameConv(c.id) },
    ...(isPhone ? [{ label: c.pinned ? '取消置顶' : '置顶', ic: 'pin', onSelect: () => pinConv(c.id) }] : []),
    ...(isPhone ? [
      { header: true as const, label: '移动到分组' },
      ...groups.map(g => ({ label: g.name, ic: 'folder', onSelect: () => moveConv(c.id, g.id), select: 'single' as const, checked: S.convGroup[c.id] === g.id })),
      { label: groups.length ? '新建分组并移入…' : '新建分组…', ic: 'plus', onSelect: () => newGroup(c.id) },
      ...(S.convGroup[c.id] ? [{ label: '移出分组', ic: 'close', onSelect: () => moveConv(c.id, '') }] : []),
      '-' as const,
    ] : []),
    { label: '导出为 Markdown', ic: 'download', onSelect: () => exportConv(c.id) },
    ...(c.remote ? [{ label: '归档', ic: 'archive', onSelect: () => archiveCmd(c) }] : []),
    { label: '复制标题', ic: 'copy', onSelect: () => { void navigator.clipboard?.writeText(c.title); toast('已复制任务标题'); } },
    '-',
    { label: '删除', ic: 'trash', onSelect: () => deleteConv(c.id), danger: true },
  ];
};

const group: MenuFn = ctx => [
  { label: '重命名分组', ic: 'edit', onSelect: () => renameGroup(ctx.id ?? '') },
  { label: '删除分组', ic: 'trash', onSelect: () => deleteGroup(ctx.id ?? ''), danger: true, desc: '会话不会被删除，回到按日期分组' },
];

const sched: MenuFn = ctx => {
  const id = ctx.id ?? '';
  return [
    { label: '编辑', ic: 'edit', onSelect: () => editSched({ id }) },
    { label: '运行记录', ic: 'history', onSelect: () => schedRuns(id) },
    { label: '复制一份', ic: 'copy', onSelect: () => dupSched(id) },
    '-',
    { label: '删除', ic: 'trash', onSelect: () => deleteSched(id), danger: true },
  ];
};

const install: MenuFn = ctx => {
  const k = skill(ctx.id ?? '');
  if (!k) return [];
  const targets = k.target === 'phone' ? phones() : [agent('pc')!];
  const others = k.target === 'phone' ? [agent('pc')!] : phones();
  const item = (a: NonNullable<ReturnType<typeof agent>>) => {
    const has = (S.installed[a.id] || []).includes(k.id);
    return { label: has ? `已装到 ${a.name}` : `装到 ${a.name}`, desc: a.kind === 'phone' ? (a.status === 'offline' ? '离线 · 上线后自动安装' : personaOf(a)) : '总指挥', avatar: a, onSelect: () => installSkill(k.id, a.id), checked: has, disabled: has };
  };
  return [{ header: true, label: k.target === 'phone' ? '推荐安装到手机' : '推荐安装到电脑' }, ...targets.map(item), { header: true, label: '也可以安装到' }, ...others.map(item)];
};

const teamMenu: MenuFn = ctx => [
  { label: '重命名团队', ic: 'edit', onSelect: () => renameTeam(ctx.id ?? '') },
  { label: '管理成员', ic: 'userPlus', onSelect: () => addMember(ctx.id ?? '') },
  '-',
  { label: '解散团队', ic: 'trash', onSelect: () => deleteTeam(ctx.id ?? ''), danger: true },
];

const device: MenuFn = ctx => {
  const p = agent(ctx.id ?? '');
  if (!p) return [];
  return [
    { label: '和它对话', ic: 'message', onSelect: () => enterPhone(p.id) },
    { label: '编辑人格', ic: 'person', onSelect: () => gotoPhonePage(p.id, 'phone-soul') },
    { label: '查看实时画面', ic: 'eye', onSelect: () => watchPhone(p.id), disabled: p.status === 'offline' },
    { label: '重命名', ic: 'edit', onSelect: () => renamePhone(p.id) },
    '-',
    { label: '解除配对', ic: 'trash', onSelect: () => unpair(p.id), danger: true },
  ];
};

const SOUL_TPLS = [['美妆博主', '亲切真实的平价彩妆测评'], ['数码博主', '理性讲参数的数码测评'], ['美食探店', '本地探店与菜谱分享'], ['知识分享', '把复杂的事讲简单'], ['私域客服', '礼貌、及时、不过度承诺']];
const soulTpl: MenuFn = () => [{ header: true, label: '人格模板' }, ...SOUL_TPLS.map(([n, d]) => ({ label: n, desc: d, ic: 'person', onSelect: () => applySoulTpl(n, d) }))];

const lang: MenuFn = () => ['简体中文', 'English'].map(l => ({ label: l, onSelect: () => setPref('lang', l), select: 'single' as const, checked: S.prefs.lang === l }));
const supervise: MenuFn = () => [0, 1, 5, 10, 30, 60, 120].map(n => ({ label: n ? `每 ${n} 分钟` : '关闭', onSelect: () => setPref('supervise', n), select: 'single' as const, checked: S.prefs.supervise === n }));

const teamFolder: MenuFn = () => [
  ...S.recentFolders.map(f => ({ label: basename(f), desc: prettyPath(f, S.homeDir), ic: 'folder', onSelect: () => formSet('folder', f), select: 'single' as const, checked: S.form.folder === f })),
  '-',
  { label: '新建文件夹…', ic: 'plus', onSelect: () => formSet('folder', `${getEndpoint()?.defaultFolder || '~/Projects'}/新团队`) },
];

/* @ 提及与 / 命令（输入框内触发） */
const mention: MenuFn = ctx => {
  const key = ctx.ckey || 'home';
  if (ctx.kind === 'slash') return slashMenu(key, ctx.query || '');

  const files = (S.files?.children || []).filter(f => f.type === 'file').slice(0, 5);
  return [
    { header: true, label: '提及' },
    ...[agent('pc')!, ...phones()].map(a => ({ label: a.name, desc: personaOf(a), avatar: a, onSelect: () => insertMention(key, `@${a.name} `) })),
    ...(files.length ? [{ header: true as const, label: '文件' }, ...files.map(f => ({ label: f.name, ic: 'file', onSelect: () => insertMention(key, `@${f.name} `) }))] : []),
  ];
};

/* Agent 切换器（中栏左上角）：Lom 内置在第一位，其后是用户在「设置 → Agents」里添加的 */
const agentSwitch: MenuFn = () => {
  const c = S.route.name === 'chat' ? conv(S.activeConv) : undefined;
  const current = c ? c.agentId || '' : S.agentPick;
  return [
    { header: true, label: c ? '用其他 Agent 新建任务' : '新任务使用的 Agent' },
    { label: 'Lom', desc: '内置总指挥 · 可指挥手机', img: '/logo.png', onSelect: () => pickAgent(''), select: 'single' as const, checked: current === '' },
    ...pinnedAgents().map(a => ({
      label: a.name, desc: usable(a) ? '本机 CLI · 模型由它自己的设置决定' : '不可用，点击去测试连接', img: logoUrl(a.icon) || undefined, ic: 'cube',
      onSelect: () => pickAgent(a.id), select: 'single' as const, checked: current === a.id,
    })),
    '-',
    { label: '添加更多 Agent', ic: 'plus', onSelect: addAgents },
  ];
};

/* 外部 Agent 的模型（来自它自己的配置；在任务里切换会直接改这个会话） */
const agentModel: MenuFn = ctx => {
  const m = externalModel(ctx.ckey || 'home');
  if (!m) return [];
  const name = agentRow(m.agentId)?.name || m.conv?.agentName || 'Agent';
  const choices = m.option?.options || [];
  const pick = (value: string) => () => {
    if (!m.conv) { update(s => { s.agentModelPick[m.agentId] = value; s.menu = null; }); toast(`${name} 新任务将使用 ${choiceName(m.option, value)}`, 'cube'); return; }
    void setConvOption(m.conv, m.option?.id || 'model', value)
      .then(r => {
        const name = choiceName(m.option, value);
        if (r === 'observed') { toast(`模型已切换：${name}`, 'cube'); return; }
        if (r === 'pending_next_turn' || r === 'next_turn') { toast(`已切换，下一轮开始使用 ${name}`, 'cube'); return; }
        toast(`模型切换已提交，但无法确认是否生效：${name}`, 'info');
      }, e => toastError('切换模型失败', e));
  };
  return [
    { header: true, label: `${name} 的模型（来自它自己的配置）` },
    ...(choices.length
      ? choices.map(c => ({ label: c.name || c.value, desc: c.description, ic: 'cube', onSelect: pick(c.value), select: 'single' as const, checked: m.current === c.value }))
      : [{ label: isProbing(m.agentId) ? '正在读取模型列表…' : '还没读到模型列表', desc: '会使用它自己配置里的默认模型', ic: 'info', onSelect: () => { const a = agentRow(m.agentId); if (a) void probeAgentOptions(a); }, disabled: isProbing(m.agentId) }]),
  ];
};

/** 外部 Agent 的选项还没读到：只能提示读取中/重试，不能退回 Lom 的低/中/高。 */
function pendingExtEffort(agentId: string): MenuItem[] {
  const name = agentRow(agentId)?.name || 'Agent';
  return [{ header: true, label: `${name} 的推理强度` }, {
    label: isProbing(agentId) ? '正在读取选项…' : '没有读到选项，点击重试', disabled: isProbing(agentId), ic: 'info',
    desc: '读不到不等于不支持：会以这个 Agent 自己的设置为准', onSelect: () => { const a = agentRow(agentId); if (a) void probeAgentOptions(a); },
  }];
}

/* 推理强度：Lom 任务低 / 中 / 高（OpenAI 兼容接口）；外部 Agent 用它自己报的选项 */
const effort: MenuFn = ctx => {
  const key = ctx.ckey || 'home';
  const c = convOfKey(key);
  // 新任务页选中了外部 Agent：用该 Agent 自己报的档位（读缓存），并支持预选
  const homeAgent = !c && key === 'home' ? S.agentPick : '';
  const ext = c?.agentId ? effortOption(S.agentOptions[c.id]) : undefined;
  const homeExt = homeAgent ? effortOption(cachedOptions(homeAgent)) : undefined;
  const extOpt = ext || homeExt;
  if (extOpt) {
    const agentId = c?.agentId || homeAgent;
    const name = c?.agentName || agentRow(agentId)?.name || 'Agent';
    // 有选项 id 但没有选项列表：说明还没读完，不能断言「不支持」
    if (!extOpt.options?.length) return pendingExtEffort(agentId);
    const checked = ext ? extOpt.current_value : S.agentEffortPick[agentId] || extOpt.current_value;
    return [{ header: true, label: `${name} 的推理强度`, desc: '来自它自己的配置' },
      ...extOpt.options.map(o => ({ label: o.name || o.value, desc: o.description, ic: 'brain', select: 'single' as const, checked: checked === o.value, onSelect: () => void pickEffort(key, o.value) }))];
  }
  if (homeAgent) return pendingExtEffort(homeAgent);
  if (c?.agentId) return pendingExtEffort(c.agentId);
  if (!c && key === 'home' && !lomSupportsEffort(currentPcModel()?.providerId)) {
    return [{ header: true, label: '推理强度' }, {
      label: '当前模型没有推理强度选项', desc: '换一个支持推理强度的模型后再试', disabled: true, ic: 'info', onSelect: () => {},
    }];
  }
  const current = c ? c.effort || '' : S.effortPick;
  return [{ header: true, label: c ? '推理强度（下一轮开始生效）' : '新任务的推理强度' },
    ...EFFORTS.map(([v, label]) => ({ label, desc: v ? ({ low: '更快响应，适合简单问题', medium: '兼顾速度与思考深度', high: '深入思考，适合复杂任务', xhigh: '更深入地分析复杂问题' }[v] || '增加思考深度') : '由模型自动决定', ic: 'brain', select: 'single' as const, checked: current === v, onSelect: () => void pickEffort(key, v) }))];
};

export const MENUS: Record<string, MenuFn> = {
  installPolicy: () => [['ask', '始终询问'], ['allow', '跟随任务权限'], ['deny', '禁止命令和写入']].map(([v, label]) => ({ label, select: 'single', checked: S.prefs.allowInstall === v, onSelect: () => setPref('allowInstall', v) })),
  historyAgents: historyMenu, account, phonePick, model, attachPhones, permission, attach, folder, quality, conv: convMenu, group, sched, install,
  team: teamMenu, device, soulTpl, lang, supervise, teamFolder, mention, agentSwitch, agentModel, effort,
};
