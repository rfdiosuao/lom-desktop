import { cloudConfigured, CLOUD_UNAVAILABLE } from '@/features/account/runtime/serviceConfig';
import { t } from '@/shared/i18n/index';
import { chime } from '@/app/sound';
import { toastError } from '@/shared/overlays/controller';
import { pair, manageDevice, reconnect, unpair } from '@/features/phones/actions/phone';
import { resetLayout, setTheme } from '@/app/shell/layout';
import { openMenu } from '@/shared/overlays/controller';
import { addKey, auditLog, checkUpdate, clearCache, deleteKey, editProfile, exportData, feedback, logout, recharge, resetDemo, settingsPage, shortcuts, testKey, togglePref } from '../actions/settings';
import { Avatar } from '@/shared/ui/Agent';
import { Btn, Dropdown, IconBtn } from '@/shared/ui/Button';
import { Badge, Dot, Seg, Toggle } from '@/shared/ui/Controls';
import { PENDING_PREFERENCES } from '@/shared/lib/unavailable';
import { IconTile, ListRow, PageHead, Section, SettingCard, SettingRow } from '@/shared/ui/Layout';
import { isBuiltin } from '@/features/account/runtime/builtin';
import { signIn, repairBuiltin } from '@/features/account/runtime/cloud';
import { currentPcModel, perm, personaOf, phones, phoneModelName } from '@/state/selectors';
import { useStore } from '@/state/store';
import { ago, prettyPath } from '@/shared/lib/util';
import { Page } from '@/shared/ui/Page';
import { MyPlan } from '@/features/account/ui/SettingsPlans';
import { AgentsPage } from './SettingsAgents';
import { NoticeSection } from '@/features/account/ui/Notices';
import { planLabel } from '@/features/account/runtime/plans';
import { projectLink } from '../actions/settings';

/* ===== 设置 ===== */

/** 已接入的偏好显示真开关；未接入的如实标注，不能伪装成已生效 */
function Sw({ k, label }: { k: string; label: string }) {
  const s = useStore();
  if (PENDING_PREFERENCES[k]) return <span aria-label={`${label}暂未接入`}><Badge text="暂未接入" /></span>;
  return <Toggle on={!!s.prefs[k]} onChange={() => togglePref(k)} label={label} />;
}

function Account() {
  const s = useStore();
  const a = s.account;
  if (!cloudConfigured()) return <><PageHead title="开源社区版账号" desc={CLOUD_UNAVAILABLE} /><SettingCard><SettingRow title="自带 API Key" desc="通用任务直接使用本机核心和你配置的模型服务。" control={<Btn label="配置模型" onClick={() => settingsPage('models')} />} /></SettingCard></>;
  return <>
    <PageHead title="账号" desc="用 HEANG 账号登录麓鸣。手机不需要登录，配对后自动归属这个账号，积分也一起共享。" />
    <div className="card row" style={{ gap: 16, marginBottom: 22 }}>
      <Avatar agent={{ kind: 'user', avatar: a?.avatar, name: a?.name || a?.email || '未' }} size="lg" />
      <div className="grow">
        <b style={{ fontSize: 16 }}>{a ? a.name || a.email : '未登录'}</b>
        <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>{a ? `${a.email || 'HEANG 账号'} · ${planLabel()}` : '登录后可以使用 Lom 云端模型和每月赠送的积分'}</div>
      </div>
      {a
        ? <Btn label="编辑资料" variant="secondary" size="sm" onClick={editProfile} />
        : <Btn label={s.cloud === 'signing-in' ? '正在登录…' : '登录 HEANG 账号'} ic="person" variant="primary" size="sm" onClick={() => void signIn()} disabled={s.cloud === 'signing-in'} />}
    </div>
    {s.cloudError && <p className="form-error" style={{ marginBottom: 16 }}>{s.cloudError}</p>}
    <MyPlan />
    {a && (
      <Section title="登录与安全">
        <SettingCard>
          <SettingRow title="已登录的电脑" desc="这台电脑（当前）" control={<Btn label="管理" variant="secondary" size="sm" onClick={() => settingsPage('security')} />} />
          <SettingRow title="退出登录" desc="退出不会解除手机配对，再次登录后可继续指挥。" control={<Btn label="退出登录" variant="danger-ghost" size="sm" onClick={logout} />} />
        </SettingCard>
      </Section>
    )}
  </>;
}

