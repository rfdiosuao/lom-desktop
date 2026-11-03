import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { Btn } from '@/shared/ui/Button';
import { AVATAR_CROP_SIZE, clampAvatarCrop, drawAvatar, type AvatarCrop } from '../runtime/avatarImage';

type Props = {
  image: HTMLImageElement; crop: AvatarCrop;
  onChange: (crop: AvatarCrop) => void; onCommit: (crop: AvatarCrop) => void; onApply: () => void; onCancel: () => void;
};

/** 方形裁切：画布预览与保存使用同一套几何计算；拖动结束或滑杆变化就同步草稿，外层保存不会落后于预览。 */
export function AvatarCropEditor({ image, crop, onChange, onCommit, onApply, onCancel }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef(crop);
  const drag = useRef<{ x: number; y: number; crop: AvatarCrop } | null>(null);
  latest.current = crop;
  useEffect(() => { const ctx = canvas.current?.getContext('2d'); if (ctx) drawAvatar(ctx, image, AVATAR_CROP_SIZE, crop); }, [image, crop]);
  const clamp = (next: AvatarCrop) => clampAvatarCrop(next, image.naturalWidth, image.naturalHeight);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, crop };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const start = drag.current; if (!start) return;
    const side = e.currentTarget.getBoundingClientRect().width || AVATAR_CROP_SIZE;
    const next = clamp({ ...start.crop, x: start.crop.x + (e.clientX - start.x) / side, y: start.crop.y + (e.clientY - start.y) / side });
    latest.current = next; onChange(next);
  };
  const end = () => { if (!drag.current) return; drag.current = null; onCommit(latest.current); };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = 0.02;
    const delta = e.key === 'ArrowLeft' ? { x: -step, y: 0 } : e.key === 'ArrowRight' ? { x: step, y: 0 } : e.key === 'ArrowUp' ? { x: 0, y: -step } : e.key === 'ArrowDown' ? { x: 0, y: step } : undefined;
    if (!delta) return;
    e.preventDefault(); const next = clamp({ ...crop, x: crop.x + delta.x, y: crop.y + delta.y }); latest.current = next; onChange(next); onCommit(next);
  };
  return <div className="pa-avatar-editor">
    <div className="pa-avatar-crop" role="img" aria-label="头像裁剪预览" tabIndex={0}
      onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={key}>
      <canvas ref={canvas} width={AVATAR_CROP_SIZE} height={AVATAR_CROP_SIZE} />
    </div>
    <div className="pa-avatar-editor__body">
      <label className="pa-avatar-zoom">缩放
        <input type="range" min={100} max={300} step={1} value={Math.round(crop.zoom * 100)} aria-label="头像缩放"
          onChange={e => { const next = clamp({ ...crop, zoom: Number(e.currentTarget.value) / 100 }); latest.current = next; onChange(next); onCommit(next); }} />
      </label>
      <p className="pa-muted">拖动图片调整位置，裁切为方形后保存。</p>
      <div className="pa-avatar-editor__actions">
        <Btn label="取消" size="sm" variant="secondary" onClick={onCancel} />
        <Btn label="使用此头像" size="sm" variant="primary" onClick={onApply} />
      </div>
    </div>
  </div>;
}
