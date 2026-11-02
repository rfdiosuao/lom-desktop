import { personalError } from '../runtime/errors';
import { useEffect, useState } from 'react';
import { ensureHeartbeats } from '../runtime/heartbeats';
import { Btn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Toggle } from '@/shared/ui/Controls';
import { saveCoreSchedule, toggleCoreSchedule } from '@/features/schedules/runtime/schedules';
import { confirm, toastError } from '@/shared/overlays/controller';
import { useStore } from '@/state/store';
import type { Schedule } from '@/state/types';
import type { PersonalAssistant } from '../runtime/catalog';

export function PersonalSchedules({ assistant }: { assistant: PersonalAssistant }) {
  const s = useStore(), [form, setForm] = useState(false), [busy, setBusy] = useState('');
  const [defaultsError, setDefaultsError] = useState(''), [defaultsRetry, setDefaultsRetry] = useState(0);
  useEffect(() => { let live = true; setDefaultsError(''); void ensureHeartbeats(assistant).catch(e => { if (live) setDefaultsError(e instanceof Error && /待核对|账号|归属/.test(e.message) ? e.message : '默认任务未创建，请检查连接和模型后重试'); }); return () => { live = false; }; }, [assistant.id, assistant.conversation, defaultsRetry]);
  const rebuild = () => confirm({ title: '重建未找到的默认任务？', desc: '上次创建结果未知。将再次核对服务器，只重建未找到的默认任务；请先确认没有同用途任务正在运行。', okText: '核对并重建', onOk: () => { void ensureHeartbeats(assistant, true).then(() => setDefaultsError(''), () => setDefaultsError('重建未完成，请核对任务记录')); } });
  const rows = s.schedules.filter(x => x.remote && !!assistant.conversation && x.conversationId === assistant.conversation);
  const toggle = async (x: Schedule) => {
    setBusy(x.id);
    try { await toggleCoreSchedule(x, { personalId: assistant.id }); } catch (e) { toastError('更改任务失败', new Error(personalError(e))); } finally { setBusy(''); }
  };
  return <section className="pa-section"><div className="pa-section__heading"><h2>定时任务 <small>{rows.length}</small></h2><Btn label={form ? '收起' : '新建'} variant="link" size="sm" disabled={!assistant.conversation} onClick={() => setForm(!form)} /></div>
    {s.cloudScheduleError && <p className="pa-error" role="alert">{s.cloudScheduleError}</p>}
    {defaultsError && <p className="pa-error" role="alert">默认任务：{defaultsError}{defaultsError.includes('待核对') && <Btn label="确认重建缺失任务" size="sm" onClick={rebuild} />}<Btn label="核对并重试" size="sm" onClick={() => setDefaultsRetry(x => x + 1)} /></p>}
    {form && <ScheduleForm assistant={assistant} done={() => setForm(false)} />}
    {!rows.length && <p className="pa-muted">还没有独立任务。结果保留在这位助理的对话中。</p>}
    {rows.map(x => <div className="pa-task" key={x.id}><div className="pa-task__title"><Icon name="clock" /><strong>{x.name}</strong><small>{x.time || x.scheduleDescription || x.cron}</small></div>
      <div className="pa-toggle"><span>自动执行</span><Toggle disabled={!!busy} on={x.enabled} label={`${x.name}自动执行`} onChange={() => void toggle(x)} /></div>
      <div className="pa-toggle"><span>推送结果</span><Toggle on={false} disabled label={`${x.name}推送结果（未接入）`} onChange={() => undefined} /></div>
      <small className="pa-muted">静默模式 · IM推送尚未接入</small><div className="pa-destinations"><span>推送到</span>{['微信', '飞书'].map(name => <label key={name}><input type="checkbox" disabled aria-label={`${x.name}推送到${name}（未接入）`} />{name}</label>)}</div>
    </div>)}
  </section>;
}
function ScheduleForm({ assistant, done }: { assistant: PersonalAssistant; done: () => void }) {
  const s = useStore(); const [name, setName] = useState(''), [prompt, setPrompt] = useState(''), [time, setTime] = useState('09:00'), [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || !prompt.trim()) { toastError('无法创建任务', new Error('请填写名称和提示词')); return; }
    const c = s.convs.find(x => x.id === assistant.conversation);
    if (!c?.modelId || !c.providerId) { toastError('无法创建任务', new Error('请先连接Lom模型')); return; }
    setBusy(true);
    try { await saveCoreSchedule({ id: '', name, prompt, time, exec: 'pc', enabled: true, freq: 'daily', days: [], every: 60, runIn: 'same', last: null, runs: [], conversationId: c.id,
      runMode: 'default', agentConfig: { model: { provider_id: c.providerId, model: c.modelId.split('::').slice(1).join('::') }, workspace: c.workspace, name: assistant.name } }, undefined, { personalId: assistant.id }); done(); }
    catch (e) { toastError('创建定时任务失败', new Error(personalError(e))); } finally { setBusy(false); }
  };
  return <form className="pa-form" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <label>任务名称<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required /></label>
    <label>提示词<textarea value={prompt} onChange={e => setPrompt(e.target.value)} required /></label>
    <label>每天执行<input type="time" value={time} onChange={e => setTime(e.target.value)} required /></label>
    <small>按本机时区执行，权限为每次询问；需要确认时会暂停等待。</small>
    <Btn label={busy ? '创建中…' : '创建静默任务'} disabled={busy} onClick={() => void submit()} size="sm" variant="primary" />
  </form>;
}
