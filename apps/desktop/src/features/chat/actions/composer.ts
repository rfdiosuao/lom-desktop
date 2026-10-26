import { resendToConversation } from '../runtime/conversationSend';
import { sendPhone, stopPhone } from '@/features/phones/runtime/phoneChat';
import { loadCommandSkills } from '../runtime/commandSkills';
import { hasUploading } from './attachments';
import { takeDraft } from './drafts';
import { enableTurtle, submitTurtle } from './turtle';
import { compactCmd, goalCmd } from './commands';
import { modelChanges } from '../runtime/taskModel';
import { pickFiles, pickFolder } from '@/core/platform';
import { api } from '@/core/client';
import { applyModeToTask, applyModelToTask, approveTask, sendToTask, startDesktopTask, stopTask } from '../runtime/tasks';
import { refreshWorkspace } from '@/features/workspace/runtime/workspace';
import { sim } from '@/demo/simulator';
import { agent, attached, conv, normalizeConvId, model, perm, team } from '@/state/selectors';
import { S, update } from '@/state/store';
import type { Attachment, Conv, DraftAttachment, Msg } from '@/state/types';
import { basename, uid } from '@/shared/lib/util';
import { go, navigate } from '@/app/navigation';
import { closeMenu, openMenu, toast, toastError } from '@/shared/overlays/controller';
import { conversationOf, convOfKey, sendToTeam } from '@/features/teams/runtime/team';
import { editSched } from '@/features/schedules/actions/schedule';
import { unavailable } from '@/shared/lib/unavailable';
import { authRevision } from '@/features/account/runtime/authScope';

/* ===== 输入框：发送、停止、附件、权限、模型、文件夹、@ 提及、添加手机 ===== */

const mk = (type: Msg['type'], o: Partial<Msg> = {}): Msg => ({ id: uid('m'), type, at: Date.now(), ...o });
export const runKeyOf = (key: string) => {
  if (key.startsWith('personal:')) return convOfKey(key)?.id || key;
  if (key.startsWith('conv:')) return key.slice(5);
  // 真实团队的窗格：停止的是这个成员对应的会话
  if (key.startsWith('team:')) { const [, tid, mid] = key.split(':'); const t = team(tid), m = t?.members.find(x => x.mid === mid); const c = t && m ? conversationOf(t, m) : undefined; if (c) return c.id; }
  return key;
};

