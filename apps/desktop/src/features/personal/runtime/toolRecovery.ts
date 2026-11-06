/** Shared execution guidance, not a permission grant or a claim that any path was checked. */
export function personalExecutionGuidance(a: { directory: string; workspace?: string }) {
  return JSON.stringify({
    configured_workspace: a.workspace || a.directory,
    memory_directory: a.directory,
    directory_evidence: '以上是配置路径，执行前仍用 pwd 和目录存在性检查核对；不要推测旧会话缓存或归档目录作为工作目录。含空格路径必须正确引用。',
    file_workflow: '修改已有文件前，本轮先调用 Read 读取同一绝对路径。历史消息或自动加载的记忆不替代当前 Read 缓存。Edit 的 old_string 必须精确取自读取原文，不带行号；不匹配或文件已变化时重新读取核对，不能盲重试，也不能改用 Write 或 shell 绕过读后再改保护。新文件先核对父目录；写入后再次读取验证实际内容。',
    command_workflow: '执行命令先确认工作目录与前提。读取会话优先 session_list/read；确需查询数据库时先只读查看 schema，再使用实际列名，不能猜字段或修改核心数据库。多个独立探测分别核对退出码、标准输出与错误输出；可选路径不存在、grep/rg 无匹配用明确条件分支解释，不能吞掉真实失败。',
    recovery: '权限拒绝、命令不存在、语法或结构错误先定位原因再修正；已有输出不等于整条命令成功。可能已产生副作用但结果未知时先检查实际状态，不自动重放；只对已验证的结果报告成功。以上不新增工具、权限或读缓存，不改变原有安全校验。',
  });
}
