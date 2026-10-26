import type { Agent, Conv, Msg, Schedule, Skill, Team } from '@/state/types';
import { uid } from '@/shared/lib/util';

/* ===== 演示数据 =====
 * 手机端（lom-agent）与中转服务接入之前，手机、手机会话、团队、定时任务、技能市场使用这里的演示数据，
 * 界面上会标注「演示」。电脑任务、模型服务、工作文件夹全部来自 lom-core，不在这里。 */

const H = 3600e3, D = 24 * H, T0 = Date.now();
const msg = (type: Msg['type'], o: Partial<Msg> = {}): Msg => ({ id: uid('m'), type, at: T0, ...o });

export const demoAgents = (): Record<string, Agent> => ({
  pc: { id: 'pc', kind: 'computer', name: '电脑主控', persona: '总指挥 · 大模型', status: 'online' },
  p1: { id: 'p1', kind: 'phone', name: '手机一号', persona: '美妆博主', status: 'online', network: 'Wi-Fi', battery: 82, model: 'lom-mini', device: 'iPhone 15 · Android 14 兼容层', lastSeen: T0 },
  p2: { id: 'p2', kind: 'phone', name: '手机二号', persona: '数码博主', status: 'online', network: '4G', battery: 57, model: 'lom-mini', device: 'Xiaomi 14 · Android 15', lastSeen: T0 },
  p3: { id: 'p3', kind: 'phone', name: '手机三号', persona: '', status: 'offline', network: '—', battery: 0, model: 'lom-mini', device: 'OPPO Reno 12 · Android 14', lastSeen: T0 - 2 * H },
});

export const demoPhoneConvs = (): Conv[] => [
  { id: 's1', owner: 'p1', title: '账号定位与内容规划', pinned: true, updated: T0 - 3 * D, messages: [msg('user', { text: '帮我梳理一下美妆账号的定位' }), msg('assistant', { agent: 'p1', text: '定位建议：**25-30 岁通勤女性的平价彩妆测评**，每周 3 更，口红与底妆为主。' })] },
  { id: 's2', owner: 'p1', title: '本周选题清单', pinned: true, updated: T0 - 2 * D, messages: [msg('user', { text: '列出本周选题' }), msg('assistant', { agent: 'p1', text: '- 秋冬口红色号测评\n- 早晚护肤流程\n- 平价化妆刷推荐' })] },
  { id: 's3', owner: 'p1', title: '秋季口红测评脚本', updated: T0 - 1 * H, messages: [
    msg('user', { text: '写一个秋季口红测评的短视频脚本，然后存到草稿箱。' }),
    msg('tool', { tool: '打开应用', detail: '小红书', status: 'done' }),
    msg('tool', { tool: '点击', detail: '底部「+」→ 写文字', status: 'done' }),
    msg('assistant', { agent: 'p1', text: '脚本已写好并存进小红书草稿箱：\n\n- 0-3 秒：「秋冬必入，这支口红太绝了！」\n- 3-20 秒：三支色号上嘴对比\n- 20-30 秒：总结 + 引导评论' }),
  ] },
  { id: 's4', owner: 'p1', title: '评论区互动回复', updated: T0 - 2 * H, messages: [msg('user', { text: '回复最新笔记下的评论' }), msg('assistant', { agent: 'p1', text: '已回复 12 条评论，其中 2 条询问色号的已私信详细信息。' })] },
  { id: 's5', owner: 'p1', title: '护肤好物分享', updated: T0 - 26 * H, messages: [msg('user', { text: '整理护肤好物清单' }), msg('assistant', { agent: 'p1', text: '清单已整理，共 8 件，按早晚分组。' })] },
  { id: 's6', owner: 'p2', title: '数码账号定位', pinned: true, updated: T0 - 4 * D, messages: [msg('user', { text: '数码账号该怎么定位？' }), msg('assistant', { agent: 'p2', text: '建议聚焦 **学生党平价数码**，测评 + 选购指南。' })] },
  { id: 's7', owner: 'p2', title: '手机新品体验', updated: T0 - 3 * H, messages: [msg('user', { text: '整理新品发布会要点' }), msg('assistant', { agent: 'p2', text: '要点已整理成 5 条图文。' })] },
  { id: 's8', owner: 'p2', title: '耳机选购指南', updated: T0 - 30 * H, messages: [msg('user', { text: '写一篇耳机选购指南' }), msg('assistant', { agent: 'p2', text: '初稿已完成，共 1200 字。' })] },
];

