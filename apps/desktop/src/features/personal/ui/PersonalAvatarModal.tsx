import { useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import { Modal } from '@/shared/ui/Overlay';
import { closeModal, toast } from '@/shared/overlays/controller';
import { useStore } from '@/state/store';
import { DEFAULT_AVATAR } from '../runtime/avatars';
import { loadAssistants, syncAssistantAvatar, updateAssistantAvatar, type PersonalAssistant } from '../runtime/catalog';
import { compactAvatarImage, compactStoredAvatars } from '../runtime/avatarStore';
import { avatarSaveError } from '../runtime/errors';
import { AvatarPicker } from './AvatarPicker';

/** 已有助理更换头像：草稿留在弹窗内，落库成功后才更新列表与会话头像。 */
export function PersonalAvatarModal({ p }: { p: Record<string, unknown> }) {
  const s = useStore(), account = String(p.account ?? ''), id = String(p.assistantId ?? '');
  const [assistant] = useState<PersonalAssistant | undefined>(() => {
    try { return loadAssistants(account).items.find(x => x.id === id); } catch { return undefined; }
  });
  const [draft, setDraft] = useState<{ avatar: typeof DEFAULT_AVATAR; avatarImage?: string }>(() => ({
    avatar: assistant?.avatar ?? DEFAULT_AVATAR, avatarImage: assistant?.avatarImage,
  }));
  const [error, setError] = useState(''), [saving, setSaving] = useState(false);
  if (!assistant) return <Modal title="更换头像" size="sm" foot={<Btn label="关闭" onClick={() => closeModal(true)} />}>
    <p className="pa-muted">助理资料不存在或账号已切换，请关闭后重新打开个人助理。</p>
  </Modal>;
  const switched = s.account?.id !== account;
  /** 先把旧版本留下的偏大头像压缩（腾出空间、也让这次保存不超预算），再落库；任何一步失败都不留下半更新的配置 */
  const save = async () => {
    if (switched) { setError('账号已切换，未保存头像'); return; }
    setSaving(true); setError('');
    try {
      await compactStoredAvatars(account).catch(e => console.warn('personal.avatar_compact_failed', e instanceof Error ? e.message : e));
      const avatarImage = await compactAvatarImage(draft.avatarImage);
      const updated = updateAssistantAvatar(assistant.id, { avatar: draft.avatar, ...(avatarImage ? { avatarImage } : {}) }, account);
      syncAssistantAvatar(updated, account);
      (p.onSaved as ((a: PersonalAssistant) => void) | undefined)?.(updated);
      toast(`已更新「${updated.name}」的头像`);
      closeModal(true);
    } catch (e) { setError(avatarSaveError(e)); }
    finally { setSaving(false); }
  };
  return <Modal title={`更换「${assistant.name}」的头像`} desc="头像只影响展示，不改变这位助理的会话、人格、记忆、模型、权限或绑定账号。" size="sm"
    foot={<><Btn label="取消" variant="secondary" onClick={() => closeModal(true)} /><Btn label="保存头像" variant="primary" disabled={switched || saving} onClick={() => void save()} /></>}>
    <AvatarPicker initial={{ avatar: assistant.avatar, avatarImage: assistant.avatarImage }}
      onChange={(avatar, image) => setDraft({ avatar, avatarImage: image })} />
    {switched && <p className="form-error" role="alert">账号已切换，请关闭后重新打开个人助理。</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </Modal>;
}
