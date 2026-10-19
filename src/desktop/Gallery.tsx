import { useCallback, useState } from 'react';
import { Btn, IconBtn } from './Button';
import { Badge, Kbd, Seg, Spinner, Tabs, Toggle, Typing } from './Controls';
import { HistoryIcon } from './HistoryIcon';
import { Empty, ListRow, PageHead, Section, SettingCard, SettingRow } from './Layout';
import { UploadMenu, type UploadSkill } from './UploadMenu';
import { RuntimePanel } from './RuntimePanel';
import './desktop.css';
import './gallery.css';

export function Gallery() {
  const [tab, setTab] = useState('controls'), [running, setRunning] = useState(false), [notice, setNotice] = useState('');
  const unavailable = useCallback(async (): Promise<{ skills: UploadSkill[]; warnings: string[] }> => {
    throw new Error('此独立工作台未配置技能发现适配器。这里没有示例技能或上传服务。');
  }, []);
  return <div className="desktop-kit gallery">
    <PageHead title="桌面组件" desc="从桌面产品提取的控件和本机 CLI 连接层。此页只验证界面交互，不模拟 AI 回复。" />
    <Tabs items={[{ value: 'controls', label: '控件与状态' }, { value: 'skills', label: '技能入口' }, { value: 'runtime', label: '本机 CLI' }]} value={tab} onChange={setTab} />
    {tab === 'controls' && <>
      <Section title="按钮与选择">
        <div className="kit-row"><Btn label="主要操作" variant="primary" onClick={() => setNotice('点击已触发')} /><Btn label="次要操作" /><IconBtn ic="plus" label="添加" onClick={() => setNotice('添加按钮已触发')} /><Kbd k="⌘ K" /></div>
        <Seg options={[{ value: 'stopped', label: '静止预览' }, { value: 'running', label: '运行预览' }]} value={running ? 'running' : 'stopped'} onChange={v => setRunning(v === 'running')} />
      </Section>
      <Section title="圆形头像与连续运行圈">
        <ListRow lead={<HistoryIcon src="/logo.png" name="Lom" lom running={running} />} title="最近任务" sub="仅预览动效；没有实际任务在运行" meta={<Badge text={running ? '动效预览' : '静止'} />} />
        <div className="kit-row"><Spinner /><span>旋转状态预览</span><Typing /></div>
        <SettingCard><SettingRow title="预览运行动效" desc="头像保持静止，外沿旋转；减少动态效果设置下不转动。" control={<Toggle label="预览运行动效" on={running} onChange={() => setRunning(!running)} />} /></SettingCard>
      </Section>
      <Empty title="尚未选择文档" desc="返回本地工作台可打开真实的文本或图片。" />
    </>}
    {tab === 'skills' && <Section title="双层上传菜单">
      <p>菜单来自桌面端。公开组件通过回调接入本机发现、保留草稿和手动上传；云端审核、账号与上传服务不包含在这里。</p>
      <UploadMenu scopeKey="local-gallery" hasDraft={false} loadSkills={unavailable} onManual={() => setNotice('未配置手动上传适配器；没有发起上传。')} prepareDraft={async () => { throw new Error('未配置 Lom 草稿适配器'); }} />
    </Section>}
    {tab === 'runtime' && <RuntimePanel />}
    {notice && <p role="status">{notice}</p>}
  </div>;
}
