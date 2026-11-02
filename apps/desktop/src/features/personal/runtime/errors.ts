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
  if (text === '助理名称须为1至40个字符' || text === '请选择有效的助理形象') return text;
  if (error instanceof DOMException && ['QuotaExceededError', 'SecurityError'].includes(error.name)) return '无法保存本机助理配置，请检查应用存储是否已满或被禁用。';
  if (/配置损坏/.test(text)) return '助理配置损坏，请先恢复备份。';
  if (/已被修改/.test(text)) return '文档已被其他程序修改，请重新读取后再保存。';
  if (/尚未确认|创建结果/.test(text)) return '创建结果尚未确认，为避免重复创建，请先核对任务记录。';
  // 模型错误常带“Lom账号模型”字样，先判模型，避免被账号规则误报成需要重新登录。
  if (/模型/.test(text)) return 'Lom账号模型尚未就绪，请同步模型后重试。';
  if (/账号|登录/.test(text)) return '账号状态已变化，请登录后重新打开助理。';
  return '操作未完成，原因尚未识别；请记录触发步骤后重试。';
}
