import { useId, useState } from 'react';
import { AVATARS, DEFAULT_AVATAR, avatarUrl, type AvatarId } from '../runtime/avatars';
export function AvatarPicker({ onChange }: { onChange: (id: AvatarId) => void }) {
  const group = useId(), [selected, select] = useState<AvatarId>(DEFAULT_AVATAR);
  return <fieldset className="pa-avatar-picker"><legend>选择助理形象</legend><div className="pa-avatar-options">
    {AVATARS.map(a => <label className="pa-avatar-option" key={a.id}>
      <input type="radio" name={group} value={a.id} checked={selected === a.id} onChange={() => { select(a.id); onChange(a.id); }} />
      <img src={avatarUrl(a.id)} alt="" /><span>{a.name}{a.id === DEFAULT_AVATAR ? ' · 默认' : ''}</span>
    </label>)}
  </div></fieldset>;
}
