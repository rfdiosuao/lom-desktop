import { GROUP_MAX, NOTE_MAX, isSshDestination, type SshAuth, type SshDraft, type SshServer } from './sshServers';

export const NAME_MAX = 30;
export const KEY_MAX = 65536;
export const DEFAULT_PORT = '22';
export const DEFAULT_USER = 'root';
/** 下拉里表示“不分组”的选项名；它不是真实分组，所以不允许拿来命名分组。 */
export const UNGROUPED = '未分组';

export interface MachineForm {
  name: string; host: string; port: string; username: string; auth: SshAuth;
  secret: string; passphrase: string; group: string; note: string;
}

export const blankMachine = (): MachineForm => ({
  name: '', host: '', port: DEFAULT_PORT, username: DEFAULT_USER, auth: 'password', secret: '', passphrase: '', group: '', note: '',
});

/** 已保存的机器还原成表单：目标 user@host 拆开，凭据不回填（留空表示保持不变）。 */
export function machineFromRow(row: SshServer): MachineForm {
  const at = row.destination.indexOf('@');
  return {
    name: row.name, host: at < 0 ? row.destination : row.destination.slice(at + 1), port: row.port?.toString() ?? '',
    username: at < 0 ? '' : row.destination.slice(0, at), auth: row.auth ?? 'system',
    secret: '', passphrase: '', group: row.group ?? '', note: row.note ?? '',
  };
}

const destinationOf = (form: MachineForm) => form.username.trim() ? `${form.username.trim()}@${form.host.trim()}` : form.host.trim();
const portOf = (form: MachineForm) => form.port.trim() ? Number(form.port) : null;

/** 旧记录没有验证方式且表单没有改动它，就继续保持“沿用本机配置”的旧语义（含此前导入的私钥）。 */
export function rowFromMachine(id: string, form: MachineForm, original?: SshServer): SshServer {
  const legacy = original && original.auth === undefined && form.auth === 'system';
  const row: SshServer = { id, name: form.name.trim(), destination: destinationOf(form), port: portOf(form) };
  if (!legacy) row.auth = form.auth;
  if (form.group.trim()) row.group = form.group.trim();
  if (form.note.trim()) row.note = form.note.trim();
  return row;
}

/** 只有真的填了内容才有草稿；编辑时留空表示沿用已保存的凭据。 */
export function draftOf(form: MachineForm): SshDraft | undefined {
  if (form.auth === 'system' || !form.secret.trim()) return undefined;
  return form.auth === 'key' ? { secret: form.secret, passphrase: form.passphrase || undefined } : { secret: form.secret };
}

/** 新机器必须填凭据；编辑时验证方式没变且留空，则沿用已保存的凭据。 */
function needsSecret(form: MachineForm, original?: SshServer) {
  if (form.auth === 'system') return false;
  return !(original && (original.auth ?? 'system') === form.auth);
}

/** 返回第一个不合法的原因；合法则返回 undefined。 */
export function machineProblem(form: MachineForm, original?: SshServer): string | undefined {
  if (!form.name.trim()) return '请填写机器名称。';
  if (!form.host.trim()) return '请填写主机地址。';
  const port = form.port.trim();
  if (port && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535)) return '端口需要是 1–65535 的整数。';
  if (!isSshDestination(destinationOf(form))) return '主机地址或用户名不合法。';
  if (form.auth !== 'system' && needsSecret(form, original) && !form.secret.trim()) return form.auth === 'key' ? '请粘贴或上传密钥。' : '请填写密码。';
  if (form.auth === 'key' && form.passphrase && !form.secret.trim()) return '更换密钥密码时，请同时粘贴密钥。';
  if (form.secret.length > KEY_MAX) return '密钥内容过大。';
  if (form.group.trim() === UNGROUPED) return `分组名称不能是「${UNGROUPED}」。`;
  if (form.name.length > 80 || form.group.length > GROUP_MAX || form.note.length > NOTE_MAX) return '名称、分组或备注过长。';
  return undefined;
}
