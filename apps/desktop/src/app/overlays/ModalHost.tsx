import { HistoryImportModal } from '@/features/history/ui/HistoryImportModal';
import { UpdateModal } from '@/features/updates/ui/Updates';
import { McpModal } from '@/features/settings/ui/McpModal';
import { ArchivedModal, LomMemoryModal } from '@/features/chat/ui/CommandModals';
import { MarketDetailModal, MarketUploadModal } from '@/features/skills/ui/MarketModal';
import type { ComponentType } from 'react';
import { closeModal } from '@/shared/overlays/controller';
import { Modal } from '@/shared/ui/Overlay';
import { useStore } from '@/state/store';
import { AuditModal, ConfirmModal, ProfileModal, PromptModal, ShortcutsModal } from './BasicModals';
import { FeedbackModal } from '@/features/account/ui/FeedbackModal';
import { NoticeModal } from '@/features/account/ui/Notices';
import { AddKeyModal, RechargeModal } from '@/features/account/ui/BillingModals';
import { CustomAgentModal } from '@/features/settings/ui/AgentModals';
import { FullModal } from '@/features/workspace/ui/FullModal';
import { PaletteModal } from './PaletteModal';
import { DeviceModal, MemoryModal, PairModal, SendFilesModal, SubModal } from '@/features/phones/ui/PhoneModals';
import { SchedModal, SchedRunsModal } from '@/features/schedules/ui/ScheduleModals';
import { SkillModal, UploadModal } from '@/features/skills/ui/SkillModals';
import { TeamModal } from '@/features/teams/ui/TeamModal';

/* ===== 弹窗宿主：按栈渲染，点遮罩关闭（dismissible=false 的除外） ===== */

type P = { p: Record<string, unknown> };
const MODALS: Record<string, ComponentType<P>> = {
  historyImport: HistoryImportModal, update: UpdateModal, mcp: McpModal, marketDetail: MarketDetailModal, marketUpload: MarketUploadModal,
  confirm: ConfirmModal, prompt: PromptModal, shortcuts: ShortcutsModal, audit: AuditModal, feedback: FeedbackModal, profile: ProfileModal,
  palette: PaletteModal, sched: SchedModal, schedRuns: SchedRunsModal, skill: SkillModal, upload: UploadModal, team: TeamModal,
  sub: SubModal, memory: MemoryModal, sendFiles: SendFilesModal, device: DeviceModal, pair: PairModal,
  archived: ArchivedModal, lomMemory: LomMemoryModal, recharge: RechargeModal, addKey: AddKeyModal, full: FullModal, customAgent: CustomAgentModal, notice: NoticeModal,
};

export function ModalHost() {
  const s = useStore();
  return <>
    {s.modals.map((m, i) => {
      const C = MODALS[m.id];
      return (
        <div key={`${m.id}-${i}`} className="modal-layer" style={{ zIndex: 200 + i }}
          onMouseDown={e => { if (e.target === e.currentTarget && m.props.dismissible !== false) closeModal(); }}>
          {C ? <C p={m.props} /> : <Modal title="未定义">{m.id}</Modal>}
        </div>
      );
    })}
  </>;
}
