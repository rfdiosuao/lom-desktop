import { cloudConfigured, CLOUD_UNAVAILABLE } from '@/features/account/runtime/serviceConfig';
import { PhoneFilesModal } from './PhoneFiles';
import { closeModal } from '@/shared/overlays/controller';
import { gotoPhonePage, openSettings } from '@/app/navigation';
import { renamePhone, revokePC, saveMemory, unpair } from '../actions/phone';
import { pairClosed, pairRefresh, pairSignedIn, pairTab, pairTick } from '../actions/pairing';
import { toast } from '@/shared/overlays/controller';
import { Avatar } from '@/shared/ui/Agent';
import { Btn, Dropdown } from '@/shared/ui/Button';
import { Badge, Spinner, Tabs } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Field, IconTile, ListRow, Section, SettingCard, SettingRow, Textarea } from '@/shared/ui/Layout';
import { Modal } from '@/shared/ui/Overlay';
import { useEffect, useState } from 'react';
import { agent, personaOf, phone, skill, phoneModelName } from '@/state/selectors';
import { S } from '@/state/store';
import { ago } from '@/shared/lib/util';

/* ===== 弹窗：手机相关（子代理、记忆、发送文件、设备管理、配对） ===== */

type P = Record<string, unknown>;

export { SubModal } from './SubModal';

export function MemoryModal({ p }: { p: P }) {
  return (
    <Modal title={p.id ? '编辑记忆' : '添加记忆'} desc={phone().real ? `${phone().name} 会在以后的对话中用到这条信息。` : "示例记忆仅保留在当前界面，不会同步到真实手机。"}
      foot={<><Btn label="取消" variant="secondary" onClick={closeModal} /><Btn label="保存" variant="primary" onClick={saveMemory} disabled={!S.form.text} /></>}>
      <Field label="内容"><Textarea bind="form.text" placeholder="例如：发布时间固定在晚上 8 点。" rows={4} /></Field>
    </Modal>
  );
}

/* 发送文件到手机：列出工作文件夹里的文件（演示：传输在手机端接入后生效） */
export function SendFilesModal({ p }: { p: P }) {
  const a = agent(String(p.phone));
  if (!a) return null;
  return a.real ? <PhoneFilesModal device={a.id} /> : <Modal title="演示手机" desc="请连接真实手机后传输文件。" foot={<Btn label="关闭" onClick={closeModal} />} />;
}

export function DeviceModal({ p }: { p: P }) {
  const a = agent(String(p.id));
  if (!a) return null;
  return (
    <Modal title={`管理 ${a.name}`} desc={a.real ? `${a.device || '手机'} · ${a.status === 'online' ? '在线' : '离线'}` : `${a.device} · ${a.network} · 电量 ${a.battery}%`} size="lg" headExtra={<Avatar agent={a} size="lg" status />}
      foot={<><Btn label="解除配对" ic="trash" variant="danger-ghost" onClick={() => unpair(a.id)} /><span className="grow" /><Btn label="完成" variant="primary" onClick={closeModal} /></>}>
      <SettingCard>
        <SettingRow title="名称" desc={a.name} control={<Btn label="重命名" variant="secondary" size="sm" onClick={() => renamePhone(a.id)} />} />
        <SettingRow title="人格" desc={personaOf(a)} control={<Btn label="编辑 SOUL.md" variant="secondary" size="sm" onClick={() => gotoPhonePage(a.id, 'phone-soul')} />} />
        <SettingRow title="手机模型" desc="这台手机执行任务用的模型；不单独选择时用「设置 → 模型与额度」里的手机默认模型。发任务时同步到手机。" control={<Dropdown label={phoneModelName(a.model || S.phoneModel)} menu="model" ctx={{ agent: a.id, key: `dm${a.id}` }} variant="secondary" size="sm" />} />
        <SettingRow title="技能" desc={(S.installed[a.id] || []).map(id => skill(id)?.name).join('、') || '未安装'} control={<Btn label="管理技能" variant="secondary" size="sm" onClick={() => gotoPhonePage(a.id, 'phone-skills')} />} />
      </SettingCard>
      <div style={{ height: 18 }} />
      <Section title="可以指挥它的电脑" hint="同一账户登录的电脑都能看到这台手机；手机上也可以逐个撤销。">
        <div className="list">{(S.authorizedPCs[a.id] || []).map(c => (
          <ListRow key={c.id} lead={<IconTile ic="monitor" />} title={c.name} titleExtra={c.current ? <Badge text="当前" tone="ok" /> : null} sub={`授权于 ${ago(c.at)}`}
            actions={c.current ? null : <Btn label="撤销" variant="danger-ghost" size="sm" onClick={() => revokePC(c.id, a.id)} />} />
        ))}</div>
      </Section>
    </Modal>
  );
}

