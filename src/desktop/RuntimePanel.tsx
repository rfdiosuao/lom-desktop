import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { setEndpoint } from '../runtime/client';
import { listAgents } from '../runtime/cli';
import type { AgentRow, CoreStatus, Endpoint } from '../runtime/types';
import { Btn } from './Button';
import { ListRow, Section } from './Layout';

/** Read-only discovery. The gallery never sends a prompt, runs a tool or starts a CLI handshake. */
export function RuntimePanel() {
  const [rows, setRows] = useState<AgentRow[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [status, setStatus] = useState<CoreStatus | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false, revision = 0;
    let unlisten: (() => void) | undefined;
    void listen<CoreStatus>('core://status', event => {
      if (disposed) return;
      revision += 1;
      setStatus(event.payload);
    })
      .then(async stop => {
        if (disposed) { stop(); return; }
        unlisten = stop;
        const before = revision;
        const current = await invoke<CoreStatus>('core_status');
        if (!disposed && before === revision) setStatus(current);
      })
      .catch(() => { /* status is optional diagnostics */ });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  async function connect() {
    setBusy(true); setError(''); setLoaded(false); setRows([]);
    try {
      if (!isTauri()) throw new Error('请在桌面模式打开；浏览器预览没有原生运行时。');
      const endpoint = await invoke<Endpoint>('core_endpoint');
      setEndpoint(endpoint);
      setRows(await listAgents()); setLoaded(true);
    } catch (e) { setEndpoint(null); setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function restart() {
    setBusy(true); setError(''); setLoaded(false); setRows([]);
    try {
      if (!isTauri()) throw new Error('请在桌面模式打开；浏览器预览没有原生运行时。');
      const endpoint = await invoke<Endpoint>('restart_core');
      setEndpoint(endpoint);
      setRows(await listAgents()); setLoaded(true);
    } catch (e) { setEndpoint(null); setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <Section title="本机 CLI 发现">
    <p>默认无需运行时。若你已安装兼容运行时，可在启动桌面前用 LOM_CORE_BIN 指定它；本仓库不分发或自动下载商业内核。CLI 需要自行安装、登录。</p>
    <p>
      <Btn label={busy ? '正在读取…' : '读取本机 CLI'} disabled={busy} onClick={() => void connect()} />{' '}
      <Btn label="重启核心服务" disabled={busy} onClick={() => void restart()} />
    </p>
    {status && <p role="status">内核：{status.state}{status.attempt > 0 ? ` · 第 ${status.attempt} 次重试` : ''}{status.lastError ? ` · ${status.lastError}` : ''}</p>}
    {error && <p role="alert">{error}</p>}
    {loaded && !rows.length && <p role="status">运行时未发现外部 CLI。没有添加演示条目。</p>}
    {rows.map(row => <ListRow key={row.id} title={row.name} sub={`${row.installed ? '已安装' : '未安装'} · ${row.enabled ? '已启用' : '未启用'} · ${row.status}`} />)}
    <p>连接、会话创建、显式发送和取消的适配器在 src/runtime；本页仅发现列表，完整聊天与权限面板仍待公开版接入。</p>
  </Section>;
}
