import { agent, model } from '@/state/selectors';
import { S, update } from '@/state/store';
import type { Agent, Conv, Msg, Team } from '@/state/types';
import { uid } from '@/shared/lib/util';

/* ===== 演示模拟器 =====
 * 手机端（lom-agent）和中转服务接入之前，手机会话、团队协作、监工用逐步脚本演示，不执行任何真实操作。
 * 电脑任务不经过这里，直接由 lom-core 执行。 */

type Step = { do?: (list: Msg[]) => void | 'wait' | { stream: Msg; full: string }; delay?: number };

const mk = (type: Msg['type'], o: Partial<Msg> = {}): Msg => ({ id: uid('m'), type, at: Date.now(), ...o, ...(o.text ? { text: `【演示，未实际执行】${o.text}` } : {}), ...(o.tool ? { tool: `演示 · ${o.tool}` } : {}) });
const timers: Record<string, number> = {};
const streams: Record<string, number> = {};

function run(runKey: string, getList: () => Msg[], steps: Step[], onDone?: () => void) {
  update(s => { getList().push(mk('system', { text: '以下是示例流程，不会操作真实手机、发布内容或生成文件。' })); s.running[runKey] = true; });
  let i = 0;
  const next = () => {
    if (!S.running[runKey]) return;
    if (i >= steps.length) { update(s => { delete s.running[runKey]; }); onDone?.(); return; }
    const st = steps[i++];
    timers[runKey] = window.setTimeout(() => {
      if (!S.running[runKey]) return;
      const out: { r?: ReturnType<NonNullable<Step['do']>> } = {};
      update(() => { out.r = st.do ? st.do(getList()) : undefined; });
      const r = out.r;
      if (r === 'wait') { S.pending[runKey] = next; return; }
      if (r && typeof r === 'object') { stream(runKey, r.stream, r.full, next); return; }
      next();
    }, st.delay ?? 650);
  };
  next();
}

function stream(runKey: string, m: Msg, full: string, done: () => void) {
  full = `【演示，未实际执行】${full}`;
  let pos = 0;
  update(() => { m.text = ''; m.streaming = true; });
  streams[runKey] = window.setInterval(() => {
    pos = Math.min(full.length, pos + 5);
    update(() => { m.text = full.slice(0, pos); });
    if (pos >= full.length) { window.clearInterval(streams[runKey]); update(() => { m.streaming = false; }); done(); }
  }, 35);
}

function stop(runKey: string) {
  window.clearTimeout(timers[runKey]);
  window.clearInterval(streams[runKey]);
  update(s => { delete s.running[runKey]; delete s.pending[runKey]; s.takeover = null; });
}

/* 步骤积木 */
const step = (fn: Step['do'], delay?: number): Step => ({ do: fn, delay });
const say = (agentId: string, text: string, delay = 500, role?: string) => step(list => { const m = mk('assistant', { agent: agentId, role }); list.push(m); return { stream: m, full: text }; }, delay);
const sys = (text: string, ic = 'info', delay = 300) => step(list => { list.push(mk('system', { text, ic: ic as Msg['ic'] })); }, delay);
const tool = (name: string, detail: string, output = '', dur = 900): Step[] => {
  let m: Msg | undefined;
  return [step(list => { m = mk('tool', { tool: name, detail, output, status: 'running' }); list.push(m); }, 400), step(() => { if (m) m.status = 'done'; }, dur)];
};

/* ---------- 交接：手机求助 → 总指挥接管 → 交还 ---------- */
function handoff(p: Agent, note: string, o: { screen?: string; ui?: string; click?: string } = {}): Step[] {
  const { screen = '发布页界面元素结构', ui = '按钮：#话题（坐标 0.18, 0.62）\n输入框：标题、正文\n按钮：发布笔记', click = '「#话题」' } = o;
  let h: Msg | undefined;
  return [
    step(list => { h = mk('handoff', { phone: p.id, stage: 'help', note }); list.push(h); S.phoneId = p.id; if (!S.layout.rightCollapsed) S.wsTab = 'phone'; }, 700),
    step(() => { if (h) h.stage = 'takeover'; S.takeover = p.id; }, 1100),
    ...tool('读取界面', `${p.name} · ${screen}`, ui, 800),
    ...tool('点击', `${p.name} · ${click}（无障碍远程操作）`, '', 900),
    step(() => { if (h) { h.stage = 'returned'; h.note = `${note} 总指挥已处理完并交还。`; } S.takeover = null; }, 900),
  ];
}