export async function send(key: string) {
  if (modelChanges.has(runKeyOf(key))) { toast('模型正在切换，请稍后发送', 'info'); return; }
  let text = (S.drafts[key] || '').trim();
  const atts = S.attachments[key] || [];
  if (!text && !atts.length) { toast('先写点什么吧', 'info'); S.focusNext = `composer:${key}`; update(); return; }
  if (hasUploading(key)) { toast('图片还在上传，稍等一下再发送', 'info'); return; }
  if (/^\/海龟汤(?:提问卡)?(?:\s|$)/.test(text)) { enableTurtle(key); return; }
  if (/^\/(?:goal|目标)(?:\s|$)/i.test(text) && !atts.length) {
    // 设好目标后把目标正文当第一条消息发出去，Agent 立刻开始推进
    goalCmd(key, goal => { update(s => { s.drafts[key] = goal; }); void send(key); });
    return;
  }
  if (/^\/(?:compact|压缩)$/i.test(text) && !atts.length) { compactCmd(key); return; }
  if (S.turtles[key]?.active) { await submitTurtle(key, S.turtles[key].started ? text : undefined); return; }
  if (/^\/接管(?:\s|$)/.test(text)) { void superviseNow(S.phoneId, text.replace(/^\/接管\s*/, '') || '请查看手机当前界面，等待我给你操作指令。'); return; }
  /* 快捷命令 */
  if (text.startsWith('/定时')) { update(s => { s.drafts[key] = ''; }); editSched({ exec: S.mode === 'phone' ? S.phoneId : 'pc', prompt: text.replace('/定时', '').trim() }); return; }
  if (text.startsWith('/监工')) { superviseNow(S.phoneId); return; }
  if (text.startsWith('/技能')) { update(s => { s.drafts[key] = ''; }); go(S.mode === 'phone' ? 'phone-skills' : 'skillhub'); return; }

  if (S.turtles[key] && !S.turtles[key].active) text = `海龟汤提问模式已结束，请按普通助手方式处理以下新消息：\n${text}`;

  const clearDraft = () => takeDraft(key);
  if (key.startsWith('team:')) {
    const [, tid, mid] = key.split(':');
    const t = team(tid), m = t?.members.find(x => x.mid === mid);
    if (!t?.real || !m) { unavailable('示例团队的协作执行'); return; }
    const restore = clearDraft();
    try { if (!(await sendToTeam(t, m, text, atts))) restore(); }
    catch (e) { restore(); toastError('发送失败', e); }
    return;
  }
  /* 电脑任务：真实的 lom-core 会话 */
  const desktopHome = key === 'home' && S.mode === 'desktop';
  const existing = convOfKey(key);
  if (key.startsWith('personal:') && !existing?.remote) { toast('助理会话未就绪，请重新打开面板', 'info'); return; }
  if (desktopHome || existing?.remote) return sendDesktopDraft(key, text, atts, existing);
  /* 手机会话：在手机本体执行，电脑显示回执和增量内容 */
  const target = key === 'home' ? S.phoneId : existing?.owner;
  if (target && agent(target)?.real) return sendPhoneDraft(key, target, text, atts, existing);
  clearDraft();
  const user = mk('user', { text, attachments: atts.map(a => ({ name: a.name, ic: a.ic as Attachment['ic'], preview: a.preview })) });
  let c: Conv;
  if (key === 'home') {
    c = { id: uid('c'), owner: S.phoneId, title: text.replace(/\s+/g, ' ').slice(0, 18) || '新的会话', updated: Date.now(), preview: null, phones: attached('home').filter(id => id !== S.phoneId), messages: [user] };
    update(s => { s.convs.unshift(c); });
    navigate({ route: { name: 'chat' }, activeConv: c.id });
  } else {
    c = existing as Conv;
    update(() => { c.messages.push(user); c.updated = Date.now(); });
  }
  sim.phone(c, text);
}

async function sendDesktopDraft(key: string, text: string, atts: DraftAttachment[], existing?: Conv) {
  const restore = takeDraft(key);
  if (existing) { if (!await sendToTask(existing, text, atts)) restore(); return; }
  const id = await startDesktopTask(text, atts, { onSendFailure: c => restore(`conv:${c.id}`) });
  if (!id) { restore(); return; }
  navigate({ route: { name: 'chat' }, activeConv: id });
}

async function sendPhoneDraft(key: string, target: string, text: string, atts: DraftAttachment[], existing?: Conv) {
  const draft = S.drafts[key] || '';
  const sentAttachments = [...atts], current = authRevision(), account = S.account?.id;
  const c = existing || { id: uid('c'), owner: target, title: text.slice(0, 30), updated: Date.now(), messages: [] };
  if (!existing) {
    update(s => { s.convs.unshift(c); s.drafts[`conv:${c.id}`] = text; s.attachments[`conv:${c.id}`] = [...sentAttachments]; });
    navigate({ route: { name: 'chat' }, activeConv: c.id });
  }
  try {
    await sendPhone(c, text, sentAttachments);
    if (!current() || S.account?.id !== account || conv(c.id) !== c || c.owner !== target) return;
    update(s => {
      for (const k of new Set([key, `conv:${c.id}`])) {
        if (k === 'home' && s.phoneId !== target) continue;
        const attachments = s.attachments[k] || [];
        if ((s.drafts[k] || '') !== (k === key ? draft : text) || attachments.length !== sentAttachments.length || attachments.some((a, i) => a !== sentAttachments[i])) continue;
        delete s.turtles[k]; delete s.drafts[k]; delete s.attachments[k];
      }
    });
  } catch (e) { toast(`发送未确认：${e instanceof Error ? e.message : String(e)}`, 'info'); }
}

