import { draftOf, rowFromMachine, type MachineForm } from './sshMachineForm';
import { clearSshCheck, loadSshServers, removeSshIdentity, saveSshServers, sshErrorText, storeSshSecret, type SshServer } from './sshServers';

/**
 * 保存一台机器：先把新填的凭据写进系统钥匙串，再保存元数据；元数据保存失败时回收刚写入的凭据，
 * 不会留下没有记录的钥匙串条目，也不会留下“有记录却没有凭据”的假成功。
 */
export async function saveMachine(account: string, id: string, form: MachineForm, original?: SshServer): Promise<SshServer> {
  const row = rowFromMachine(id, form, original);
  const rows = loadSshServers(account);
  const draft = draftOf(form);
  const stored = !!draft && form.auth !== 'system';
  if (draft && stored) await storeSshSecret(id, form.auth, draft);
  else if (original?.auth && original.auth !== 'system' && form.auth === 'system') await removeSshIdentity(id);
  try {
    saveSshServers(account, original ? rows.map(item => item.id === id ? row : item) : [...rows, row]);
  } catch (error) {
    if (stored && !original) {
      try { await removeSshIdentity(id); }
      catch (cleanup) { throw new Error(`${sshErrorText(error)}（刚写入的凭据也未能清理：${sshErrorText(cleanup)}）`); }
    }
    throw error;
  }
  if (stored) clearSshCheck(account, id);
  return row;
}

/**
 * 移除一台机器：先把记录从列表删掉，再清钥匙串里的凭据，保证两边要么都没了、要么都还在。
 * 记录保存失败时凭据原封不动；凭据清理失败时把记录放回去并报错，用户可以重试，不会留下无法清理的孤儿凭据。
 */
export async function removeMachine(account: string, id: string) {
  const rows = loadSshServers(account);
  saveSshServers(account, rows.filter(row => row.id !== id));
  try {
    await removeSshIdentity(id);
  } catch (error) {
    try { saveSshServers(account, rows); }
    catch (restore) { throw new Error(`${sshErrorText(error)}（机器记录也未能恢复：${sshErrorText(restore)}）`); }
    throw error;
  }
  clearSshCheck(account, id);
}
