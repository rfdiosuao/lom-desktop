import { PhoneScreen } from '@/features/phones/ui/PhoneScreen';
import { PhonePlaceholder } from '@/shared/ui/PhonePlaceholder';
import { Modal } from '@/shared/ui/Overlay';
import { phone } from '@/state/selectors';
import { useStore } from '@/state/store';
import { PreviewFrame, WsFiles } from './Workspace';
import { WsChanges, WsPlan } from './WsActivity';

/* 全屏查看：预览 / 文件 / 手机画面 */
export function FullModal() {
  const s = useStore();
  const title = s.wsTab === 'phone' ? `${phone().name} · ${phone().real ? '手机画面' : '静态示例'}` : s.wsTab === 'files' ? '文件' : s.wsTab === 'plan' ? '计划' : s.wsTab === 'changes' ? '变更' : '作品预览';
  return (
    <Modal title={title} size="full">
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {s.wsTab === 'phone'
          ? phone().real ? <PhoneScreen key={phone().id} device={phone().id} full /> : <PhonePlaceholder />
          : s.wsTab === 'plan' || s.wsTab === 'changes'
            ? <div style={{ width: 'min(900px,100%)', height: '100%', overflow: 'auto' }}>{s.wsTab === 'plan' ? <WsPlan /> : <WsChanges />}</div>
          : s.wsTab === 'files'
            ? <div style={{ width: 'min(900px,100%)', height: '100%', overflow: 'auto' }}><WsFiles /></div>
            : <div style={{ width: 'min(1100px,100%)', height: '100%', display: 'flex', flexDirection: 'column' }}><PreviewFrame device="desktop" /></div>}
      </div>
    </Modal>
  );
}
