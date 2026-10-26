import { formSet } from '@/features/schedules/actions/schedule';
import { saveUpload } from '../actions/skills';
import { unavailable } from '@/shared/lib/unavailable';
import { closeModal } from '@/shared/overlays/controller';
import { Btn, Dropdown } from '@/shared/ui/Button';
import { Seg } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Field, Input, SkillIcon } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { agent, installedOn, skill } from '@/state/selectors';
import { S } from '@/state/store';

type P = Record<string, unknown>;

export function SkillModal({ p }: { p: P }) {
  const k = skill(String(p.id));
  if (!k) return null;
  const on = installedOn(k.id);
  return (
    <Modal title={k.name} desc={`${k.author} · ${k.target === 'phone' ? '手机技能' : '电脑技能'} · ${k.installs} 次安装 · ★ ${k.rating}`} size="lg" headExtra={<SkillIcon skill={k} />}
      foot={<><Btn label="关闭" variant="secondary" onClick={closeModal} /><Dropdown label="安装到…" menu="install" ctx={{ id: k.id, key: `insm${k.id}` }} align="end" variant="primary" /></>}>
      <div className="readme">
        <p>{k.desc}</p>
        <h4>它能做什么</h4>
        <ul><li>按你的人格和语气工作</li><li>执行前展示计划，对外发布前请求确认</li><li>失败时向总指挥求助，由总指挥接管完成</li></ul>
        <h4>需要的权限</h4>
        <p>{k.target === 'phone' ? '无障碍（读取界面、点击、输入）、相册读写' : '读写所选工作文件夹、联网'}</p>
        <h4>安装示例（非实际安装状态）</h4>
        <p>{on.length ? on.map(a => agent(a)?.name).join('、') : '还没有安装'}</p>
      </div>
    </Modal>
  );
}

export function UploadModal({ p }: { p: P }) {
  const f = S.form;
  return (
    <Modal title={p.id ? '编辑技能' : '上架我的技能'} desc="技能上传和审核尚未接入。此表单仅供预览，不会提交到技能市场。" size="lg"
      foot={<><Btn label="取消" variant="secondary" onClick={closeModal} /><Btn label="提交审核" variant="primary" onClick={saveUpload} disabled={!f.name || !f.file} /></>}>
      <Field label="技能名称" req><Input bind="form.name" placeholder="例如：口红测评模板" autoFocus /></Field>
      <Field label="一句话介绍"><Input bind="form.desc" placeholder="它能帮别人做什么" /></Field>
      <Field label="适用于"><Seg options={[{ value: 'phone', label: '手机' }, { value: 'pc', label: '电脑' }]} value={f.target} onChange={v => formSet('target', v)} /></Field>
      <Field label="技能文件">
        <button type="button" className="dropzone" style={{ width: '100%' }} onClick={() => unavailable('技能文件上传')}>
          <Icon name="upload" /><div>技能文件上传暂未接入</div>
        </button>
      </Field>
      <Field label="公开范围"><Seg options={[{ value: 'public', label: '所有人' }, { value: 'link', label: '仅链接可见' }]} value={f.vis} onChange={v => formSet('vis', v)} /></Field>
    </Modal>
  );
}
