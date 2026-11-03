import { useEffect, useState } from 'react';
import { useStore } from '@/state/store';
import { Btn } from '@/shared/ui/Button';
import { Markdown } from '@/shared/ui/Markdown';
import { loadAgents, usable } from '@/features/settings/runtime/agents';
import { loadAssistants } from '@/features/personal/runtime/catalog';
import { readDocument } from '@/features/personal/runtime/memory';
import { PROFILE_TEMPLATES, profileGuard, readProfile, saveProfile, type Profile } from '../runtime/profiles';
import { applyPersonalProfile } from '../runtime/personalProfile';
export function ProfileEditor({ initial = PROFILE_TEMPLATES[0] }: { initial?: Profile }) {
  const s = useStore();
  const [target, setTarget] = useState('pc'), [name, setName] = useState(initial.name), [rules, setRules] = useState(initial.rules);
  const [preview, setPreview] = useState<{target:string; profile:Profile; before:string; previous?: Profile|null}>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  let assistants: ReturnType<typeof loadAssistants>['items'] = [], catalogError = '';
  if (s.cloud === 'signed-in') { try { assistants = loadAssistants().items; } catch (e) { catalogError = e instanceof Error ? e.message : '无法读取助理'; } }
  useEffect(() => { if (!s.agentCatalog) void loadAgents().catch(e => setError(String(e))); }, []);
  const run = async (f: () => Promise<void>) => { const current = profileGuard(); setBusy(true); setError(''); setNotice(''); try { await f(); } catch (e) { if (current()) setError(e instanceof Error ? e.message : '配置失败'); } finally { setBusy(false); } };
  const prepare = () => run(async () => {
    const profile = {name: name.trim(), rules: rules.trim()};
    if (!profile.name || !profile.rules || profile.rules.length > 12000) throw new Error('请填写名称与规则，规则最多 12000 字符');
    const current = profileGuard(), a = assistants.find(a => `pa:${a.id}` === target);
    if (target.startsWith('pa:') && !a) throw new Error('助理已不可用');
    const data = a ? undefined : readProfile(target);
    const before = a ? await readDocument(a, 'AGENTS.md') : JSON.stringify(data);
    if (current()) setPreview({target, profile, before, previous:data?.previous});
  });
  const apply = (remove = false, restore = false) => run(async () => {
    if (!preview || preview.target !== target) throw new Error('请重新预览');
    const current = profileGuard(), a = assistants.find(a => `pa:${a.id}` === target);
    if (target.startsWith('pa:') && !a) throw new Error('助理已不可用');
    if (a) await applyPersonalProfile(a, preview.before, remove ? null : preview.profile);
    else saveProfile(target, restore ? preview.previous ?? null : remove ? null : preview.profile, preview.before);
    if (current()) { setPreview(undefined); setNotice(a ? '已写入助理工作规则，下一次读取文档时使用。原有文档正文已保留。' : '已保存，新建任务时使用此配置。已有任务保持原配置。'); }
  });
  const change = () => { setPreview(undefined); setNotice(''); };
  return <><h2>专业智能体配置</h2><p className="muted">配置职责、表达、流程与验收标准。工具和技能仍由实际安装与授权决定。</p>
    {(error || catalogError) && <p role="alert">{error || catalogError}</p>}{notice && <p role="status">{notice}</p>}
    <label>应用到<select className="input" disabled={busy} value={target} onChange={e => {setTarget(e.target.value);change();}}><option value="pc">Lom · 新建任务</option>{(s.agentCatalog || []).filter(usable).map(a => <option key={a.id} value={`ag:${a.id}`}>{a.name} · 新建任务</option>)}{assistants.map(a => <option key={a.id} value={`pa:${a.id}`}>{a.name} · Personal Agent</option>)}</select></label>
    <label>角色模板<select className="input" disabled={busy} value={PROFILE_TEMPLATES.some(t=>t.name===name)?name:''} onChange={e=>{const t=PROFILE_TEMPLATES.find(t=>t.name===e.target.value);if(t){setName(t.name);setRules(t.rules);change();}}}><option value="">自定义配置</option>{PROFILE_TEMPLATES.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}</select></label>
    <label>配置名称<input className="input" value={name} maxLength={80} disabled={busy} onChange={e => {setName(e.target.value);change();}} /></label>
    <label>工作规则<textarea className="textarea" rows={10} value={rules} maxLength={12000} disabled={busy} onChange={e => {setRules(e.target.value);change();}} /></label>
    <Btn label={busy ? '正在处理…' : '预览配置'} disabled={busy} onClick={() => void prepare()} />
    {preview && <section className="card"><details><summary>查看现有工作配置</summary><div className="msg__text"><Markdown text={target.startsWith('pa:') ? preview.before : (JSON.parse(preview.before).current?.rules || '尚未配置')} /></div></details><h3>{preview.profile.name}</h3><div className="msg__text"><Markdown text={preview.profile.rules} /></div><p>确认后更新所选目标的专业配置。Personal Agent 保留现有工作规则正文；不复制记忆、聊天或账号信息。</p>
      <div className="row"><Btn label="应用配置" disabled={busy} onClick={() => void apply()} /><Btn label="停用专业配置" disabled={busy} onClick={() => void apply(true)} />{!target.startsWith('pa:') && preview.previous !== undefined && <Btn label="恢复上一版" disabled={busy} onClick={() => void apply(false,true)} />}</div></section>}
  </>;
}
