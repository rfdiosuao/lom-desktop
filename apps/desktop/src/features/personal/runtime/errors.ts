import { CoreError } from '@/core/client';

// UI-AUDIT-03：核心客户端生成的固定错误码，原因已知，不再落到「原因尚未识别」
const coreErrors: Record<string, string> = {
  LOM_CORE_NOT_READY: 'Lom 核心服务还没有启动，请稍候再试。',
  LOM_CORE_UNREACHABLE: '无法连接 Lom 核心服务，请等核心恢复连接后重试。',
  LOM_CORE_CANCELLED: '请求超时或已取消，结果尚未确认；请重新同步后再试。',
  LOM_CORE_BAD_RESPONSE: 'Lom 核心服务返回了无法识别的内容，请重启 Lom 后重试。',
};
const nativeErrors: Record<string, string> = {
  'personal.data_dir': '无法访问 Lom 的应用数据目录，请检查本机应用数据目录是否可用。',
  'personal.mkdir': '无法创建助理目录，请检查本机磁盘空间和应用数据目录的写入权限。',
  'personal.template_create': '无法创建助理默认文档，请检查磁盘空间和目录写入权限。',
  'personal.template_write': '助理默认文档写入失败，请检查磁盘空间和目录写入权限。',
  'personal.unsafe_path': '助理目录存在不安全的链接或非目录文件，已停止创建，请检查目录冲突。',
  'personal.invalid_identity': '助理身份参数无效，请重新打开个人助理后重试。',
};
export function personalError(error: unknown) {
  // Tauri Result<String, String> rejects with a string, not an Error instance.
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (Object.hasOwn(nativeErrors, text)) return `${nativeErrors[text]}（${text}）`;
  if (error instanceof CoreError && Object.hasOwn(coreErrors, error.code)) return coreErrors[error.code];
  if (text === '助理名称须为1至40个字符' || text === '请选择有效的助理形象') return text;
  if (error instanceof DOMException && ['QuotaExceededError', 'SecurityError'].includes(error.name)) return '无法保存本机助理配置，请检查应用存储是否已满或被禁用。';
  if (/本机存储.*助理配置未保存/.test(text)) return '无法保存本机助理配置，请检查应用存储是否已满或被禁用。';
  if (/配置损坏/.test(text)) return '助理配置损坏，请先恢复备份。';
  if (/已被修改/.test(text)) return '文档已被其他程序修改，请重新读取后再保存。';
  if (/尚未确认|创建结果/.test(text)) return '创建结果尚未确认，为避免重复创建，请先核对任务记录。';
  // 模型错误常带“Lom账号模型”字样，先判模型，避免被账号规则误报成需要重新登录。
  if (/模型/.test(text)) return 'Lom账号模型尚未就绪，请同步模型后重试。';
  // 「会话尚未就绪或账号已切换」也带“账号”字样，须先于账号规则识别，提示里说明两种原因。
  if (/会话尚未就绪/.test(text)) return '会话还没有打开或账号已切换，请重新打开助理后再试。';
  if (/账号|登录/.test(text)) return '账号状态已变化，请登录后重新打开助理。';
  // 打开会话和操作定时任务都会检查归属，不只出现在打开时。
  if (/归属不一致/.test(text)) return '助理会话归属不一致，已停止操作；请重新同步任务后再试。';
  if (/核心未确认目录关联/.test(text)) return '核心没有确认目录关联，原工作文件夹保持不变。';
  if (/文档过长/.test(text)) return '文档过长，请拆成较短的内容后再保存。';
  if (/不允许的文档路径/.test(text)) return '不允许读取这个文档路径。';
  if (error instanceof CoreError && error.status && error.status >= 500) return 'Lom 核心服务暂时无法处理，请稍后重试。';
  return '出现未识别的错误，请重试；仍失败时请反馈操作步骤。';
}
