import { t } from '@/shared/i18n/index';

/* ===== 默认输入框轮播的内置提示语（CW04）=====
 * 只给默认的 Lom 输入框使用；手机、外部 Agent、已选手机、团队等有专用提示的输入框只播放自己那一句。
 * 第一句永远是当前输入框真实的输入提示，后面五类交错出现，相邻两句不会是同一类（五类条数必须相同，测试会检查）。
 * 中文句子在英文界面里走 `t()`（en.ts 里必须有译文，测试会检查）；英文句子原样显示。
 * 「技巧」里点名的功能都是真实存在的入口（@ 提及、/ 快捷命令里的目标/记忆/定时任务、粘贴/拖入附件、「+」里的海龟汤），改功能时同步改这里。 */

/** 可以直接这样说 */
const PROMPTS = [
  '帮我整理今天的待办事项…',
  '帮我分析文件并总结重点…',
  '帮我把这些想法整理成一份清晰的方案…',
  '帮我写一份本周的工作周报…',
  '把这个文件夹里的文件按类型整理好…',
  '帮我把这份文档精简成一页要点…',
  '帮我想几个有意思的标题或名字…',
  '帮我看看这段代码哪里可以更简洁…',
];

/** 使用技巧 */
const TIPS = [
  '输入 @ 提及手机，让它去干活…',
  '输入 / 打开快捷命令：目标、记忆、定时任务…',
  'Shift + Enter 换行，Enter 发送…',
  '直接粘贴截图或拖入文件，就是附件…',
  '不确定要什么？在「+」里打开海龟汤，只回答对或不对…',
  '先说清楚“做到什么算完成”，结果会更准…',
  '任务跑起来后，可以在旁边开侧边聊天问进度…',
  '重要的事，先让 Lom 给出计划，再动手…',
];

/** 一人公司（OPC） */
const OPC = [
  '一个人，也可以是一整家公司。',
  '你定方向，让 AI 团队去执行。',
  '组一个 OPC 团队，让 Leader 帮你分工…',
  '把重复的事交给 Agent，把时间留给判断。',
  '电脑和手机，都是一人公司的员工。',
  '一家公司，从你的一句话开始。',
  '没有会议，没有等待，只有交付。',
  '一人公司，也可以有一支像样的团队。',
];

/** 鼓励的话 */
const BOOST = [
  '今天，先完成一件小事。',
  '慢慢来，比较快。',
  '把想法说出来，就已经开始了。',
  '完成，比完美更重要。',
  '每一次尝试，都离答案更近一步。',
  '好的开始，就是现在。',
  '别等准备好，边做边变好。',
  '一步一步，路就走出来了。',
];

/** 英文励志与小技巧（原样显示，不翻译） */
const ENGLISH = [
  'Start small. Ship today.',
  'One person. A whole team of agents.',
  'What will you build today?',
  'Done is better than perfect.',
  'Be the CEO. Let the agents do the rest.',
  'Tip: describe the outcome, not the steps.',
  'Small steps, every day.',
  'Stay curious. Keep shipping.',
];

/** 供测试核对：每一类的原文 */
export const HINT_GROUPS = { PROMPTS, TIPS, OPC, BOOST, ENGLISH };

/** 默认输入框的轮播内容：`first` 是当前输入框真实的提示，其后五类依次交错，去重后返回。 */
export function composerHints(first: string): string[] {
  const groups = [PROMPTS, TIPS, BOOST, OPC, ENGLISH];
  const rows = [first];
  for (let i = 0; groups.some(g => i < g.length); i++) for (const g of groups) if (i < g.length) rows.push(t(g[i]));
  return [...new Set(rows)];
}
