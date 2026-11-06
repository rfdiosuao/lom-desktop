import './settingsServers.css';
import { useState } from 'react';
import { useStore } from '@/state/store';
import { confirm, openModal } from '@/shared/overlays/controller';
import { t, tf } from '@/shared/i18n/index';
import { Btn } from '@/shared/ui/Button';
import { PageHead, Section, SettingCard, SettingRow } from '@/shared/ui/Layout';
import { removeMachine } from '../runtime/sshMachineSave';
import { checkSshServer, loadSshServers, readSshCheck, sshErrorText, type SshAuth, type SshServer } from '../runtime/sshServers';

const AUTH_TEXT: Record<SshAuth, string> = { password: '密码', key: '密钥', system: '本机 SSH 配置' };

const read = (account: string) => {
  try { return { rows: loadSshServers(account), error: '' }; }
  catch (error) { return { rows: [], error: sshErrorText(error) }; }
};

function describe(row: SshServer, previous: string) {
  const parts = [row.destination + (row.port ? `:${row.port}` : ''), t(AUTH_TEXT[row.auth ?? 'system'])];
  if (row.group) parts.push(`${t('分组')} ${row.group}`);
  if (row.note) parts.push(row.note);
  return [...parts, previous].join(' · ');
}

function ServerList({ account }: { account: string }) {
  const [snapshot, setSnapshot] = useState(() => read(account));
  const [busy, setBusy] = useState<string>();
  const [results, setResults] = useState<Record<string, { text: string; error?: boolean }>>({});
  const [error, setError] = useState('');
  const refresh = () => { setSnapshot(read(account)); setError(''); };
  const open = (editing?: SshServer) => openModal('sshMachine', { account, editing, onSaved: refresh });
  async function probe(row: SshServer, status: boolean) {
    if (busy) return;
    setBusy(row.id);
    try {
      const check = await checkSshServer(account, row, status);
      const text = `${tf('SSH 探测耗时 {ms} ms', { ms: check.elapsed })}\n${check.detail}${check.saved ? '' : `\n${t('本次检查未保存。')}`}`;
      setResults(previous => ({ ...previous, [row.id]: { text, error: !check.ok } }));
    } catch (e) { setResults(previous => ({ ...previous, [row.id]: { text: sshErrorText(e), error: true } })); }
    finally { setBusy(undefined); }
  }
  async function remove(row: SshServer) {
    if (busy) return;
    setBusy(row.id);
    try {
      await removeMachine(account, row.id);
      refresh();
    } catch (e) { setResults(previous => ({ ...previous, [row.id]: { text: sshErrorText(e), error: true } })); }
    finally { setBusy(undefined); }
  }
  const ask = (row: SshServer) => confirm({
    title: tf('移除「{name}」？', { name: row.name }), desc: t('会同时删除系统钥匙串中保存的这台机器的密码或私钥，且无法恢复；之后要再用它，需要重新添加。'),
    okText: t('移除'), danger: true, onOk: () => void remove(row),
  });
  return <>
    <PageHead title="服务器管理" desc="添加 SSH 机器，测试连接并查看系统、运行时间、CPU、内存和挂载盘用量。密码和私钥只保存在系统钥匙串，连接时复用本机 OpenSSH 与已验证的主机指纹。"
      actions={<Btn label="添加机器" ic="plus" variant="primary" disabled={!!snapshot.error} onClick={() => open()} />} />
    {(snapshot.error || error) && <p role="alert" className="form-error">{snapshot.error || error}</p>}
    <Section title="已保存的服务器">
      {snapshot.rows.length === 0 && !snapshot.error && <p className="muted">{t('暂无服务器。')}</p>}
      <SettingCard>
        {snapshot.rows.map(row => {
          const check = readSshCheck(account, row);
          const previous = check ? `${t(check.ok ? '上次检查成功' : '上次检查失败')} · ${check.elapsed} ms · ${new Date(check.checkedAt).toLocaleString()}` : t('尚未检查');
          return <div key={row.id}>
            <SettingRow title={row.name} desc={describe(row, previous)} control={<div className="row ssh-settings-actions">
              <Btn label={busy === row.id ? '正在探测…' : '测试连接'} size="sm" disabled={!!busy} onClick={() => void probe(row, false)} />
              <Btn label="查看状态" size="sm" disabled={!!busy} onClick={() => void probe(row, true)} />
              <Btn label="编辑" size="sm" disabled={!!busy} onClick={() => open(row)} />
              <Btn label="移除" size="sm" variant="danger-ghost" disabled={!!busy} onClick={() => ask(row)} />
            </div>} />
            {!results[row.id] && check && !check.ok && <p className="ssh-settings-result form-error">{check.detail}</p>}
            {results[row.id] && <pre role={results[row.id].error ? 'alert' : 'status'} className={`ssh-settings-result ${results[row.id].error ? 'form-error' : 'muted'}`}>{results[row.id].text}</pre>}
          </div>;
        })}
      </SettingCard>
    </Section>
  </>;
}

export function SettingsServers() {
  const account = useStore().account?.id ?? 'local';
  return <ServerList key={account} account={account} />;
}
