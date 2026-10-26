import { useEffect, useState } from 'react';
import { deleteSub, editSub, toggleSub } from '../actions/subagents';
import { loadPhoneSubagents, phoneSubagents } from '../runtime/phoneSubagents';
import { phone } from '@/state/selectors';
import { S, useStore } from '@/state/store';
import { authAccount } from '@/features/account/runtime/authScope';
import { Avatar } from '@/shared/ui/Agent';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Badge } from '@/shared/ui/Controls';
import { Empty, ListRow, PageHead } from '@/shared/ui/Layout';
import { Page } from '@/shared/ui/Page';

export function PhoneSubagents() {
  const s = useStore(), p = phone(), state = phoneSubagents(p.id);
  const [error, setError] = useState('');
  const disabled = state.busy || p.status !== 'online' || !state.loaded;
  async function reload() {
    const current = authAccount();
    setError('');
    try { await loadPhoneSubagents(p.id); }
    catch (cause) { if (current() && S.phoneId === p.id) setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  useEffect(() => {
    let active = true;
    setError('');
    if (p.real && !phoneSubagents(p.id).busy) void loadPhoneSubagents(p.id).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { active = false; };
  }, [p.id, p.real, p.status, s.account?.id, s.cloud]);
  return <Page>
    <PageHead title={`${p.name} 的子代理`} desc="管理手机上真实的子代理配置。启用或停用只影响后续委派，不会立即运行或终止现有任务。"
      actions={p.real ? <><Btn label={state.busy ? '正在同步…' : '刷新'} ic="refresh" disabled={state.busy} onClick={() => void reload()} /><Btn label="新建子代理" ic="plus" variant="primary" disabled={disabled} onClick={() => editSub()} /></> : undefined} />
    {!p.real ? <Empty ic="phone" title="请先选择真实手机" desc="示例手机不能同步或执行子代理。" /> : <>
      {(error || state.error) && <p role="alert" className="form-error">{error || state.error}</p>}
      {p.status !== 'online' && <p role="status">手机离线，请在手机上打开麓鸣并连接后刷新。</p>}
      {state.loaded && !state.delegationEnabled && <p role="status">手机的自动委派总开关已关闭。子代理配置仍可保存，启用后也暂不会接受自动委派；请在手机端开启总开关。</p>}
      {state.items.length ? <div className="list">{state.items.map(item => <ListRow key={item.id}
        lead={<Avatar agent={{ kind: 'user', name: item.name }} />} title={item.name}
        titleExtra={<><Badge text={item.enabled === 'true' ? '已启用' : '已停用'} tone={item.enabled === 'true' ? 'ok' : undefined} />{item.builtin === 'true' && <Badge text="内置" />}</>}
        sub={item.description || item.instructions} meta={state.groups.find(group => group.id === item.model_group)?.name || (item.model_group ? '原模型组不可用' : '自动选择（由手机决定）')}
        actions={<><Btn label={item.enabled === 'true' ? '停用' : '启用'} variant="ghost" size="sm" disabled={disabled} onClick={() => void toggleSub(item.id)} /><IconBtn ic="edit" label="编辑" disabled={disabled} onClick={() => editSub(item.id)} /><IconBtn ic="trash" label={item.builtin === 'true' ? '内置子代理不能删除' : '删除'} disabled={disabled || item.builtin === 'true'} onClick={() => deleteSub(item.id)} /></>} />)}</div>
        : <Empty ic="people" title={state.busy ? '正在读取手机子代理…' : state.loaded ? '手机还没有子代理' : '尚未读取手机子代理'} desc="列表来自当前手机；读取失败时不会用示例条目替代。" />}
    </>}
  </Page>;
}
