import { t } from '@/shared/i18n/index';
import { useRef, useState, type ReactNode } from 'react';
import { CountedInput, RadioGroup, SecretInput } from '@/shared/ui/Fields';
import { IconBtn } from '@/shared/ui/Button';
import { Field } from '@/shared/ui/Layout';
import { Toggle } from '@/shared/ui/Controls';
import { KEY_MAX, NAME_MAX, UNGROUPED, type MachineForm } from '../runtime/sshMachineForm';
import { GROUP_MAX, NOTE_MAX } from '../runtime/sshServers';

interface Props { form: MachineForm; set: (patch: Partial<MachineForm>) => void; disabled: boolean; editing: boolean; canStore: boolean; groups: string[]; fail: (message: string) => void }

const AUTHS = [{ value: 'password' as const, label: '密码' }, { value: 'key' as const, label: '密钥' }];

function KeyBox({ form, set, disabled, editing, fail }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const upload = async (picked?: File) => {
    if (!picked) return;
    if (picked.size > KEY_MAX) return fail(t('密钥文件过大，请选择 OpenSSH 或 PEM 私钥。'));
    try { set({ secret: await picked.text() }); } catch { fail(t('无法读取所选文件。')); }
  };
  return <>
    <Field inline label="密钥">
      <div className="affix affix--area">
        <textarea className="textarea textarea--mono" rows={5} value={form.secret} disabled={disabled} spellCheck={false} autoComplete="off" aria-label={t('密钥')}
          placeholder={editing ? t('已保存密钥；留空则保持不变，或粘贴新的密钥') : t('请粘贴密钥内容或点击上传按钮上传文件')} onChange={e => set({ secret: e.target.value })} />
        <IconBtn ic="plus" label="上传密钥文件" className="affix__corner" disabled={disabled} onClick={() => file.current?.click()} />
        <input ref={file} type="file" hidden onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </Field>
    <Field inline label="密钥密码">
      <SecretInput label="密钥密码" placeholder={t('请输入密钥密码（选填）')} value={form.passphrase} disabled={disabled} onChange={passphrase => set({ passphrase })} />
    </Field>
  </>;
}

const NEW_GROUP = '\u0000new';

/** 分组下拉：默认「未分组」，可选已有分组，或选「新建分组…」后输入新名称；分组随机器保存，没有机器使用后自然消失。 */
function GroupSelect({ form, set, disabled, groups }: Props) {
  const [creating, setCreating] = useState(false);
  const grouped = groups.includes(form.group) || !form.group ? groups : [...groups, form.group];
  const choose = (value: string) => { setCreating(value === NEW_GROUP); set({ group: value === NEW_GROUP ? '' : value }); };
  return <div className="ssh-machine__group">
    <select className="input" aria-label={t('分组')} value={creating ? NEW_GROUP : form.group} disabled={disabled} onChange={e => choose(e.target.value)}>
      <option value="">{t(UNGROUPED)}</option>
      {grouped.map(group => <option key={group} value={group}>{group}</option>)}
      <option value={NEW_GROUP}>{t('新建分组…')}</option>
    </select>
    {creating && <CountedInput label="新分组名称" placeholder={t('请输入新分组名称')} max={GROUP_MAX} value={form.group} disabled={disabled} onChange={group => set({ group })} />}
  </div>;
}

export function BasicFields(props: Props): ReactNode {
  const { form, set, disabled, editing, canStore } = props;
  return <>
    <Field inline label="机器名称"><CountedInput label="机器名称" placeholder="请输入机器名称" max={NAME_MAX} value={form.name} disabled={disabled} onChange={name => set({ name })} /></Field>
    <Field inline label="主机地址">
      <div className="ssh-machine__pair">
        <input className="input" aria-label={t('主机地址')} placeholder={t('Host地址')} value={form.host} disabled={disabled} maxLength={255} onChange={e => set({ host: e.target.value })} />
        <input className="input" aria-label={t('端口')} placeholder="22" inputMode="numeric" value={form.port} disabled={disabled} maxLength={5} onChange={e => set({ port: e.target.value })} />
      </div>
    </Field>
    <Field inline label="用户名"><input className="input" aria-label={t('用户名')} value={form.username} disabled={disabled} maxLength={64} onChange={e => set({ username: e.target.value })} /></Field>
    <Field inline label="验证方式" hint={canStore ? undefined : t('当前平台暂不支持保存密码或密钥，请在「高级选项」使用本机 SSH 配置。')}>
      {form.auth === 'system'
        ? <p className="ssh-machine__static">{t('沿用本机 SSH 配置（可在「高级选项」中更改）')}</p>
        : <RadioGroup label="验证方式" options={AUTHS} value={form.auth} disabled={disabled || !canStore} onChange={auth => set({ auth, secret: '', passphrase: '' })} />}
    </Field>
    {form.auth === 'password' && <Field inline label="密码">
      <SecretInput label="密码" placeholder={editing ? t('已保存密码；留空则保持不变') : t('请输入密码')} value={form.secret} disabled={disabled} onChange={secret => set({ secret })} />
    </Field>}
    {form.auth === 'key' && <KeyBox {...props} />}
    <Field inline label="分组"><GroupSelect {...props} /></Field>
    <Field inline label="备注"><CountedInput multiline label="备注" placeholder={t('请输入备注信息（选填）')} max={NOTE_MAX} value={form.note} disabled={disabled} onChange={note => set({ note })} /></Field>
  </>;
}

export function AdvancedFields({ form, set, disabled, canStore }: Props): ReactNode {
  return <>
    <Field inline label={t('沿用本机配置')} hint={t('开启后使用本机 SSH 配置里的别名、跳板和 ssh-agent 中的密钥，不保存密码或密钥。')}>
      <Toggle label="沿用本机 SSH 配置" on={form.auth === 'system'} disabled={disabled || (!canStore && form.auth === 'system')}
        onChange={() => set({ auth: form.auth === 'system' ? 'password' : 'system', secret: '', passphrase: '' })} />
    </Field>
    <Field inline label={t('连接策略')}>
      <p className="ssh-machine__static">{t('连接超时 8 秒，整体探测最长 15 秒；主机指纹必须已被本机信任；固定关闭代理转发和端口转发；测试连接只执行固定的 true 命令。')}</p>
    </Field>
  </>;
}