function General() {
  const s = useStore();
  return <>
    <PageHead title="通用" />
    <Section title="外观">
      <SettingCard>
        <SettingRow title="主题" desc="跟随系统或手动选择。" control={<Seg options={[{ value: 'light', label: '浅色', ic: 'sun' }, { value: 'dark', label: '深色', ic: 'moon' }, { value: 'system', label: '跟随系统', ic: 'monitor' }]} value={s.theme} onChange={setTheme} />} />
        <SettingRow title="界面语言" control={<Dropdown label={String(s.prefs.lang)} menu="lang" variant="secondary" size="sm" />} />
        <SettingRow title="重置面板布局" desc="把左右栏宽度恢复为默认值。" control={<Btn label="恢复默认" variant="secondary" size="sm" onClick={resetLayout} />} />
      </SettingCard>
    </Section>
    <Section title="启动与提醒">
      <SettingCard>
        <SettingRow title="开机自动启动" control={<Sw k="launchAtLogin" label="开机自动启动" />} />
        <SettingRow title="任务完成提示音" desc="任务在后台完成时轻响一声（正在看的任务不响）。" control={<div className="row"><Btn label="试听" size="sm" onClick={() => void chime().catch(e => toastError('播放失败', e))} /><Sw k="sound" label="提示音" /></div>} />
        <SettingRow title="快捷键" desc="⌘K 搜索 · ⌘N 新任务 · ⌘B 侧栏 · ⌘⌥B 工作区" control={<Btn label="查看全部" variant="secondary" size="sm" onClick={shortcuts} />} />
      </SettingCard>
    </Section>
  </>;
}

