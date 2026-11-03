import { personalError } from '../runtime/errors';
import { Fragment, useEffect, useState } from 'react';
import { ensureHeartbeats } from '../runtime/heartbeats';
import { Btn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Toggle } from '@/shared/ui/Controls';
import { saveCoreSchedule, toggleCoreSchedule } from '@/features/schedules/runtime/schedules';
import { confirm, toastError } from '@/shared/overlays/controller';
import { useStore } from '@/state/store';
import { freqText, nextRunText, scheduleDetail } from '@/state/selectors';
import type { Schedule } from '@/state/types';
import type { PersonalAssistant } from '../runtime/catalog';
import { personalScheduleDraft } from '../runtime/scheduleTarget';

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
    {!rows.length && <p className="pa-muted">还没有定时任务。</p>}
    {/* UI-AUDIT-03：一行一个任务；cron 原文和时区放在悬停提示里，与定时任务页一致 */}
    {rows.map(x => <div className="pa-task" key={x.id}><Icon name="clock" />
      <div className="pa-task__main"><strong title={x.name}>{x.name}</strong><small title={scheduleDetail(x) || undefined}>{[freqText(x), x.enabled ? nextRunText(x) : '已暂停'].filter(Boolean).map((part, i) => <Fragment key={i}>{i ? ' · ' : ''}<span>{part}</span></Fragment>)}</small></div>
      <Toggle disabled={!!busy} on={x.enabled} label={`${x.name}自动执行`} onChange={() => void toggle(x)} />
    </div>)}
    {/* UI-AUDIT-02 UI-05：聊天通道连接与任务结果推送分开说明，集中一处，不放不可用的假开关 */}
    <p className="pa-muted pa-note" data-testid="pa-delivery-note">任务结果保留在这位助理的对话中；定时任务结果推送暂不支持，飞书、微信连接只用于和助理聊天。</p>
  </section>;
}
function ScheduleForm({ assistant, done }: { assistant: PersonalAssistant; done: () => void }) {
  const [name, setName] = useState(''), [prompt, setPrompt] = useState(''), [time, setTime] = useState('09:00'), [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || !prompt.trim()) { toastError('无法创建任务', new Error('请填写名称和提示词')); return; }
    let draft;
    try { draft = personalScheduleDraft(assistant, { name, prompt }, { freq: 'daily', time }); }
    catch (e) { toastError('无法创建任务', e instanceof Error ? e : new Error(String(e))); return; }
    setBusy(true);
    try { await saveCoreSchedule(draft, undefined, { personalId: assistant.id }); done(); }
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