/* ---------- 手机 Agent ---------- */
function phone(c: Conv, prompt: string) {
  const p = agent(c.owner);
  if (!p) return;
  if (p.status === 'offline') { update(() => { c.messages.push(mk('system', { text: `${p.name}是离线示例，未排队，也不会自动执行。`, ic: 'wifiOff' })); }); return; }
  const publish = /发布|发一|话题|上传/.test(prompt);
  const steps: Step[] = [
    step(() => { if (!S.layout.rightCollapsed) S.wsTab = 'phone'; }, 200),
    ...tool('打开应用', '小红书', '', 800),
    ...tool('读取界面', '首页 · 识别到 12 个可点击元素', '', 700),
    ...tool('点击', publish ? '底部「+」→ 选择相册图片' : '「消息」→ 评论和@', '', 800),
  ];
  if (publish) steps.push(...handoff(p, `${p.name}（${model(p.model || S.phoneModel)?.name ?? '手机模型'}）找不到「添加话题」入口，向总指挥求助。`));
  steps.push(say(p.id, publish ? '笔记已发布 ✅\n\n- 标题：秋冬必入，这支口红太绝了！\n- 已添加话题 #秋冬口红 #平价彩妆\n- 发布时间：刚刚' : '已处理完：\n\n- 回复了 8 条新评论\n- 2 条询问价格的已标记，等你确认后再私信', 400));
  run(c.id, () => c.messages, steps, () => { c.updated = Date.now(); });
}

/* ---------- 监工：总指挥检查手机 ---------- */
function supervise(c: Conv, p: Agent) {
  run(c.id, () => c.messages, [
    ...tool('截图', `${p.name} · 当前画面`, '', 700),
    ...tool('读取界面', `${p.name} · 小红书 · 我的主页`, '', 700),
    say('pc', `${p.name} 运行正常：正在「我的主页」，最近一次任务已完成，没有卡住的步骤。下次检查在 ${S.prefs.supervise} 分钟后。`, 300),
  ]);
}

/* ---------- OPC 团队 ---------- */
function teamRun(t: Team, mid: string, prompt: string) {
  const me = t.members.find(m => m.mid === mid);
  const a = me && agent(me.agent);
  if (!me || !a) return;
  const key = `team:${t.id}:${mid}`;
  const pane = (x: string) => (t.panes[x] ||= []);
  if (!me.leader) {
    run(key, () => pane(mid), [...(a.kind === 'phone' ? tool('打开应用', '小红书 · 草稿箱', '', 700) : tool('读取文件', t.folder, '', 600)), say(a.id, `收到，「${prompt.slice(0, 20)}」已完成，结果放在团队文件夹，并同步给 Leader。`, 300, me.role)]);
    return;
  }
  const others = t.members.filter(m => !m.leader);
  const plan = others.map(m => `- @${m.role}：${agent(m.agent)?.kind === 'phone' ? '在手机上执行并发布' : '在电脑上产出素材'}`).join('\n');
  run(key, () => pane(mid), [
    step(list => { list.push(mk('thinking', { text: `目标：${prompt}。按成员能力拆分任务。` })); }, 400),
    say(a.id, `目标收到，分工如下：\n\n${plan}\n\n完成后回到这里汇报。`, 300, me.role),
  ], () => {
    let done = 0;
    others.forEach((m, i) => {
      const ma = agent(m.agent);
      if (!ma) return;
      const k = `team:${t.id}:${m.mid}`;
      update(() => { pane(m.mid).push(mk('system', { text: `来自 Leader 的任务：${prompt.slice(0, 30)}`, ic: 'crown' })); });
      const offline = ma.kind === 'phone' && ma.status === 'offline';
      window.setTimeout(() => run(k, () => pane(m.mid), [
        ...(ma.kind === 'phone' ? (offline ? [sys(`${ma.name}离线，任务已排队`, 'wifiOff')] : [...tool('打开应用', '小红书', '', 700), ...tool('输入', '标题与正文', '', 700)]) : tool('写入文件', '封面.png', '', 800)),
        say(ma.id, offline ? '（上线后执行）' : `我负责的部分已完成：${ma.kind === 'phone' ? '笔记草稿已就绪，等 Leader 确认发布' : '素材已放进团队文件夹'}。`, 300, m.role),
      ], () => {
        if (++done === others.length) run(key, () => pane(mid), [say(a.id, `全部成员已汇报 ✅\n\n${others.map(o => `- ${o.role}：已完成`).join('\n')}\n\n需要我统一检查后再发布吗？`, 600, me.role)]);
      }), 500 + i * 700);
    });
  });
}

export const sim = { run, stop, handoff, phone, supervise, team: teamRun };
