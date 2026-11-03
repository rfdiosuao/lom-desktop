import { useEffect, useId, useRef, useState } from 'react';
import { Btn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { AVATARS, DEFAULT_AVATAR, avatarUrl, isAvatar, isAvatarImage, type AvatarId, type AvatarLike } from '../runtime/avatars';
import { AVATAR_ACCEPT, DEFAULT_AVATAR_CROP, loadAvatarFile, renderAvatar, type AvatarCrop } from '../runtime/avatarImage';
import { AssistantAvatar } from './AssistantAvatar';
import { AvatarCropEditor } from './AvatarCropEditor';

type Selection = { kind: 'preset'; avatar: AvatarId } | { kind: 'custom'; avatar: AvatarId; image: string };
type Editing = { image: HTMLImageElement; url: string; crop: AvatarCrop };

const initialSelection = (initial?: AvatarLike): Selection => {
  const avatar = initial?.avatar && isAvatar(initial.avatar) ? initial.avatar : DEFAULT_AVATAR;
  return isAvatarImage(initial?.avatarImage) ? { kind: 'custom', avatar, image: initial.avatarImage } : { kind: 'preset', avatar };
};

/** 新建与更换共用：6 个预设、本地图片（方形裁切/缩放）和恢复默认，草稿只在保存时落库。 */
export function AvatarPicker({ initial, onChange }: { initial?: AvatarLike; onChange: (id: AvatarId, image?: string) => void }) {
  const group = useId();
  const [selection, setSelection] = useState<Selection>(() => initialSelection(initial));
  const [editing, setEditing] = useState<Editing | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const before = useRef<Selection | null>(null), editingUrl = useRef(''), generation = useRef(0);

  const setEditingFile = (next: Editing | null) => {
    if (editingUrl.current) URL.revokeObjectURL(editingUrl.current);
    editingUrl.current = next?.url ?? '';
    setEditing(next);
  };
  useEffect(() => () => { generation.current++; if (editingUrl.current) URL.revokeObjectURL(editingUrl.current); }, []);

  const commit = (next: Selection) => {
    setSelection(next);
    if (next.kind === 'custom') onChange(next.avatar, next.image); else onChange(next.avatar);
  };
  const selectPreset = (avatar: AvatarId) => {
    before.current = null; setEditingFile(null); setError('');
    commit({ kind: 'preset', avatar });
  };
  const pick = async (file?: File) => {
    if (!file) return;
    const attempt = ++generation.current;
    setError(''); setBusy(true);
    let loaded: Awaited<ReturnType<typeof loadAvatarFile>> | undefined;
    try {
      loaded = await loadAvatarFile(file);
      if (attempt !== generation.current) { URL.revokeObjectURL(loaded.url); return; }
      const image = renderAvatar(loaded.image, DEFAULT_AVATAR_CROP);
      if (!editing) before.current = selection;
      setEditingFile({ image: loaded.image, url: loaded.url, crop: DEFAULT_AVATAR_CROP });
      commit({ kind: 'custom', avatar: selection.avatar, image });
    } catch (e) {
      if (loaded) URL.revokeObjectURL(loaded.url);
      if (attempt === generation.current) setError(e instanceof Error ? e.message : '无法读取这张图片，请换一张重试');
    } finally {
      if (attempt === generation.current) setBusy(false);
    }
  };
  const commitCrop = (crop: AvatarCrop) => {
    if (!editing) return false;
    try {
      const image = renderAvatar(editing.image, crop);
      commit({ kind: 'custom', avatar: selection.avatar, image });
      setError('');
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : '无法处理图片，请换一张重试'); return false; }
  };
  const applyCrop = () => {
    if (commitCrop(editing?.crop ?? DEFAULT_AVATAR_CROP)) { before.current = null; setEditingFile(null); }
  };
  const cancelCrop = () => {
    const previous = before.current; before.current = null;
    setEditingFile(null);
    if (previous) commit(previous);
  };

  return <fieldset className="pa-avatar-picker"><legend>选择助理形象</legend>
    <div className="pa-avatar-options">
      <label className={`pa-avatar-option pa-avatar-option--upload${selection.kind === 'custom' ? ' is-selected' : ''}`}>
        <input type="file" accept={AVATAR_ACCEPT} disabled={busy} aria-label="上传本地图片作为头像"
          onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void pick(file); }} />
        {selection.kind === 'custom' ? <AssistantAvatar assistant={{ avatar: selection.avatar, avatarImage: selection.image }} alt="" /> : <span className="pa-avatar-upload"><Icon name="image" /></span>}
        <span>{busy ? '正在处理…' : selection.kind === 'custom' ? '本地图片' : '上传图片'}</span>
      </label>
      {AVATARS.map(a => <label className="pa-avatar-option" key={a.id}>
        <input type="radio" name={group} value={a.id} checked={selection.kind === 'preset' && selection.avatar === a.id}
          onChange={() => selectPreset(a.id)} />
        <img src={avatarUrl(a.id)} alt="" /><span>{a.name}{a.id === DEFAULT_AVATAR ? ' · 默认' : ''}</span>
      </label>)}
    </div>
    {editing && <AvatarCropEditor image={editing.image} crop={editing.crop}
      onChange={crop => setEditing(current => current ? { ...current, crop } : current)} onCommit={commitCrop}
      onApply={applyCrop} onCancel={cancelCrop} />}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="pa-avatar-actions">
      <Btn label="恢复默认形象" size="sm" variant="ghost" disabled={busy} onClick={() => selectPreset(DEFAULT_AVATAR)} />
      <span className="pa-muted">PNG、JPG 或 WebP，最大 5 MB；保存为方形小图。</span>
    </div>
  </fieldset>;
}
