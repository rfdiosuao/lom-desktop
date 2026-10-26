import type { Msg } from '@/state/types';
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
/** Read declared image outputs only, never scrape arbitrary shell output for paths. */
export function toolImages(value: unknown): string[] {
  const d = object(value), raw = object(d.rawOutput ?? d.raw_output ?? d.output);
  const image = object(raw.image);
  if (typeof d.output === 'string' && d.output.length < 100_000) {
    try {
      const output = JSON.parse(d.output);
      if (output.kind === 'lom.tool-output.v1' && Array.isArray(output.images)) return output.images.filter((p: unknown): p is string => typeof p === 'string' && /\.(png|jpe?g|webp|gif)$/i.test(p));
    } catch { /* Ordinary command output is not structured JSON. */ }
  }
  return [...new Set([image.path, raw.saved_path, raw.savedPath].filter((p): p is string => typeof p === 'string' && /\.(png|jpe?g|webp|gif)$/i.test(p) && !/[\r\n]/.test(p)))];
}
export function applyAcpTool(messages: Msg[], value: Record<string, unknown>, at = Date.now()) {
  const d = object(value.update ?? value), id = String(d.tool_call_id ?? d.toolCallId ?? '');
  if (!id) return;
  let msg = messages.find(m => m.type === 'tool' && m.callId === id);
  if (!msg) { msg = { id: `acp:${id}`, type: 'tool', at, callId: id, status: 'running' }; messages.push(msg); }
  if (typeof d.title === 'string') msg.tool = d.title;
  const raw = d.rawInput ?? d.raw_input;
  if (raw) msg.detail = JSON.stringify(raw).slice(0, 160);
  if (d.status === 'completed' || d.status === 'success') msg.status = 'done';
  if (d.status === 'failed' || d.status === 'error') msg.status = 'error';
  const output = d.rawOutput ?? d.raw_output;
  if (output !== undefined) msg.output = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
  // 有的 CLI 不给 rawOutput，只把工具返回的文本放在 content 里（ACP：{type:'content', content:{type:'text', text}}）
  else if (Array.isArray(d.content)) {
    const texts = d.content.flatMap(item => {
      const inner = object(object(item).content);
      return inner.type === 'text' && typeof inner.text === 'string' ? [inner.text] : [];
    });
    if (texts.length) msg.output = texts.join('\n');
  }
  if (msg.status === 'done') { const images = toolImages(d); if (images.length) msg.images = images; }
  if (msg.status === 'error') msg.images = undefined;
}