function Models() {
  const s = useStore();
  const p = s.points;
  const monthly = 300;
  const own = s.providers.filter(p => !isBuiltin(p));
  const builtinReady = s.cloud === 'signed-in' && s.providers.some(p => isBuiltin(p) && p.enabled);
  return <>
    <PageHead title="模型与额度" desc={cloudConfigured() ? "配置模型服务和额度。" : "开源版使用你自己的 API Key。账号积分与内置云模型后端未包含。"} actions={cloudConfigured() ? <Btn label="充值积分" ic="wallet" variant="primary" onClick={recharge} /> : undefined} />
    {cloudConfigured() && <div className="card" style={{ marginBottom: 22 }}>
      {p ? <>
        <div className="quota">
          <div><div className="muted" style={{ fontSize: 14 }}>剩余积分</div><div className="quota__num">{p.total} 点</div></div>
          <div className="grow" />
          <div className="muted" style={{ fontSize: 13, textAlign: 'right' }}>{p.daily ? `今日额度 ${p.daily} · ` : ''}赠送 {p.free} · 充值 {p.paid}<br />{p.daily ? '今日额度每天 0 点重置，' : ''}赠送积分每月 1 日重置</div>
        </div>
        <div className="progress" style={{ marginTop: 12 }}><div className="progress__bar" style={{ width: `${Math.min(100, Math.round(((monthly - p.free) / monthly) * 100))}%` }} /></div>
        <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>{p.daily ? '先扣今日额度，再扣赠送积分，最后扣充值积分。' : '先扣赠送积分，再扣充值积分。'}手机使用的积分也从这个账号扣除。{s.cloudError ? ` 暂时无法连接麓鸣服务，显示的是上次的结果。` : ''}</div>
      </> : (
        <div className="quota">
          <div><div className="muted" style={{ fontSize: 14 }}>积分</div><div className="quota__num" style={{ fontSize: 20 }}>登录后查看</div></div>
          <div className="grow" />
          <Btn label={s.cloud === 'signing-in' ? '正在登录…' : '登录 HEANG 账号'} ic="person" variant="secondary" size="sm" onClick={() => void signIn()} disabled={s.cloud === 'signing-in'} />
        </div>
      )}
    </div>}
    {cloudConfigured() && <Section title="Lom 内置模型" hint="内置服务始终保留，不能删除。登录后自动连接，退出登录后暂停使用。">
      <SettingCard><SettingRow title="Lom Pro · Max · Mini" desc={builtinReady ? '已连接 · 使用当前账号积分，无需填写 API Key' : '登录账号后自动启用；已删除的配置会自动恢复。'} control={builtinReady ? <Badge text="内置 · 已连接" tone="ok" /> : <Btn label={s.cloud === 'signed-in' ? '恢复连接' : '登录启用'} variant="secondary" size="sm" onClick={() => void repairBuiltin()} disabled={s.cloud === 'signing-in'} />} /></SettingCard>
    </Section>}
    <Section title="默认模型">
      <SettingCard>
        <SettingRow title="电脑主控（总指挥）" desc="大模型，负责创作、规划和接管手机。" control={<Dropdown label={currentPcModel()?.name ?? '登录或添加 API Key'} menu="model" ctx={{ agent: 'pc', key: 'mdpc' }} variant="secondary" size="sm" />} />
        <SettingRow title="手机 Agent" desc="手机执行任务默认用的模型（建议小模型，便宜快速）；发任务时同步到手机。" control={<Dropdown label={phoneModelName(s.phoneModel)} menu="model" ctx={{ agent: 'phones', key: 'mdph' }} variant="secondary" size="sm" />} />
      </SettingCard>
    </Section>
    <Section title="自带 API Key" hint="自带 Key 是可选项，调用不消耗平台额度。Key 由本机核心服务加密保存，不会上传到麓鸣服务器。">
      <div className="list">
        {own.length ? own.map(p => (
          <ListRow key={p.id} lead={<IconTile ic="key" />} title={p.name} titleExtra={p.enabled ? <Badge text="可用" tone="ok" /> : <Badge text="已停用" />}
            sub={`${p.models.slice(0, 3).join('、')}${p.models.length > 3 ? ` 等 ${p.models.length} 个模型` : ''} · ${prettyPath(p.base_url)} · 添加于 ${ago(p.created_at)}`}
            actions={<><Btn label="测试" variant="ghost" size="sm" onClick={() => void testKey(p.id)} /><IconBtn ic="trash" label="删除" onClick={() => deleteKey(p.id)} /></>} />
        )) : <div className="list-row muted">{s.conn === 'ready' ? '还没有添加自带 Key。也可以直接使用上方的 Lom 内置模型。' : '核心服务未连接，无法读取模型服务'}</div>}
      </div>
      <div style={{ marginTop: 10 }}><Btn label="添加模型" ic="plus" variant="secondary" size="sm" onClick={addKey} disabled={s.conn !== 'ready'} /></div>
    </Section>
  </>;
}