function Countdown({ expires }: { expires: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const left = Math.max(0, expires - now), m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  return <span className="muted">{left > 0 ? `· ${m}:${String(s).padStart(2, '0')} 后过期` : '· 已过期，请刷新'}</span>;
}

/* 添加手机（R01）：真实二维码与配对码；手机确认后才显示「已连接」 */
export function PairModal({ p }: { p: P }) {
  useEffect(() => {
    const t = window.setInterval(() => { void pairTick(); }, 1000);
    return () => { window.clearInterval(t); pairClosed(); };
  }, []);
  if (!cloudConfigured()) return <Modal title="手机连接暂不可用" desc={CLOUD_UNAVAILABLE} foot={<Btn label="关闭" onClick={closeModal} />} />;
  const stage = String(p.stage);
  if (stage === 'done') {
    const a = agent(String(p.newId));
    return (
      <Modal title={null} foot={<><span className="modal__foot-note"><Icon name="shield" />手机只连接麓鸣云端，不需要同一个 Wi-Fi</span><Btn label="完成" variant="primary" onClick={closeModal} /></>}>
        <div className="pair" style={{ paddingTop: 26 }}>
          <div className="pair__done"><Icon name="check" /></div>
          {p.warn ? <p className="section__hint">{String(p.warn)}</p> : null}
          <h2 className="modal__title">{a?.name || String(p.deviceName)} 已连接</h2>
          <p className="modal__desc">配对已完成，设备卡片已出现在首页。<br />手机在线时可以远程对话、同步人格和记忆、给手机发文件、管理手机技能；部分功能需要手机端升级到最新版。</p>
        </div>
      </Modal>
    );
  }
  const qr = p.tab === 'qr';
  const waiting = stage === 'waiting';
  return (
    <Modal title={null} foot={<><span className="modal__foot-note"><Icon name="shield" />配对后，可为这台手机设置人格、技能和独立记忆</span><Btn label="取消" variant="secondary" onClick={closeModal} /></>}>
      <div className="pair" style={{ paddingTop: 20 }}>
        <div className="pair__symbol"><Icon name="phone" /><span className="pair__plus"><Icon name="plus" /></span></div>
        <h2 className="modal__title">添加手机</h2>
        <p className="modal__desc">连接手机，创建它的独立 Agent · 不需要同一个 Wi-Fi</p>
        {stage === 'signin' && <>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-2)', marginTop: 18 }}>手机会加入你的麓鸣账户，请先登录 HEANG 账号。</p>
          <Btn label="登录 HEANG 账号" ic="user" variant="primary" onClick={() => void pairSignedIn()} />
        </>}
        {stage === 'limit' && <>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-2)', marginTop: 18 }}>
            当前订阅只能接入 {String(p.max)} 台手机（已接入 {String(p.used)} 台）。<br />升级订阅可以接入更多；也可以先移除一台不用的手机。
          </p>
          <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
            <Btn label="查看订阅" ic="crown" variant="primary" onClick={() => { closeModal(); openSettings('account'); }} />
            <Btn label="管理手机" ic="phone" variant="secondary" onClick={() => { closeModal(); openSettings('connections'); }} />
          </div>
        </>}
        {stage === 'loading' && <div className="waiting"><Spinner />正在生成配对码…</div>}
        {stage === 'error' && <>
          <p className="form-error" style={{ marginTop: 18 }}>{String(p.error)}</p>
          <Btn label="重新生成" ic="refresh" variant="secondary" onClick={() => void pairRefresh()} />
        </>}
        {(waiting || stage === 'scanned' || stage === 'sas') && <>
          <div style={{ marginTop: 16 }}><Tabs items={[{ value: 'qr', label: '扫码连接' }, { value: 'code', label: '配对码连接' }]} value={String(p.tab)} onChange={pairTab} fill /></div>
          {stage === 'sas' ? <>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-2)', marginTop: 14 }}><b>{String(p.deviceName)}</b> 输入了配对码。请确认手机上显示的确认码与下面一致，然后在手机上点「确认连接」</p>
            <div className="code-display">{String(p.sas).replace(/^(\d{3})(\d{3})$/, '$1 $2')}</div>
            <p className="section__hint">不一致时请点「取消」，不要在手机上确认。</p>
          </> : stage === 'scanned' ? (
            <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-2)', marginTop: 14 }}><b>{String(p.deviceName)}</b> 已扫码，配对信息核对通过<br />请在手机上点「确认连接」</p>
          ) : qr ? <>
            <div className="qr qr--live"><img className="qr__img" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(p.qrSvg))}`} alt="配对二维码" /></div>
            <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-2)', marginTop: 14 }}>在手机端打开 <b>Lom</b>，点首页右上角的连接图标，选「扫一扫」<br />在手机上点「确认连接」即可完成</p>
          </> : <>
            <div className="code-display">{String(p.code)}</div>
            <Btn label="复制配对码" ic="copy" variant="link" size="sm" onClick={() => { void navigator.clipboard?.writeText(String(p.code)); toast('配对码已复制'); }} />
            <p style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--text-2)', marginTop: 10 }}>在手机 Lom App 选择「配对码」，输入上面 8 位码<br />两端会显示相同的 6 位确认码，核对一致后在手机上确认</p>
          </>}
          <div className="waiting"><Spinner />{stage === 'waiting' ? '等待手机扫码或输入配对码…' : '等待手机确认…'} <Countdown expires={Number(p.expires)} /></div>
          {p.warn ? <p className="section__hint">{String(p.warn)}</p> : null}
          <div className="row" style={{ justifyContent: 'center', gap: 6 }}>
            <Btn label={qr ? '刷新二维码' : '换一个配对码'} ic="refresh" variant="link" size="sm" onClick={() => void pairRefresh()} />
          </div>
        </>}
      </div>
    </Modal>
  );
}