export function stopRun(id: string) {
  const c = conv(id);
  if (c?.remote) { void stopTask(id); return; }
  if (c?.phoneSession) { void stopPhone(c); return; }
  sim.stop(id);
  const list = id.startsWith('team:') ? team(id.split(':')[1])?.panes[id.split(':')[2]] : c?.messages;
  update(() => {
    list?.forEach(m => { if (m.streaming) m.streaming = false; if (m.status === 'running') m.status = 'error'; if (m.type === 'approval' && m.status === 'pending') m.status = 'denied'; });
    list?.push(mk('system', { text: '已停止示例播放，没有向真实手机发送操作。', ic: 'stop' }));
  });
  toast('示例播放已停止', 'stop');
}

/** 审批卡片：真实任务提交给 lom-core；演示会话继续模拟器脚本 */
export function approve(ctxId: string, m: Msg, ok: '0' | '1' | 'always') {
  const c = conv(normalizeConvId(ctxId));
  if (c?.remote) return approveTask(c, m, ok);
  if (!c && (!ctxId.startsWith('team:') || team(ctxId.split(':')[1])?.real !== false)) { toast('会话已失效，请重新打开后再确认', 'info'); return; }
  const list = ctxId.startsWith('team:') ? team(ctxId.split(':')[1])?.panes[ctxId.split(':')[2]] : c?.messages;
  update(s => {
    m.status = ok === '0' ? 'denied' : 'approved';
    if (ok === 'always') s.permission = 'edits';
    if (ok === '0') list?.push(mk('system', { text: '你拒绝了这条命令，总指挥会跳过这一步。', ic: 'shield' }));
  });
  if (ok === 'always') toast('之后同类命令自动允许（权限已切换为「自动编辑文件」）', 'shield');
  const next = S.pending[ctxId];
  delete S.pending[ctxId];
  next?.();
}

export async function superviseNow(phoneId: string, instruction = '请调用手机工具查看当前手机画面和界面信息，告诉我当前应用和可见状态；只检查，不操作。') {
  const p = agent(phoneId);
  if (!p?.real) { unavailable('示例手机的总指挥检查'); return; }
  if (S.cloud !== 'signed-in') { toast('请先登录后指挥手机', 'info'); return; }
  if (p.status === 'offline') { toast('手机离线，请先恢复连接', 'info'); return; }
  // 总指挥检查必须由 Lom 来做（检查继续由产品内置总指挥负责），不跟随左上角选中的外部 Agent
  const id = await startDesktopTask(instruction, [], { title: `指挥 · ${p.name}`, phones: [phoneId], agent: null });
  if (id) navigate({ route: { name: 'chat' }, mode: 'desktop', activeConv: id });
}

/* ---------- 添加手机：给任务授权可查看、可操作的手机 ---------- */
export function toggleAttachPhone(key: string, id: string) {
  const p = agent(id);
  let on = false;
  update(s => {
    if (key === 'home') {
      if (s.mode === 'phone') { const i = s.homeExtra.indexOf(id); if (i >= 0) s.homeExtra.splice(i, 1); else s.homeExtra.push(id); on = i < 0; }
      else { s.lit[id] = !s.lit[id]; on = s.lit[id]; }
      return;
    }
    const c = conv(key.slice(5));
    if (!c) return;
    const list = c.remote ? (s.convPhones[c.id] ||= []) : (c.phones ||= []);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1); else list.push(id);
    on = i < 0;
  });
  if (p) toast(on ? p.real ? `已授权当前会话查看和调度${p.name}` : `已选择${p.name}，示例手机不能实际执行` : `已从这个任务移除${p.name}`, 'phone');
}

