import { useEffect, useState } from 'react';
import { openExternalUrl } from '@/core/links';
import { toastError } from '@/shared/overlays/controller';
import { Btn } from '@/shared/ui/Button';
import { openModal } from '@/shared/overlays/controller';
import { useStore } from '@/state/store';
import { McpManager } from '@/features/settings/ui/McpModal';
import { hostedMcp, isHostedMcp, listMcp, protectedMcp, type McpServer } from '@/features/settings/runtime/mcpManager';
import { CatalogItem } from './CatalogItem';
import { PluginAssignments } from './PluginAssignments';

// Shown only when a self-hosted connector service has been configured.
const featuredApps = [
  { id: 'github', name: 'GitHub', description: '查看仓库与议题' },
  { id: 'google-drive', name: 'Google Drive', description: '查找和读取云端文件' },
  { id: 'slack', name: 'Slack', description: '查找频道和消息' },
];

function visibleConnector(row: McpServer) {
  return !protectedMcp(row) && !isHostedMcp(row);
}

export function Plugins({ query = '' }: { query?: string }) {
  const [rows, setRows] = useState<McpServer[]>();
  const [selected, setSelected] = useState<typeof featuredApps[number]>();
  const [error, setError] = useState(false);
  const [detail, setDetail] = useState<McpServer | 'assign'>();
  const [revision, setRevision] = useState(0);
  const managing = useStore().modals.some(modal => modal.id === 'mcp' || modal.id === 'mcpConnector');
  useEffect(() => {
    if (managing || detail) return;
    let live = true;
    setError(false);
    void listMcp().then(data => {
      if (live) setRows(data.filter(visibleConnector));
    }).catch(() => {
      if (live) setError(true);
    });
    return () => { live = false; };
  }, [revision, managing, detail]);

  if (detail) return <section className="hub-detail">
    <Btn label="返回连接器" onClick={() => setDetail(undefined)}/>
    {detail === 'assign' ? <PluginAssignments/> : <McpManager embedded initialServer={detail}/>}
  </section>;

  const term = query.trim().toLowerCase();
  const featured = hostedMcp.url ? featuredApps.filter(app => `${app.name} ${app.description}`.toLowerCase().includes(term)) : [];
  const visible = rows?.filter(row => row.name.toLowerCase().includes(term));
  return <>
    {selected ? <section className="hub-detail">
      <Btn label="返回精选" onClick={() => setSelected(undefined)}/>
      <h2>{selected.name}</h2>
      <p>{selected.description}</p>
      <p className="muted">先在托管服务中配置此应用的账号，再回到麓鸣授权连接。账号权限由你确认。</p>
      <div className="row">
        <Btn label="配置应用账号" onClick={() => void openExternalUrl(new URL(hostedMcp.url).origin)
          .catch(error => toastError('打开配置页面失败', error))}/>
        <Btn label="授权麓鸣连接" onClick={() => openModal('mcp')}/>
      </div>
    </section> : featured.length > 0 && <section aria-label="精选连接器">
      <div className="hub-section-heading"><h2>精选连接器</h2></div>
      <div className="hub-grid hub-connector-grid">
        {featured.map(app => <CatalogItem key={app.id} name={app.name} description={app.description}
          imageUrl={`/connectors/${app.id}.png`} icon="globe" action="配置" onClick={() => setSelected(app)}/>)}
      </div>
    </section>}
    <div className="hub-filter-row">
      <div className="hub-section-heading"><h2>我的连接器</h2></div>
      <Btn size="sm" label="分配给助理" onClick={() => setDetail('assign')}/>
    </div>
    <div className="hub-grid hub-connector-grid">
      {visible?.map(row => {
        const connected = row.enabled && row.last_test_status === 'connected' && !!row.tools?.length;
        return <CatalogItem key={row.id} name={row.name}
          description={row.transport.type === 'stdio' ? '连接此电脑上的服务' : '连接远程服务'}
          icon={row.transport.type === 'stdio' ? 'terminal' : 'globe'}
          action={connected ? '已连接' : '连接'} onClick={() => setDetail(row)}/>;
      })}
    </div>
    {!visible?.length && <div className="hub-empty">
      <p>{error ? '暂时无法读取连接器。' : query ? (featured.length ? '没有匹配的自定义连接器。' : '没有匹配的连接器。') : '添加自己的连接器，让助理使用你授权的服务。'}</p>
      {error ? <Btn label="重试" size="sm" onClick={() => setRevision(n => n + 1)}/> :
        !query && <Btn label="添加连接器" size="sm" onClick={() => openModal('mcpConnector')}/>}
    </div>}
  </>;
}
