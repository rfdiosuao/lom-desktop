import { blankMachine, machineFromRow, machineProblem, type MachineForm } from '@/features/settings/runtime/sshMachineForm';
import { removeMachine, saveMachine } from '@/features/settings/runtime/sshMachineSave';
import { loadSshServers, type SshAuth } from '@/features/settings/runtime/sshServers';
import { onlyKeys, pickSshServer, sshAccount } from './sshTools';

const TEXT_FIELDS = ['name', 'host', 'username', 'group', 'note'] as const;
const KEYS = ['action', 'server', ...TEXT_FIELDS, 'port', 'auth', 'password', 'private_key', 'passphrase'];
const AUTHS: string[] = ['password', 'key', 'system'];

function overlay(form: MachineForm, args: Record<string, unknown>): MachineForm {
  const next = { ...form };
  for (const field of TEXT_FIELDS) {
    const value = args[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error(`${field} 需要是文本。`);
    next[field] = value;
  }
  if (args.port !== undefined) {
    if (typeof args.port !== 'string' && typeof args.port !== 'number') throw new Error('port 需要是 1–65535 的整数。');
    next.port = String(args.port);
  }
  if (args.auth !== undefined) {
    if (typeof args.auth !== 'string' || !AUTHS.includes(args.auth)) throw new Error('auth 需要是 password、key 或 system。');
    next.auth = args.auth as SshAuth;
  }
  const secret = next.auth === 'password' ? args.password : next.auth === 'key' ? args.private_key : undefined;
  for (const value of [secret, args.passphrase]) if (value !== undefined && typeof value !== 'string') throw new Error('凭据需要是文本。');
  const stray = [['password', 'password'], ['private_key', 'key'], ['passphrase', 'key']] as const;
  for (const [field, auth] of stray) if (args[field] !== undefined && next.auth !== auth) throw new Error(`${field} 只在 auth 为 ${auth} 时有效。`);
  if (typeof secret === 'string') next.secret = secret;
  if (next.auth === 'key' && typeof args.passphrase === 'string') next.passphrase = args.passphrase;
  return next;
}

/** 没写 auth 时按给出的凭据推断：给了私钥用密钥，给了密码用密码，都没有则沿用本机 SSH 配置。 */
const inferAuth = (args: Record<string, unknown>): SshAuth => args.private_key !== undefined ? 'key' : args.password !== undefined ? 'password' : 'system';

/** 助理新增、修改或移除服务器；凭据只写入系统钥匙串，结果里不回显任何凭据。 */
export async function executePersonalSshManage(args: Record<string, unknown>, current: () => boolean) {
  const { account, valid } = sshAccount(current);
  onlyKeys(args, KEYS);
  const rows = loadSshServers(account);
  if (args.action === 'remove') {
    const row = pickSshServer(rows, args.server);
    await removeMachine(account, row.id);
    return { status: 'removed', id: row.id, name: row.name };
  }
  if (args.action !== 'add' && args.action !== 'update') throw new Error('请选择 add、update 或 remove。');
  const original = args.action === 'update' ? pickSshServer(rows, args.server) : undefined;
  const base = original ? machineFromRow(original) : { ...blankMachine(), auth: inferAuth(args) };
  const form = overlay(base, args);
  const problem = machineProblem(form, original);
  if (problem) throw new Error(problem);
  if (!valid()) throw new Error('助理或账号状态已变化，未保存。');
  const row = await saveMachine(account, original?.id ?? crypto.randomUUID(), form, original);
  return {
    status: original ? 'updated' : 'added', id: row.id, name: row.name, destination: row.destination, port: row.port, auth: row.auth ?? 'system', group: row.group ?? null, note: row.note ?? null,
    ...(row.auth && row.auth !== 'system' ? { note_security: '密码或私钥只保存在系统钥匙串，不会再次显示；请不要在回复里复述凭据。' } : {}),
  };
}
