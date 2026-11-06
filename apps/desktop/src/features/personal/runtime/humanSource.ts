/** 哪些消息来源才算用户本人提出。定时任务、其他助理和本机回执都不算。 */
export const isHumanSource = (source?: string) => !source || source === 'feishu' || source === 'wechat';
