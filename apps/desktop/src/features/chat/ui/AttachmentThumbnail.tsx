import { useEffect, useState } from 'react';
import { loadFilePreview } from '@/core/client';
import { Icon } from '@/shared/ui/Icon';

export function AttachmentThumbnail({ attachment: a }: { attachment: { path?: string; preview?: string; ic?: string } }) {
  const legacy = !!a.preview && /\/api\/fs\/stream(?:\?|$)/.test(a.preview);
  const local = !!a.path && (legacy || a.ic === 'image' && (!a.preview || /^https?:/.test(a.preview)));
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null);
  const [failed, setFailed] = useState('');
  useEffect(() => {
    if (!local || !a.path) return;
    const path = a.path, controller = new AbortController(); let url = '';
    void loadFilePreview(path, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob); setLoaded({ path, url });
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(path); // Visible fallback, no credential-bearing errors.
    });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [local, a.path]);
  const src = local ? (loaded && loaded.path === a.path ? loaded.url : '') : legacy ? undefined : a.preview;
  return src ? <img className="attach__thumb" src={src} alt="" referrerPolicy="no-referrer" />
    : <span title={failed === a.path ? '图片预览加载失败' : undefined}><Icon name={a.ic || 'file'} /></span>;
}