export function attachAll(key: string, all: boolean) {
  update(s => {
    if (key === 'home') {
      if (s.mode === 'phone') s.homeExtra = all ? s.phoneOrder.filter(id => id !== s.phoneId) : [];
      else s.phoneOrder.forEach(id => { s.lit[id] = all; });
      return;
    }
    const c = conv(key.slice(5));
    if (!c) return;
    const ids = all ? s.phoneOrder.filter(id => id !== c.owner) : [];
    if (c.remote) s.convPhones[c.id] = ids; else c.phones = ids;
  });
}

export function askInspect(key: string) { const id = attached(key).find(id => agent(id)?.real) || S.phoneId; void superviseNow(id); }

export const applySuggestion = (text: string) => update(s => { s.drafts.home = text; s.focusNext = 'composer:home'; });

/* ---------- 附件 ---------- */
export const removeAttach = (key: string, i: number) => update(s => {
  const [removed] = s.attachments[key]?.splice(i, 1) || [];
  if (removed?.preview) URL.revokeObjectURL(removed.preview);
});
export async function addAttach(key: string, kind: 'file' | 'image' | 'workspace' | 'demo', demo?: { name: string; ic: string }) {
  if (kind === 'demo' && demo) { update(s => { (s.attachments[key] ||= []).push(demo); s.focusNext = `composer:${key}`; }); return; }
  const paths = await pickFiles(kind === 'image');
  if (!paths.length) return;
  update(s => {
    (s.attachments[key] ||= []).push(...paths.map(p => ({ name: basename(p), path: p, ic: kind === 'image' ? 'image' : 'file' })));
    s.focusNext = `composer:${key}`;
  });
}

/* ---------- 权限 / 模型 / 文件夹 ---------- */
export async function pickPerm(id: string, key?: string) {
  if (key?.startsWith('personal:')) { toast('个人助理当前使用每次询问权限', 'info'); return; }
  const old = S.permission;
  update(s => { s.permission = id; });
  const target = key ? convOfKey(key)?.id : S.route.name === 'chat' ? S.activeConv : undefined;
  if (target && !await applyModeToTask(target)) {
    update(s => { s.permission = old; }); return;
  }
  toast(`权限：${perm(id).name}`, perm(id).ic);
}

export async function pickModel(ctx: { model: string; agent?: string; team?: string; mid?: string; ckey?: string }) {
  // 输入框对应的会话（任务页、团队窗格）：模型切到这条会话上，不改全局选择
  const current = ctx.ckey && ctx.ckey !== 'home' ? convOfKey(ctx.ckey) : !ctx.team && (!ctx.agent || ctx.agent === 'pc') && S.route.name === 'chat' ? conv(S.activeConv) : undefined;
  if (ctx.ckey?.startsWith('personal:') && !current?.remote) { toast('助理会话未就绪，请重新打开面板', 'info'); return; }
  if (current?.personal && model(ctx.model)?.byok) { toast('个人助理只能使用Lom账号模型', 'info'); return; }
  if (current?.remote) {
    if (await applyModelToTask(current.id, ctx.model)) toast(`模型：${model(ctx.model)?.name ?? ctx.model}`, 'cube');
    return;
  }
  update(s => {
    if (ctx.team) { const m = team(ctx.team)?.members.find(x => x.mid === ctx.mid); if (m) m.model = ctx.model; }
    else if (ctx.agent === 'phones') s.phoneModel = ctx.model;
    else if (ctx.agent && ctx.agent !== 'pc') { const a = s.agents[ctx.agent]; if (a) a.model = ctx.model; }
    else s.model = ctx.model;
  });
  toast(`模型：${model(ctx.model)?.name ?? ctx.model}`, 'cube');
}

/** 选工作文件夹。打开的电脑任务（key 是 `conv:<id>`）写进该会话，核心保存成功才算换了；
 *  新任务页（没有会话）改的是新任务默认使用的文件夹。 */
