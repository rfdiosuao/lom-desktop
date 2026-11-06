import { t } from '@/shared/i18n/index';
import { useEffect, useRef, useState } from 'react';
import { isWindowsShell } from '@/core/platform';
import { closeModal, guardClose, toast } from '@/shared/overlays/controller';
import { Btn } from '@/shared/ui/Button';
import { Tabs } from '@/shared/ui/Controls';
import { Modal } from '@/shared/ui/Overlay';
import { blankMachine, draftOf, machineFromRow, machineProblem, rowFromMachine, type MachineForm } from '../runtime/sshMachineForm';
import { saveMachine } from '../runtime/sshMachineSave';
import { loadSshServers, probeSshServer, sshErrorText, sshGroups, type SshServer } from '../runtime/sshServers';
import { AdvancedFields, BasicFields } from './SshMachineFields';
import './sshMachineModal.css';

const PROBLEM_ID = 'ssh-machine-problem';
type Tab = 'basic' | 'advanced';
type Outcome = { ok: boolean; text: string };

function knownGroups(account: string) {
  try { return sshGroups(loadSshServers(account)); } catch { return []; }
}

export function SshMachineModal({ p }: { p: Record<string, unknown> }) {
  const account = typeof p.account === 'string' ? p.account : 'local';
  const original = p.editing as SshServer | undefined;
  const canStore = !isWindowsShell();
  const [id] = useState(() => original?.id ?? crypto.randomUUID());
  const [form, setForm] = useState<MachineForm>(() => original ? machineFromRow(original) : { ...blankMachine(), auth: canStore ? 'password' : 'system' });
  const [groups] = useState(() => knownGroups(account));
  const [tab, setTab] = useState<Tab>('basic');
  const [busy, setBusy] = useState<'test' | 'save'>();
  const [outcome, setOutcome] = useState<Outcome>();
  const working = useRef(false);
  useEffect(() => {
    guardClose('sshMachine', () => !working.current);
    return () => guardClose('sshMachine', null);
  }, []);
  const set = (patch: Partial<MachineForm>) => { setForm(current => ({ ...current, ...patch })); setOutcome(undefined); };
  const problem = machineProblem(form, original);
  const testable = !machineProblem({ ...form, name: 'test' }, original);

  async function run(kind: 'test' | 'save', job: () => Promise<Outcome | void>) {
    if (working.current) return;
    working.current = true;
    setBusy(kind); setOutcome(undefined);
    try { const result = await job(); if (result) setOutcome(result); }
    catch (error) { setOutcome({ ok: false, text: sshErrorText(error) }); }
    finally { working.current = false; setBusy(undefined); }
  }
  const test = () => run('test', async () => {
    const started = performance.now();
    await probeSshServer(rowFromMachine(id, form, original), false, draftOf(form));
    return { ok: true, text: `${t('连接成功')} · ${Math.round(performance.now() - started)} ms` };
  });
  const save = () => run('save', async () => {
    await saveMachine(account, id, form, original);
    (p.onSaved as (() => void) | undefined)?.();
    toast(t(original ? '机器已保存' : '机器已添加'), 'check');
    closeModal(true);
  });
  const fields = { form, set, disabled: !!busy, editing: !!original, canStore, groups, fail: (text: string) => setOutcome({ ok: false, text }) };
  return <Modal title={original ? '编辑机器' : '添加机器'} className="ssh-machine"
    foot={<>
      <Btn label={busy === 'test' ? '正在连接…' : '测试连接'} ic="link" className="ssh-machine__test" disabled={!!busy || !testable} onClick={() => void test()} />
      <Btn label="取消" disabled={!!busy} onClick={closeModal} />
      <Btn label={busy === 'save' ? '保存中…' : original ? '保存' : '添加'} variant="primary" disabled={!!busy || !!problem} aria-describedby={problem ? PROBLEM_ID : undefined} onClick={() => void save()} />
    </>}>
    <Tabs value={tab} onChange={setTab} items={[{ value: 'basic', label: t('基本设置') }, { value: 'advanced', label: t('高级选项') }]} />
    <div className="ssh-machine__form">{tab === 'basic' ? <BasicFields {...fields} /> : <AdvancedFields {...fields} />}</div>
    {problem && <p id={PROBLEM_ID} className="ssh-machine__problem">{t(problem)}</p>}
    {outcome && <p role={outcome.ok ? 'status' : 'alert'} className={outcome.ok ? 'ssh-machine__ok' : 'form-error'}>{outcome.text}</p>}
  </Modal>;
}
