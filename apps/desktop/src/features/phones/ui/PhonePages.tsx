import { addMemory, blankSoul, clearMemory, deleteMemory, editMemory, saveSoul, soulMode } from '../actions/phone';
import { go } from '@/app/navigation';
import { openMenu } from '@/shared/overlays/controller';
import { Btn, Dropdown, IconBtn } from '@/shared/ui/Button';
import { Badge, Seg } from '@/shared/ui/Controls';
import { DemoNote, Empty, IconTile, ListRow, PageHead, Search, SyncState } from '@/shared/ui/Layout';
import { Markdown } from '@/shared/ui/Markdown';
import { phone } from '@/state/selectors';
import { update, useStore } from '@/state/store';
import { ago } from '@/shared/lib/util';
import { InstalledSkills } from '@/features/skills/ui/InstalledSkills';
import { Page } from '@/shared/ui/Page';

/* ===== 手机：技能 / 子代理 / 人格 SOUL.md / 记忆（手机端接入前为演示数据） ===== */

const PhoneExtra = ({ connected = false }: { connected?: boolean }) => <div className="row" style={{ marginTop: 8 }}>{connected ? <SyncState phone={phone()} /> : <Badge text="暂未接入，仅当前界面示例或草稿" />}{connected && !phone().real && <DemoNote />}</div>;

export function PhoneSkills() {
  useStore(); const p=phone();
  return <Page><PageHead title={`${p.name} 的技能`} desc="读取手机实际安装的技能，可查看、启停和卸载。" actions={<Btn label="从 skillhub 添加" onClick={()=>go('skillhub')} />} />
    {p.real ? <InstalledSkills key={p.id} device={p.id}/> : <Empty ic="phone" title="请先选择真实手机" desc="示例手机不执行技能安装。"/>}</Page>;
}

export { PhoneSubagents } from './PhoneSubagents';

export function PhoneSoul() {
  const s = useStore();
  const p = phone(), text = s.souls[p.id] || '', dirty = !!s.soulDirty[p.id];
  return (
    <Page>
      <PageHead title="人格 · SOUL.md" desc={`定义 ${p.name} 是谁、怎么说话、负责什么、有哪些底线。${p.real ? "保存后同步到手机。" : "示例仅保留在当前界面。"}`}
        actions={<><Dropdown label="使用模板" ic="book" menu="soulTpl" align="end" variant="secondary" /><Btn label={dirty ? (p.real ? '保存并同步' : '保存示例') : '无待保存修改'} ic={dirty ? 'sync' : 'check'} variant="primary" onClick={saveSoul} disabled={!dirty} /></>}
        extra={<div className="row" style={{ marginTop: 8 }}><SyncState phone={p} />{dirty && <Badge text="有未保存的修改" tone="warn" />}{!p.real && <DemoNote />}</div>} />
      <div className="toolbar"><Seg options={[{ value: 'split', label: '编辑 + 预览' }, { value: 'edit', label: '仅编辑' }]} value={s.soulPreview ? 'split' : 'edit'} onChange={soulMode} /><span className="muted" style={{ fontSize: 13 }}>{text.length} 字</span></div>
      {text || dirty ? (
        <div className="soul" style={s.soulPreview ? undefined : { gridTemplateColumns: '1fr' }}>
          <textarea className="textarea textarea--mono" aria-label="SOUL.md 内容" value={text} onChange={e => { const v = e.target.value; update(x => { x.souls[p.id] = v; x.soulDirty[p.id] = true; }); }} />
          {s.soulPreview && <div className="soul__preview msg__text"><Markdown text={text} /></div>}
        </div>
      ) : <Empty ic="person" title={`${p.name} 还没有人格`} desc="没有人格也可以对话。设定人格后，它会用固定的身份和语气工作，适合运营不同的账号。"
        actions={<><Btn label="从模板开始" ic="book" variant="primary" onClick={e => openMenu('soulTpl', e.currentTarget)} /><Btn label="空白开始" variant="secondary" onClick={blankSoul} /></>} />}
    </Page>
  );
}

export function PhoneMemory() {
  const s = useStore();
  const p = phone(), all = s.memories[p.id] || [], list = all.filter(m => !s.q.memory || m.text.includes(s.q.memory));
  return (
    <Page>
      <PageHead title={`${p.name} 的记忆`} desc="跨会话保留的知识。手机 Agent 会在对话中自动记住，你也可以手动添加或删除。" actions={<Btn label="添加记忆" ic="plus" variant="primary" onClick={addMemory} />} extra={<PhoneExtra connected />} />
      <div className="toolbar">
        <div className="grow" style={{ maxWidth: 340 }}><Search bind="q.memory" placeholder="搜索记忆" /></div>
        <span className="muted" style={{ fontSize: 13 }}>共 {all.length} 条</span>
        <Btn label="清空全部" variant="danger-ghost" size="sm" onClick={clearMemory} disabled={!all.length} />
      </div>
      {list.length ? <div className="list">{list.map(m => (
        <ListRow key={m.id} lead={<IconTile ic="brain" />} titleExtra={<span className="memory-text" style={{ fontWeight: 400 }}>{m.text}</span>}
          sub={`${m.src === '手动' ? '手动添加' : '从对话中记住'} · ${ago(m.at)}`}
          actions={<><IconBtn ic="edit" label="编辑" onClick={() => editMemory(m.id)} /><IconBtn ic="trash" label="删除" onClick={() => deleteMemory(m.id)} /></>} />
      ))}</div> : <Empty ic="brain" title={s.q.memory ? '没有匹配的记忆' : '还没有记忆'} desc="对话里说「记住……」，或点右上角手动添加。" />}
    </Page>
  );
}
