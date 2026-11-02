import { saveSub } from '../actions/subagents';
import { phoneSubagents } from '../runtime/phoneSubagents';
import { closeModal } from '@/shared/overlays/controller';
import { formSet } from '@/features/schedules/actions/schedule';
import { Btn } from '@/shared/ui/Button';
import { Seg } from '@/shared/ui/Controls';
import { Field, Input, Textarea } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { useStore } from '@/state/store';

export function SubModal({ p }: { p: Record<string, unknown> }) {
  const s = useStore(), device = String(p.phoneId), state = phoneSubagents(device), f = s.form;
  const current = p.current as (() => boolean) | undefined;
  const accountCurrent = !!current?.(), changed = s.phoneId !== device || !accountCurrent;
  const busy = state.busy, disabled = busy || changed || s.agents[device]?.status !== 'online';
  const invalidGroup = !!f.model_group && !state.groups.some(group => group.id === f.model_group);
  return <Modal title={p.id ? '编辑子代理' : '新建子代理'} desc={`属于 ${s.agents[device]?.name || '原手机'}。手机确认后保存；启用状态仅影响后续委派。`}
    foot={<><Btn label="取消" variant="secondary" onClick={closeModal} /><Btn label={busy ? '正在保存…' : '保存到手机'} variant="primary" onClick={() => void saveSub()} disabled={disabled || invalidGroup || !f.name?.trim() || !f.instructions?.trim()} /></>}>
    {changed && <p role="alert" className="form-error">账号或所选手机已变化，请复制需要保留的草稿后重新打开编辑。</p>}
    {state.error && <p role="alert" className="form-error">{state.error}。草稿已保留；若手机版本冲突，请复制草稿、刷新列表后重新编辑。</p>}
    {accountCurrent && <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }}>
      <Field label="名称" req>{f.builtin === 'true' ? <p>{f.name}（内置，不可改名）</p> : <Input bind="form.name" placeholder="例如：评论回复员" autoFocus />}</Field>
      <Field label="简介"><Input bind="form.description" placeholder="一句话说明它负责什么" /></Field>
      <Field label="工作指令" req><Textarea bind="form.instructions" placeholder="它负责什么？有哪些要求和底线？" rows={5} /></Field>
      <Field label="手机模型分组"><select className="input select" aria-label="手机模型分组" value={f.model_group} onChange={event => formSet('model_group', event.target.value)}>
        <option value="">自动选择</option>
        {invalidGroup && <option value={f.model_group} disabled>原模型组不可用</option>}
        {state.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>{invalidGroup && <p role="alert">原模型组已不可用，请重新选择。</p>}</Field>
      <Field label="接受后续委派"><Seg options={[{ value: 'true', label: '启用' }, { value: 'false', label: '停用' }]} value={f.enabled} onChange={v => formSet('enabled', v)} /></Field>
    </fieldset>}
  </Modal>;
}
