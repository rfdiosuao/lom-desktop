import { deleteSched, openSchedResult, formDay, formSet, formToggle, runSched, saveSched } from '../actions/schedule';
import { closeModal } from '@/shared/overlays/controller';
import { Chip } from '@/shared/ui/Agent';
import { Btn } from '@/shared/ui/Button';
import { Badge, Seg, Toggle } from '@/shared/ui/Controls';
import { Empty, Field, IconTile, Input, ListRow, Textarea } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { DEFAULT_RUN_MODE } from '../runtime/schedules';
import { agent, freqText, personaOf, phones } from '@/state/selectors';
import { S } from '@/state/store';
import { ago } from '@/shared/lib/util';

type P = Record<string, unknown>;

export function SchedModal({ p }: { p: P }) {
  const f = S.form, agents = [agent('pc')!, ...phones()];
  const id = p.id as string | undefined;
  return (
    <Modal title={id ? '编辑定时任务' : '新建定时任务'} desc={agent(f.exec)?.real ? "保存到手机本机；每天/每周按手机时区。" : "电脑任务需要保持 Lom 运行；示例手机不实际执行。"} size="lg"
      foot={<>{id && <Btn label="删除" variant="danger-ghost" onClick={() => deleteSched(id)} disabled={!!f.saving} />}<span className="grow" /><Btn label="取消" variant="secondary" onClick={closeModal} disabled={!!f.saving} /><Btn label="保存" variant="primary" onClick={saveSched} disabled={!f.name || !f.prompt || f.saving || f.editable === false} /></>}>
      {f.error && <p role="alert" className="form-error">{f.error}</p>}
      <Field label="名称" req><Input bind="form.name" placeholder="例如：评论区巡检" autoFocus /></Field>
      <Field label="执行者">
        <div className="row" style={{ flexWrap: 'wrap' }} role="radiogroup" aria-label="执行者">
          {agents.map(a => <Chip key={a.id} agent={a} sub={a.kind === 'phone' ? personaOf(a) : '总指挥'} size="sm" selected={f.exec === a.id} onClick={() => { if (!f.remote && !f.phoneTask && !id) formSet('exec', a.id); }} select="single" />)}
        </div>
      </Field>
      <Field label="指令" req><Textarea bind="form.prompt" placeholder="到点时要做什么？写清楚目标和要求。" rows={3} /></Field>
      <Field label="频率"><Seg options={[{ value: 'once', label: '一次' }, { value: 'daily', label: '每天' }, { value: 'weekly', label: '每周' }, { value: 'interval', label: '按间隔' }, ...(f.remote ? [{ value: 'custom', label: '自定义' }] : [])]} value={f.freq} onChange={v => formSet('freq', v)} /></Field>
      {f.freq === 'weekly' && (
        <Field label="星期">
          <div className="weekdays">{[1, 2, 3, 4, 5, 6, 0].map(d => <Btn key={d} label={'日一二三四五六'[d]} size="sm" variant="secondary" active={(f.days || []).includes(d)} onClick={() => formDay(d)} />)}</div>
        </Field>
      )}
      {f.freq === 'custom' ? <Field label={`Cron 表达式（${f.timezone || '本地时区'}）`}><Input bind="form.cron" /></Field> : f.freq === 'interval'
        ? <Field label="间隔"><Seg options={[15, 30, 60, 120, 240].map(n => ({ value: String(n), label: n < 60 ? `${n} 分钟` : `${n / 60} 小时` }))} value={String(f.every)} onChange={v => formSet('every', v)} /></Field>
        : <Field label={f.freq === 'once' ? '执行时间' : '时间'}><Input bind="form.time" type={f.freq === 'once' ? 'datetime-local' : 'time'} style={{ maxWidth: 220 }} /></Field>}
      <Field label="到点后" hint={f.runIn === 'same' ? '结果追加到同一个会话里，适合巡检、监工这类持续任务。' : '每次生成一个新会话，适合日报、周报。'}>
        <Seg options={[{ value: 'same', label: '在原窗口接着跑' }, { value: 'new', label: '新开一个窗口' }]} value={f.runIn} onChange={v => formSet('runIn', v)} />
      </Field>
      {f.exec === 'pc' && (
        <Field label="运行权限" hint={(f.runMode || DEFAULT_RUN_MODE) === 'default' ? '到点运行时你可能不在电脑前：遇到需要确认的操作会停下来，等你回来处理。' : (f.runMode || DEFAULT_RUN_MODE) === 'yolo' ? '在工作文件夹内自动完成所有操作，包括运行命令。' : '自动读写文件；运行命令前仍会停下来等你确认。'}>
          <Seg options={[{ value: 'default', label: '每次询问' }, { value: 'auto_edit', label: '自动编辑文件' }, { value: 'yolo', label: '全自动' }]} value={f.runMode || DEFAULT_RUN_MODE} onChange={v => formSet('runMode', v)} />
        </Field>
      )}
      <Field label="启用" inline><Toggle on={f.enabled} onChange={() => formToggle('enabled')} label="启用" /></Field>
    </Modal>
  );
}

export function SchedRunsModal({ p }: { p: P }) {
  const x = S.schedules.find(y => y.id === p.id);
  if (!x) return null;
  return (
    <Modal title={`运行记录 · ${x.name}`} desc={`${agent(x.exec)?.name} · ${freqText(x)}${(x.remote || x.phoneTask) ? ' · 最近一次运行状态' : ''}`}
      foot={<><Btn label="立即运行" ic="play" variant="secondary" onClick={() => runSched(x.id)} /><Btn label="关闭" variant="primary" onClick={closeModal} /></>}>
      {x.runs.length
        ? <div className="list">{x.runs.map((r, i) => (
          <ListRow key={i} lead={<IconTile ic={r.ok ? 'check' : 'info'} />} title={(x.remote || x.phoneTask) ? (r.ok ? '成功' : '需要处理') : '示例记录 · 未实际执行'} titleExtra={!(x.remote || x.phoneTask) ? <Badge text="演示" /> : r.ok ? <Badge text="成功" tone="ok" /> : <Badge text="求助" tone="warn" />}
            sub={(x.remote || x.phoneTask) ? r.note || (x.runIn === 'same' ? '结果已追加到原会话' : '已生成新会话') : '示例记录，不代表实际任务结果'} meta={ago(r.at)}
            actions={<Btn label="查看" variant="ghost" size="sm" onClick={() => void openSchedResult(x.id, i)} />} />
        ))}</div>
        : <Empty ic="history" title="还没有运行过" />}
    </Modal>
  );
}
