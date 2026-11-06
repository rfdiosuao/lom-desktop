import type { Msg } from '@/state/types';
const LEGACY_RULES = '进入「海龟汤提问卡」模式。由你提问，用户回答对、不对或其他补充。根据当前会话和历次回答逐步澄清用户的想法或还原事实，不要擅自编造谜底。每轮只输出一个简短、具体、可用对或不对回答的问题，不加选项、不一次问多个问题，不重复已确认的问题。用户补充或纠正时调整理解。不调用工具，不执行任务，只进行问答。除非用户要求结束，否则每次收到回答后继续下一问；信息充分时可询问是否需要总结。';
const FIRST = '\n现在提出第一问。';
const NEXT = '\n请根据这个回答继续，只问一个可以回答对或不对的问题。不要调用工具或执行任务。';
const LEGACY_FEEDBACK = '\n每完成十次回答需要阶段反馈，这是“只输出问题”规则的例外：先总结已确认内容、尚未证实的推测与待确认点，再提出一个下一问，不编造事实。';
const LEGACY_SUMMARY = '\n这次回答达到十次反馈节点。请先输出简短的阶段总结，分别说明已确认的内容、当前推测（明确标注未证实）和待确认的内容，便于用户纠正。总计控制在200字内，每部分一两句话，避免长清单。然后另起一段提出一个可用对或不对回答的下一问。使用清楚的纯文本分段。这一轮不适用此前“只输出问题”的限制。不要调用工具或执行任务，不编造事实或谜底。';
export const TURTLE_RULES = '进入「海龟汤提问卡」需求澄清模式。由你提问，用户回答对、不对或补充。目标是通过问答理解并梳理用户需求：要做什么、给谁用、达到什么结果，明确功能流程、限制、偏好、优先级和范围。平时每轮只问一个简短、具体、可用对或不对回答的问题，不重复已确认的问题，按用户纠正及时更新需求理解。不调用工具或执行任务。每完成十次回答先梳理累计需求，再提出一个确认或澄清问题。';
const FEEDBACK = '\n每完成十次回答需要需求梳理，这是平时只提问规则的例外：梳理累计用户需求，列出已确认要求和待确认事项，供用户核对或纠正，不擅自添加要求。';
const SUMMARY = '\n这次回答达到十次需求梳理节点。请根据累计对话和用户最新纠正，输出“需求梳理（阶段总结）”：当前需求理解——用户要做什么、服务谁、希望达到什么结果；已确认需求——归纳用户已明确的功能流程、限制、偏好、优先级和范围；待确认事项——列出尚未明确或有冲突的关键要求，供用户核对或纠正。只写有回答依据的内容，不要自行补出功能或技术方案，不确定的要求放入待确认事项。体现用户已否定或修正的要求，保留之前仍有效的需求，避免复述问答流水账；简明表达但不要为了200字限制丢掉已确认需求。最后另起一段，只提出一个需求确认或澄清问题。使用清楚的纯文本分段。这一轮先梳理需求，再提问，不受此前只输出问题的限制。不要调用工具或执行任务。';
const START = `${TURTLE_RULES}\n\n主题：`;
const LEGACY_START = `${LEGACY_RULES}\n\n主题：`;
const startPrefix = (text: string) => [START, LEGACY_START].find(prefix => text.startsWith(prefix));
const answerSuffix = (text: string) => [NEXT, SUMMARY, LEGACY_SUMMARY].find(suffix => text.endsWith(suffix));
const ANSWER = '海龟汤提问卡回答：';
export const turtleStartPrompt = (topic: string) => `${START}${topic || '请通过逐步提问了解我想做的事情，从确认目标开始。'}${FEEDBACK}${FIRST}`;
export const turtleAnswerPrompt = (text: string, round = 0) => `${ANSWER}${text}${round > 0 && round % 10 === 0 ? SUMMARY : NEXT}`;
export const turtleSummaryRequest = (text: string) => text.startsWith(ANSWER) && [SUMMARY, LEGACY_SUMMARY].some(suffix => text.endsWith(suffix));
/** 旧总结重试采用当前需求语义；只替换应用生成的协议，保留原始回答。 */
export function turtleRetryRequest(text: string) {
  if (text.startsWith(ANSWER) && text.endsWith(LEGACY_SUMMARY)) return turtleAnswerPrompt(text.slice(ANSWER.length, -LEGACY_SUMMARY.length), 10);
  if (text.startsWith(LEGACY_START) && text.endsWith(FIRST)) {
    const topic = text.slice(LEGACY_START.length, -FIRST.length);
    return turtleStartPrompt(topic.endsWith(LEGACY_FEEDBACK) ? topic.slice(0, -LEGACY_FEEDBACK.length) : topic);
  }
  return text;
}
/** 只数本次模式里有完整回复、且没有失败标记的回答；重试本身不累加。 */
export function turtleAnswerCount(messages: Msg[]) {
  let count = 0, answer = false, replied = false, failed = false;
  let outcome: Msg['turnOutcome'];
  const commit = () => { if (answer && replied && (outcome === 'completed' || (!outcome && !failed))) count++; };
  for (const m of messages) {
    if (m.type === 'user') {
      commit();
      if (m.text && startPrefix(m.text) && m.text.endsWith(FIRST)) count = 0;
      answer = !!m.text?.startsWith(ANSWER) && !!answerSuffix(m.text);
      outcome = m.turnOutcome;
      replied = false; failed = false;
    } else {
      if (m.type === 'assistant' && !m.streaming && m.text?.trim()) replied = true;
      if (m.type === 'system' && (m.turnOutcome === 'failed' || m.turnOutcome === 'cancelled' || /失败|已停止|错误/.test(m.text || ''))) failed = true;
    }
  }
  commit();
  return count;
}
/** 只折叠应用自己生成的固定协议文字，用户原始回答保持不变。 */
export function turtleDisplayText(text: string) {
  const prefix = startPrefix(text);
  if (prefix && text.endsWith(FIRST)) {
    const topic = text.slice(prefix.length, -FIRST.length);
    const feedback = [FEEDBACK, LEGACY_FEEDBACK].find(suffix => topic.endsWith(suffix));
    return `海龟汤提问卡 · ${feedback ? topic.slice(0, -feedback.length) : topic}`;
  }
  const suffix = answerSuffix(text);
  if (text.startsWith(ANSWER) && suffix) return text.slice(ANSWER.length, -suffix.length);
  const end = '海龟汤提问模式已结束，请按普通助手方式处理以下新消息：\n';
  if (text.startsWith(end)) return text.slice(end.length);
  return text;
}
