import { closeModal } from '@/shared/overlays/controller';
import { saveCustomAgent } from '../actions/agents';
import { Btn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { Field, Input, Textarea } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { S } from '@/state/store';

/* ===== 添加自定义 Agent：任何支持 ACP 协议的命令行 Agent，先试连再保存 ===== */
export function CustomAgentModal() {
  const f = S.form;
  return (
    <Modal title="添加自定义 Agent" desc="填写一个支持 ACP 协议的命令行 Agent。保存前会先试着启动并握手一次，不会发送对话。" size="sm"
      foot={<><Btn label="取消" variant="secondary" onClick={closeModal} /><Btn label={f.saving ? '正在测试…' : '测试并添加'} variant="primary" onClick={() => void saveCustomAgent()} disabled={!String(f.name || '').trim() || !String(f.command || '').trim() || f.saving} /></>}>
      <Field label="名称" req><Input bind="form.name" placeholder="例如：我的 Agent" autoFocus /></Field>
      <Field label="命令" req hint="可执行文件的名称或绝对路径，例如 /usr/local/bin/my-agent"><Input bind="form.command" placeholder="my-agent" /></Field>
      <Field label="参数" hint="用空格分隔，例如 --acp"><Input bind="form.args" placeholder="--acp" /></Field>
      <Field label="环境变量" hint="每行一个 KEY=VALUE；密钥只保存在本机核心里"><Textarea bind="form.env" rows={3} mono placeholder="MY_AGENT_MODE=acp" /></Field>
      {f.error && <p className="form-error"><Icon name="info" />{f.error}</p>}
    </Modal>
  );
}