export const demoSchedules = (): Schedule[] => [
  { id: 'sc1', name: '每日选题灵感', exec: 'pc', prompt: '每天早上整理 3 个小红书美妆选题，写进 选题.md', freq: 'daily', time: '09:00', days: [], every: 60, runIn: 'new', enabled: true, last: T0 - 5 * H, runs: [{ at: T0 - 5 * H, ok: true }, { at: T0 - 29 * H, ok: true }, { at: T0 - 53 * H, ok: true }] },
  { id: 'sc2', name: '评论区巡检', exec: 'p1', prompt: '检查最近 3 篇笔记的新评论，礼貌回复，涉及价格的私信说明', freq: 'interval', time: '', days: [], every: 120, runIn: 'same', enabled: true, last: T0 - 1 * H, runs: [{ at: T0 - 1 * H, ok: false, note: '小红书弹出更新提示，卡在弹窗页' }, { at: T0 - 3 * H, ok: true }] },
  { id: 'sc3', name: '监工：手机一号', exec: 'pc', prompt: '查看手机一号的实时画面和执行状态，发现卡住就接管处理再交还', freq: 'interval', time: '', days: [], every: 30, runIn: 'same', enabled: true, auto: true, last: T0 - 0.3 * H, runs: [{ at: T0 - 0.3 * H, ok: true }] },
  { id: 'sc4', name: '每周数据周报', exec: 'pc', prompt: '汇总三台手机本周的发布与互动数据，生成周报.md', freq: 'weekly', time: '18:00', days: [5], every: 60, runIn: 'new', enabled: false, last: null, runs: [] },
  { id: 'sc5', name: '数码新品早报', exec: 'p2', prompt: '每天 8 点搜集数码新品资讯，整理成一条笔记草稿', freq: 'daily', time: '08:00', days: [], every: 60, runIn: 'new', enabled: true, last: T0 - 6 * H, runs: [{ at: T0 - 6 * H, ok: true }] },
];

export const demoSkills = (): Skill[] => [
  { id: 'sk-xhs', name: '小红书发布', author: 'Lom 官方', cat: 'publish', target: 'phone', color: '#e5484d', ic: 'upload', installs: '2.1万', rating: 4.9, desc: '把图文或视频按模板发布到小红书，自动添加话题与地点，发布前可要求确认。' },
  { id: 'sk-dy', name: '抖音发布', author: 'Lom 官方', cat: 'publish', target: 'phone', color: '#151b19', ic: 'play', installs: '1.4万', rating: 4.7, desc: '上传短视频、填写标题与封面，支持定时发布。' },
  { id: 'sk-comment', name: '评论区互动', author: 'Lom 官方', cat: 'growth', target: 'phone', color: '#d97706', ic: 'message', installs: '1.8万', rating: 4.8, desc: '找到相关帖子，按人格风格写评论；所有评论先进草稿，你确认后才发送。' },
  { id: 'sk-reply', name: '私信回复草稿', author: '社区 · 阿木', cat: 'growth', target: 'phone', color: '#2563eb', ic: 'at', installs: '6,320', rating: 4.5, desc: '读取新私信并生成回复草稿，带价格或联系方式的消息会标记提醒。' },
  { id: 'sk-collect', name: '列表采集', author: 'Lom 官方', cat: 'data', target: 'phone', color: '#0d9488', ic: 'database', installs: '9,870', rating: 4.6, desc: '把页面上的笔记、商品或评论列表整理成表格，存到电脑的工作文件夹。' },
  { id: 'sk-feishu', name: '飞书多维表格同步', author: 'Lom 官方', cat: 'office', target: 'pc', color: '#3370ff', ic: 'grid', installs: '7,450', rating: 4.6, desc: '把线索、选题或数据同步到飞书多维表格，支持增量更新。' },
  { id: 'sk-cover', name: '封面图生成', author: 'Lom 官方', cat: 'create', target: 'pc', color: '#9333ea', ic: 'image', installs: '2.6万', rating: 4.8, desc: '根据标题生成 3:4 封面图，自动套用你的品牌色。' },
  { id: 'sk-video', name: '短视频脚本与粗剪', author: '社区 · 小鹿', cat: 'create', target: 'pc', color: '#db2777', ic: 'camera', installs: '8,210', rating: 4.4, desc: '先写分镜脚本，再用素材文件夹里的片段粗剪成片。' },
  { id: 'sk-topic', name: '选题雷达', author: 'Lom 官方', cat: 'create', target: 'pc', color: '#087d31', ic: 'sparkles', installs: '1.1万', rating: 4.7, desc: '每天汇总热点与同类账号爆款，给出可直接执行的选题。' },
  { id: 'sk-leads', name: '线索整理', author: 'Lom 官方', cat: 'growth', target: 'pc', color: '#ea580c', ic: 'tag', installs: '5,040', rating: 4.5, desc: '把评论和私信里的潜在客户整理成线索池，标注意向等级。' },
];

