import { repairBuiltin } from '@/features/account/runtime/cloud';
import { useEffect } from 'react';
import { syncPhoneSchedules } from '@/features/phones/runtime/phoneSchedules';
import { toastError } from '@/shared/overlays/controller';
import { syncSchedules } from '../runtime/schedules';
import { editSched, runSched, toggleSched } from '../actions/schedule';
import { openMenu } from '@/shared/overlays/controller';
import { Avatar } from '@/shared/ui/Agent';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Badge, Seg, Toggle } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { DemoNote, Empty, ListRow, PageHead, Search, SyncState } from '@/shared/ui/Layout';
import { agent, freqText, phone } from '@/state/selectors';
import { update, useStore } from '@/state/store';
import { ago } from '@/shared/lib/util';
import { Page } from '@/shared/ui/Page';

/* ===== 定时任务（电脑与手机共用一个页面实现） ===== */
export function SchedulePage() {
  const s = useStore();
  useEffect(() => { void syncSchedules(); }, []);
  const phoneScope = s.route.name === 'phone-schedule', p = phone();
  useEffect(() => { if (phoneScope && p.real) void syncPhoneSchedules(p.id).catch(e => toastError('读取手机任务失败', e)); }, [phoneScope, p.id, p.real]);
  let list = s.schedules.filter(x => (phoneScope ? x.exec === p.id : true));
  if (!phoneScope && s.schedFilter !== 'all') list = list.filter(x => (s.schedFilter === 'pc' ? x.exec === 'pc' : x.exec !== 'pc'));
  if (s.q.sched) list = list.filter(x => (x.name + x.prompt).includes(s.q.sched));
  const exec = phoneScope ? p.id : 'pc';
  return (
    <Page>
      <PageHead title={phoneScope ? `${p.name} 的定时任务` : '定时任务'}
        desc={phoneScope ? (p.real ? '任务在手机本机执行，关闭电脑后仍保留；请允许手机后台运行。' : '示例手机任务不实际执行。') : '电脑任务与 Agent 创建的任务实时同步；请保持 Lom 运行。'}
        actions={<Btn label="新建定时任务" ic="plus" variant="primary" onClick={() => editSched({ exec })} />}
        extra={<div className="row" style={{ marginTop: 8 }}>{phoneScope && <SyncState phone={p} />}<DemoNote text={phoneScope && p.real ? (list.some(x => x.exact === false) ? "手机未授予精确闹钟权限，任务可能延迟；请在手机设置中开启" : `手机本机任务 · ${list[0]?.timezone || '手机本地时区'}`) : "示例手机仅用于演示，真实设备任务在设备上执行"} /></div>} />
      {s.cloudScheduleError && <p className="form-error" role="alert">{s.cloudScheduleError}<Btn label="重新同步" size="sm" onClick={() => void repairBuiltin()} /></p>}
      <div className="toolbar">
        {!phoneScope && <Seg options={[{ value: 'all', label: '全部' }, { value: 'pc', label: '电脑主控' }, { value: 'phone', label: '手机' }]} value={s.schedFilter} onChange={v => update(x => { x.schedFilter = v; })} />}
        <div className="grow" style={{ maxWidth: 300 }}><Search bind="q.sched" placeholder="搜索定时任务" /></div>
      </div>
      {list.length ? (
        <div className="list">
          {list.map(x => (
            <ListRow key={x.id} lead={<Avatar agent={agent(x.exec)} />} title={x.name}
              titleExtra={<>{x.auto && <Badge text="总指挥自动创建" tone="info" ic="eye" />}{!x.remote && !x.phoneTask && <Badge text="演示" />}{!x.enabled && <Badge text="已暂停" />}</>}
              sub={x.prompt}
              meta={<>
                <div className="sched-meta" style={{ justifyContent: 'flex-end' }}><Icon name="repeat" />{freqText(x)}</div>
                <div className="sched-meta" style={{ justifyContent: 'flex-end' }}><Icon name={x.runIn === 'same' ? 'message' : 'plus'} />{x.runIn === 'same' ? '原窗口继续' : '新开窗口'} · {x.last ? `上次 ${ago(x.last)}` : '未运行'}</div>
              </>}
              actions={<>
                <Toggle on={x.enabled} onChange={() => toggleSched(x.id)} label={`启用${x.name}`} size="sm" />
                <IconBtn ic="play" label="立即运行" onClick={() => runSched(x.id)} />
                <IconBtn ic="more" label="更多" onClick={e => openMenu('sched', e.currentTarget, { id: x.id, key: `sc${x.id}`, align: 'end' })} />
              </>} />
          ))}
        </div>
      ) : <Empty ic="clock" title="还没有定时任务" desc="比如：每天 9 点整理选题，每 2 小时巡检评论区。" actions={<Btn label="新建定时任务" ic="plus" variant="primary" onClick={() => editSched({ exec })} />} />}
    </Page>
  );
}
