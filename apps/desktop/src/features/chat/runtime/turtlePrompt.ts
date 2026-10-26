export const TURTLE_RULES = '进入「海龟汤提问卡」模式。由你提问，用户回答对、不对或其他补充。根据当前会话和历次回答逐步澄清用户的想法或还原事实，不要擅自编造谜底。每轮只输出一个简短、具体、可用对或不对回答的问题，不加选项、不一次问多个问题，不重复已确认的问题。用户补充或纠正时调整理解。不调用工具，不执行任务，只进行问答。除非用户要求结束，否则每次收到回答后继续下一问；信息充分时可询问是否需要总结。';
const FIRST = '\n现在提出第一问。';
const NEXT = '\n请根据这个回答继续，只问一个可以回答对或不对的问题。不要调用工具或执行任务。';
const START = `${TURTLE_RULES}\n\n主题：`;
const ANSWER = '海龟汤提问卡回答：';
export const turtleStartPrompt = (topic: string) => `${START}${topic || '请通过逐步提问了解我想做的事情，从确认目标开始。'}${FIRST}`;
export const turtleAnswerPrompt = (text: string) => `${ANSWER}${text}${NEXT}`;
/** 只折叠应用自己生成的固定协议文字，用户原始回答保持不变。 */
export function turtleDisplayText(text: string) {
  if (text.startsWith(START) && text.endsWith(FIRST)) return `海龟汤提问卡 · ${text.slice(START.length, -FIRST.length)}`;
  if (text.startsWith(ANSWER) && text.endsWith(NEXT)) return text.slice(ANSWER.length, -NEXT.length);
  const end = '海龟汤提问模式已结束，请按普通助手方式处理以下新消息：\n';
  if (text.startsWith(end)) return text.slice(end.length);
  return text;
}