export async function pickFolderPath(path: string, key = '') {
  const c = convOfKey(key);
  if (key.startsWith('personal:')) {
    const { loadAssistants } = await import('@/features/personal/runtime/catalog');
    const { linkWorkspace } = await import('@/features/personal/runtime/session');
    const a = loadAssistants().items.find(x => x.id === key.slice(9));
    try { if (!a || !c) throw new Error('助理会话未就绪'); await linkWorkspace(a, path); } catch { toast('关联文件夹失败，请检查助理连接后重试', 'info'); }
    return;
  }
  if (c?.remote) {
    try { await api('PATCH', `/api/conversations/${c.id}`, { extra: { workspace: path } }); }
    catch (e) { toastError('更换工作文件夹失败', e); return; }
    update(s => {
      c.workspace = path; s.workspaceBrowseRoot = ''; s.openFile = null;
      s.recentFolders = [path, ...s.recentFolders.filter(f => f !== path)].slice(0, 8);
    });
    // 核心只改了会话的设置：已经启动的 Agent 要重启任务后才会在新目录里工作
    toast(`这个任务的工作文件夹：${basename(path)}。已在运行的 Agent 重启任务后才会在新目录工作`, 'folder');
    void refreshWorkspace();
    return;
  }
  update(s => {
    s.folder = path; s.workspaceBrowseRoot = '';
    s.openFile = null;
    s.recentFolders = [path, ...s.recentFolders.filter(f => f !== path)].slice(0, 8);
  });
  toast(`工作文件夹：${basename(path)}`, 'folder');
  void refreshWorkspace();
}
export async function browseFolder(key = '') {
  const p = await pickFolder();
  if (p) await pickFolderPath(p, key);
}

/* ---------- @ 提及与 / 命令 ---------- */
export function insertMention(key: string, text: string) {
  update(s => {
    const v = s.drafts[key] || '';
    s.drafts[key] = text === '/清空 ' ? '' : v.replace(/[@/]$/, '') + text;
    s.focusNext = `composer:${key}`;
    s.menu = null;
  });
}

/** 输入后：打出 @ 或单独的 / 时弹出提及菜单 */
export function afterComposerInput(key: string, el: HTMLTextAreaElement) {
  const v = el.value;
  const ch = v[el.selectionStart - 1];
  const slash = /^\/([^\s]*)$/.exec(v);
  if (slash) {
    if (S.menu?.id === 'mention' && S.menu.ctx.kind === 'slash') update(s => { if (s.menu) s.menu.ctx.query = slash[1]; });
    else { openMenu('mention', el.closest('.composer') || el, { ckey: key, kind: 'slash', query: slash[1], matchWidth: 'true', key: `mention${key}` }); void loadCommandSkills(); }
  } else if (ch === '@') openMenu('mention', el, { ckey: key, kind: 'at', key: `mention${key}` });
  else if (S.menu?.id === 'mention') closeMenu();
}

/** 重新生成：把这条回复之前的最后一条用户消息再发一次 */
export async function regenerate(ctxId: string, m: Msg) {
  const c = conv(normalizeConvId(ctxId));
  if (!c?.remote) { toast('手机端接入后可重新生成', 'refresh'); return; }
  if (S.running[c.id] || modelChanges.has(c.id)) { toast('这一轮还在进行中，或正在切换模型', 'info'); return; }
  const i = c.messages.indexOf(m);
  if (i < 0) { toastError('重新生成失败', new Error('这条回复已不在当前会话里，请刷新后再试')); return; }
  const prev = [...c.messages.slice(0, i)].reverse().find(x => x.type === 'user');
  const atts = prev?.attachments || [];
  if (!prev || (!prev.text && !atts.length)) { toast('没有可以重新发送的消息', 'info'); return; }
  if (atts.some(a => !a.path)) { toast('原附件无法直接重新发送，请重新添加附件', 'info'); return; }
  try { await resendToConversation(c, prev.text || '', atts); }
  catch (e) { toastError('重新生成失败', e); }
}