function Connections() {
  const s = useStore();
  return <>
    <PageHead title="手机与连接" desc="管理配对设备、连接方式与实时画面。手机和电脑不需要在同一网络。" actions={<Btn label="添加手机" ic="plus" variant="primary" onClick={pair} />} />
    <Section title="已配对手机" extra={<Badge text={String(phones().length)} />} hint="真实手机支持会话、人格、记忆和技能同步；子代理管理尚未接入。">
      <div className="list">{phones().map(p => (
        <ListRow key={p.id} lead={<Avatar agent={p} status />} title={p.name} sub={`${personaOf(p)} · ${p.device}`}
          meta={p.status === 'online' ? <span className="row"><Dot />在线 · {p.network || '网络未知'}</span> : <span className="row"><Dot status="offline" />离线 · {ago(p.lastSeen)}</span>}
          actions={<>
            <Btn label={p.status === 'online' ? '管理' : '重新连接'} variant="secondary" size="sm" onClick={() => (p.status === 'online' ? manageDevice(p.id) : reconnect(p.id))} />
            <IconBtn ic="more" label={`${p.name}更多选项`} onClick={e => openMenu('device', e.currentTarget, { id: p.id, key: `dv${p.id}`, align: 'end' })} />
          </>} />
      ))}</div>
    </Section>
    <Section title="连接与画面">
      <SettingCard>
        <SettingRow title="断线自动重连" desc="自动恢复电脑端画面和内容同步；不改变手机系统后台限制。" control={<Sw k="reconnect" label="断线自动重连" />} />
        <SettingRow title="画面清晰度" desc="调整手机实时画面的显示质量。" control={<Dropdown label={s.quality} menu="quality" variant="secondary" size="sm" ctx={{ key: 'qset' }} />} />
        <SettingRow title="移动网络省流" desc="手机处于计费网络时，将截图长边限制为 480 像素，每次至少间隔 2 秒（需新版手机端）。" control={<Sw k="cellularCap" label="移动网络省流" />} />
        <SettingRow title="连接通知" desc="手机上线或断开时，在应用内提醒我。" control={<Sw k="notify" label="连接通知" />} />
      </SettingCard>
    </Section>
  </>;
}

function AgentDefaults() {
  const s = useStore();
  return <>
    <PageHead title="Agent 默认配置" desc="总指挥和手机 Agent 的协作方式。" />
    <Section title="大小模型协作">
      <SettingCard>
        <SettingRow title="手机任务失败时辅助接管" desc="委派任务明确失败并停止后，总指挥检查并处理原任务范围内的障碍。可能调用模型；断线和超时不自动接管。" control={<Sw k="autoTakeover" label="自动接管" />} />
        <SettingRow title="求助通知" desc="手机任务明确失败、超时或被中断时，在应用内提醒我。" control={<Sw k="notifyHelp" label="求助通知" />} />
        <SettingRow title="监工频率" desc="应用运行时检查已委派手机任务的实际状态；检查本身不调用模型。" control={<Dropdown label={Number(s.prefs.supervise) ? `每 ${s.prefs.supervise} 分钟` : '关闭'} menu="supervise" variant="secondary" size="sm" />} />
      </SettingCard>
    </Section>
    <Section title="发布安全">
      <SettingCard>
        <SettingRow title="对外发布前确认" desc="每轮向电脑和手机 Agent 发送规则：展示内容并等你确认后再发布。这是 Agent 行为规则，不是系统级拦截。" control={<Sw k="confirmPublish" label="发布前确认" />} />
        <SettingRow title="默认权限模式" desc="新任务输入框里的默认权限。" control={<Dropdown label={perm(s.permission).name} menu="permission" variant="secondary" size="sm" ctx={{ key: 'permset' }} />} />
      </SettingCard>
    </Section>
  </>;
}

