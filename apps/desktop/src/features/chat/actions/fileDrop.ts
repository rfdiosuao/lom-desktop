import { attachFiles, filesFrom } from './attachments';
import { toast } from '@/shared/overlays/controller';

/** Block WebView navigation before a file drop reaches any child handler. */
export function isFileDrop(data: DataTransfer | null): boolean {
  const types = Array.from(data?.types || []);
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html') || !!data?.files?.length;
}

function availableInputs(doc: Document): HTMLTextAreaElement[] {
  return [...doc.querySelectorAll<HTMLTextAreaElement>('textarea[data-composer]')].filter(input => {
    if (input.disabled || input.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    for (let node: HTMLElement | null = input; node; node = node.parentElement) {
      const style = doc.defaultView?.getComputedStyle(node);
      if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    }
    return true;
  });
}

/** Outside an input, route to the current composer, never invent a new conversation. */
export function installFileDrop(doc: Document = document): () => void {
  let lastFocused: HTMLTextAreaElement | null = null;
  const focus = (event: FocusEvent) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.dataset.composer) lastFocused = event.target;
  };
  const protect = (event: DragEvent) => {
    if (!isFileDrop(event.dataTransfer)) return;
    event.preventDefault();
    if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  };
  const drop = (event: DragEvent) => {
    if (!isFileDrop(event.dataTransfer)) return;
    event.preventDefault();
    const files = filesFrom(event.dataTransfer);
    if (!files.length) { toast('没有取得文件，请从文件夹拖入文件，或使用添加附件', 'info'); return; }
    // A modal or several unfocused team panes must not silently attach to the wrong task.
    if (doc.querySelector('[role="dialog"], .modal-layer')) { toast('请先关闭弹窗，再拖入聊天附件', 'info'); return; }
    const inputs = availableInputs(doc);
    const target = inputs.includes(lastFocused!) ? lastFocused : inputs.length === 1 ? inputs[0] : null;
    const key = target?.dataset.composer;
    if (!key) { toast(inputs.length ? '请先点击要接收附件的聊天框，再拖入文件' : '请先打开聊天，再拖入附件', 'info'); return; }
    void attachFiles(key, files);
  };
  doc.addEventListener('focusin', focus);
  doc.addEventListener('dragover', protect, true);
  doc.addEventListener('drop', protect, true);
  doc.addEventListener('drop', drop);
  return () => {
    doc.removeEventListener('focusin', focus);
    doc.removeEventListener('dragover', protect, true);
    doc.removeEventListener('drop', protect, true);
    doc.removeEventListener('drop', drop);
  };
}
