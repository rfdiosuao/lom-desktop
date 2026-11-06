/** 把文本里的密钥、令牌隐藏掉。规则最初用于飞书审批摘要，现在供所有会外传或展示原始诊断的地方共用。 */
export const redactSecrets = (s: string) => s
  .replace(/(?:sk-|oc_sk_)[A-Za-z0-9_-]+/g, '[已隐藏密钥]')
  .replace(/((?:Bearer|Basic)\s+)\S+/gi, '$1[已隐藏]')
  .replace(/(["']?[\w-]*(?:api[_-]?key|access[_-]?token|password|secret|device[_-]?code)[\w-]*["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[已隐藏]')
  .replace(/([?&](?:code|token|key|secret)=)[^&\s]+/gi, '$1[已隐藏]');

/** 路径里的系统用户名属于个人信息：只隐藏用户名那一段，其余路径照常可读，方便排查。 */
const redactUserNames = (s: string) => s
  .replace(/(\/Users\/)[^/\s"'`]+/g, '$1[用户]')
  .replace(/(\/home\/)[^/\s"'`]+/g, '$1[用户]')
  .replace(/([A-Za-z]:\\{1,2}Users\\{1,2})[^\\"'`\r\n]+/g, '$1[用户]');

/** 复制或展示原始诊断前使用：隐藏密钥令牌，也隐藏路径里的用户名。 */
export const redactDiagnostic = (s: string) => redactUserNames(redactSecrets(s));