function Security() {
  const s = useStore();
  return <>
    <PageHead title="权限与安全" desc="所有电脑与手机之间的通信都端到端加密，麓鸣服务器只负责转发。" />
    <Section title="电脑上的操作">
      <SettingCard>
        <SettingRow title="安装软件与执行命令" desc="适用于内置总指挥的普通会话；完全访问会覆盖此设置。其他档位下，询问模式优先于全自动，禁止模式拒绝命令和写入。定时任务与外部 CLI 使用各自权限。" control={<Dropdown label={{ ask: '始终询问', allow: '跟随任务权限', deny: '禁止命令和写入' }[String(s.prefs.allowInstall)] || '始终询问'} menu="installPolicy" size="sm" variant="secondary" />} />
        <SettingRow title="操作审计日志" desc="记录真实工具调用的时间、类型和结果；不存命令正文、文件内容或密钥。" control={<Sw k="auditLog" label="审计日志" />} />
        <SettingRow title="查看审计日志" control={<Btn label="打开" variant="secondary" size="sm" onClick={auditLog} />} />
      </SettingCard>
    </Section>
    <Section title="配对授权" hint="这里只显示真实配对。撤销会解除该手机与账号的连接，手机上的数据保留。">
      <div className="list">{phones().filter(p => p.real).map(p => <ListRow key={p.id} lead={<IconTile ic="phone" />} title={p.name} sub={p.device}
        actions={<Btn label="撤销配对" variant="danger-ghost" size="sm" onClick={() => unpair(p.id)} />} />)}
        {!phones().some(p => p.real) && <div className="list-row muted">{t('暂无真实配对授权')}</div>}
      </div>
    </Section>
  </>;
}

function Data() {
  return <>
    <PageHead title="数据与备份" />
    <Section title="本机数据">
      <SettingCard>
        <SettingRow title="导出全部数据" desc="电脑任务、团队对话与设置导出为一个加密压缩包。" control={<Btn label="导出" ic="download" variant="secondary" size="sm" onClick={exportData} />} />
        <SettingRow title="清除缓存" desc="清除预览快照，不影响任务和设置。" control={<Btn label="清除" variant="secondary" size="sm" onClick={clearCache} />} />
        <SettingRow title="重置演示数据" desc="恢复手机、团队、定时任务的示例数据（电脑任务和模型服务不受影响）。" control={<Btn label="重置" variant="danger-ghost" size="sm" onClick={resetDemo} />} />
      </SettingCard>
    </Section>
    <Section title="手机数据">
      <SettingCard><SettingRow title="手机数据保存在哪里？" desc="会话、人格、技能、记忆、子代理以手机上的为准，桌面只是远程界面；解除配对后这些数据仍留在手机上。" /></SettingCard>
    </Section>
  </>;
}

function About() {
  return <>
    <PageHead title="关于 Lom" />
    <div className="card row" style={{ gap: 16, marginBottom: 22 }}>
      <img src="/logo.png" alt="" style={{ width: 56 }} />
      <div className="grow"><b style={{ fontSize: 18 }}>麓鸣 Lom</b><div className="muted" style={{ fontSize: 14, marginTop: 4 }}>版本 {__LOM_VERSION__}</div></div>
      <Btn label="检查更新" variant="secondary" size="sm" onClick={checkUpdate} />
    </div>
    <NoticeSection />
    <SettingCard>
      <SettingRow title="开源仓库" desc="如果 Lom 对你有帮助，欢迎在 GitHub 点个 Star，支持我们继续完善。" control={<Btn label="去 GitHub 点 Star" ic="external" variant="secondary" size="sm" onClick={() => projectLink('repository')} />} />
      <SettingRow title="官网文档" desc="查看快速上手、电脑与手机使用指南，以及常见问题。" control={<Btn label="阅读文档" ic="external" variant="secondary" size="sm" onClick={() => projectLink('documentation')} />} />
      <SettingRow title="开源许可" desc="桌面核心基于 AionCore（Apache-2.0）；手机端基于 OpenMinis（GPLv3）。" />
      <SettingRow title="反馈问题" desc="问题和建议直接发给麓鸣团队，回复在「我的反馈」里查看。" control={<Btn label="反馈" variant="secondary" size="sm" onClick={feedback} />} />
    </SettingCard>
  </>;
}

const PAGES: Record<string, () => React.ReactNode> = {
  account: Account, general: General, agents: AgentsPage, models: Models, connections: Connections, agent: AgentDefaults, security: Security, data: Data, about: About,
};

export function Settings() {
  const s = useStore();
  const P = PAGES[s.settingsPage] ?? Connections;
  return <Page><P /></Page>;
}
