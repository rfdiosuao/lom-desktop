import { Btn } from '@/shared/ui/Button';
import { Icon } from '@/shared/ui/Icon';
import { toast } from '@/shared/overlays/controller';
import { ago } from '@/shared/lib/util';
import { S, useStore } from '@/state/store';
import { refreshPreview } from '../runtime/workspace';

/* ===== WS-PREVIEW-01：预览出问题时如实告诉用户 =====
 * #401 刷新失败时可以继续显示上一次成功的内容，但必须标明它是旧的、给出错误码并能重试；
 * #409 页面里本地资源没能加载时，列出路径和原因，区分「部分失败」和「全部失败」。 */

const MAX_LISTED = 5;
const clock = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

/** 重新读取预览：只有真的成功才提示「已刷新」，失败的原因留在预览上方 */
export async function retryPreview() {
  await refreshPreview();
  if (!S.previewError) toast('预览已刷新', 'refresh');
}

export function PreviewNotice() {
  const s = useStore();
  const failed = s.previewAssetFailures;
  const listed = failed.slice(0, MAX_LISTED);
  const all = s.previewAssetTotal > 0 && failed.length >= s.previewAssetTotal;
  return <>
    {s.previewError && <div className="preview-notice preview-notice--error" role="alert">
      <Icon name="info" />
      <div className="preview-notice__body">
        <b>{s.previewHtml && s.previewAt ? `刷新失败，显示的是 ${clock(s.previewAt)}（${ago(s.previewAt)}）的旧内容` : '预览失败'}</b>
        <span>{s.previewError}</span>
      </div>
      <Btn label="重试" ic="refresh" size="sm" variant="secondary" onClick={() => { void retryPreview(); }} />
    </div>}
    {failed.length > 0 && <div className="preview-notice preview-notice--warn" role="status">
      <Icon name="info" />
      <div className="preview-notice__body">
        <b>{all ? `全部 ${failed.length} 个资源都没能加载，页面可能缺少样式、脚本或图片` : `${failed.length} 个资源没能加载（共 ${s.previewAssetTotal} 个），页面可能显示不完整`}</b>
        <ul>{listed.map(f => <li key={`${f.path}:${f.reason}`}><code>{f.path}</code>：{f.reason}</li>)}</ul>
        {failed.length > listed.length && <span>另有 {failed.length - listed.length} 个未列出</span>}
      </div>
    </div>}
  </>;
}