export const demoTeams = (): Team[] => [{
  id: 't1', name: '小红书内容工厂', folder: '~/Projects/小红书内容工厂', created: T0 - 2 * D,
  members: [{ mid: 'm1', agent: 'pc', role: '总编', leader: true }, { mid: 'm2', agent: 'p1', role: '美妆运营' }, { mid: 'm3', agent: 'p2', role: '数码运营' }, { mid: 'm4', agent: 'pc', role: '视觉设计' }],
  panes: {
    m1: [msg('user', { text: '这周做一个「秋冬换季」主题，美妆和数码各出一篇。' }), msg('assistant', { agent: 'pc', text: '收到，分工如下：\n\n- @视觉设计 做两张统一风格的封面\n- @美妆运营 写秋冬口红测评，晚上 8 点发布\n- @数码运营 写换季数码好物，明天中午发布\n\n完成后都回到这里汇报。' })],
    m2: [msg('assistant', { agent: 'p1', text: '已领取任务：秋冬口红测评。草稿写好后等封面。' }), msg('tool', { tool: '打开应用', detail: '小红书 · 草稿箱', status: 'done' })],
    m3: [msg('assistant', { agent: 'p2', text: '已领取任务：换季数码好物。正在整理 5 件单品。' })],
    m4: [msg('assistant', { agent: 'pc', text: '两张封面已生成：`封面-美妆.png`、`封面-数码.png`，已放进团队文件夹。' }), msg('files', { changes: [{ path: '封面-美妆.png', add: 1, del: 0 }, { path: '封面-数码.png', add: 1, del: 0 }] })],
  },
}];

export const demoPhoneData = () => ({
  installed: { pc: ['sk-cover', 'sk-topic'], p1: ['sk-xhs', 'sk-comment'], p2: ['sk-collect', 'sk-dy'], p3: [] } as Record<string, string[]>,
  mySkills: [{ id: 'my1', name: '口红测评模板', status: '已上架', installs: 36, updated: T0 - 5 * D }, { id: 'my2', name: '数码开箱流程', status: '审核中', installs: 0, updated: T0 - 1 * D }],
  subagents: {
    p1: [{ id: 'sa1', name: '选题助手', duty: '根据热点和账号定位给出选题', model: 'lom-mini', enabled: true }, { id: 'sa2', name: '评论回复员', duty: '按人格语气回复评论，敏感内容先问我', model: 'lom-mini', enabled: true }],
    p2: [{ id: 'sa3', name: '参数核对员', duty: '核对数码产品参数，避免写错', model: 'lom-mini', enabled: true }], p3: [],
  } as Record<string, { id: string; name: string; duty: string; model: string; enabled: boolean }[]>,
  souls: {
    p1: '# 手机一号 · 美妆博主\n\n## 身份\n- 名字：小鹿\n- 25 岁，通勤上班族，热爱平价彩妆\n\n## 说话风格\n- 亲切、真实、不夸大\n- 常用语：「姐妹们」「真的会回购」\n\n## 负责\n- 小红书账号「美妆日记」的日常运营\n- 每周 3 篇测评，评论区每天巡检\n\n## 底线\n- 不承诺功效，不贬低其他品牌\n- 涉及价格与合作，先问主人',
    p2: '# 手机二号 · 数码博主\n\n## 身份\n- 名字：阿杰\n- 学生党，喜欢研究平价数码\n\n## 说话风格\n- 理性、讲参数、给结论\n\n## 负责\n- 小红书与抖音的数码测评',
    p3: '',
  } as Record<string, string>,
  memories: {
    p1: [{ id: 'me1', text: '主人喜欢口红色号用「豆沙、枫叶、焦糖」这类秋冬描述。', src: '对话', at: T0 - 2 * D }, { id: 'me2', text: '账号「美妆日记」的发布时间固定在晚上 8 点。', src: '手动', at: T0 - 6 * D }, { id: 'me3', text: '评论里问链接的统一回复「主页有合集」，不发外链。', src: '对话', at: T0 - 1 * D }],
    p2: [{ id: 'me4', text: '数码测评必须写清楚价格区间。', src: '手动', at: T0 - 3 * D }], p3: [],
  } as Record<string, { id: string; text: string; src: string; at: number }[]>,
  authorizedPCs: {
    p1: [{ id: 'i1', name: '这台电脑', current: true, at: T0 - 12 * D }, { id: 'i2', name: '办公室 Windows', at: T0 - 3 * D }],
    p2: [{ id: 'i1', name: '这台电脑', current: true, at: T0 - 8 * D }],
    p3: [{ id: 'i1', name: '这台电脑', current: true, at: T0 - 20 * D }],
  } as Record<string, { id: string; name: string; current?: boolean; at: number }[]>,
});

/** 只在演示数据里出现的 Lom 云端模型（云端额度上线前不可选） */
export const LOM_MODELS = [
  { id: 'lom-pro', name: 'Lom Pro', desc: '总指挥默认 · 推理与创作', cost: 'Lom 云端额度 · 即将开放' },
  { id: 'lom-max', name: 'Lom Max', desc: '最强 · 适合复杂长任务', cost: 'Lom 云端额度 · 即将开放' },
  { id: 'lom-mini', name: 'Lom Mini', desc: '手机默认 · 快速省额度', cost: 'Lom 云端额度 · 即将开放' },
];
