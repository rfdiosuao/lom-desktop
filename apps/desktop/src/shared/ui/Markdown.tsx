import type { ReactNode } from 'react';
import { isHttpUrl, openExternalUrl } from '@/core/links';
import { toastError } from '@/shared/overlays/controller';
import { isInlineCodePath, isLocalPath, isOpenablePath } from '../lib/localPaths';
import { parseMarkdown, type Block, type ListNode } from './markdownBlocks';

/* ===== 轻量 Markdown（CW06）=====
 * 块：段落、标题、有序/无序/嵌套列表、引用、表格、分隔线、代码块（解析见 markdownBlocks.ts）；
 * 行内：**粗体**、__粗体__、*斜体*、~~删除线~~、`代码`、[文字](http 链接)、裸 http(s) 链接、@提及、图片与本地路径。
 * 模型输出属于不可信内容：这里只生成 React 节点，不使用 innerHTML；只有 http(s) 链接才会成为可点击链接。 */

/* CW07：`@` 后只认固定角色（电脑主控 / 手机N号）或纯中文名，英文注解
 * （@param / @media / @Override）不纳入；右边界防止 `@小麓请帮我看看…`
 * 把后面正文一起吞成提及。 */
const MENTION = /@(电脑主控|手机[一二三四五六七八九十]+号|[一-龥]{2,6}?)(?=[\s，。,:：、；;！？!?）)]|$)/;

type FileRenderer = (source: string, label: string, key: string) => ReactNode;
type ImageRenderer = (source: string, alt: string, key: string) => ReactNode;

/* 行内规则按出现位置从左到右匹配。组号：1 粗体 2 行内代码 3 @提及 4 下划线粗体 5 删除线 6 斜体 7/8 链接 9 裸链接。
 * 不用后行断言（旧版 WebView 不支持），词边界在 inlineMatch 里检查。 */
const INLINE = [
  /\*\*(.+?)\*\*/, /`([^`]+?)`/, MENTION, /__(.+?)__/, /~~(.+?)~~/, /\*([^\s*](?:[^*]*?[^\s*])?)\*/,
  /\[([^\]\n]+)\]\((https?:\/\/[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)/,
  /(https?:\/\/[^\s<>"'`　-鿿＀-￯]+)/,
].map(r => r.source).join('|');
const WORD = /\w/;

/** 裸链接末尾的标点和不成对的右括号不算链接本身 */
function trimUrl(url: string) {
  let out = url.replace(/[.,;:!?]+$/, '');
  while (out.endsWith(')') && out.split(')').length > out.split('(').length) out = out.slice(0, -1).replace(/[.,;:!?]+$/, '');
  return out;
}

const externalLink = (url: string, label: ReactNode, key: string) => (
  <a key={key} className="md-link" href={url} target="_blank" rel="noopener noreferrer" title={url}
    onClick={e => { e.preventDefault(); void openExternalUrl(url).catch(error => toastError('打开链接失败', error)); }}>{label}</a>
);

/** 一条行内规则命中后生成节点；返回 null 表示边界不成立（如 snake_case_name 里的下划线），这段仍按正文 */
function inlineMatch(m: RegExpExecArray, text: string, k: string, file?: FileRenderer, links = true): { node: ReactNode; end: number } | null {
  const end = m.index + m[0].length;
  const before = text[m.index - 1] ?? '', after = text[end] ?? '';
  const sub = (s: string) => inline(s, k, undefined, file, links);
  if (m[1] !== undefined) return { node: <b key={k}>{sub(m[1])}</b>, end };
  /* D15 规格要求行内代码路径可点击（含 `a.md` 这种短占位名）；CW07 要求
   * `README.md` / `Node.js` / `e.g` / `v1.2` / `3.14` 这些歧义串留作文本。 */
  if (m[2] !== undefined) return { node: file && isInlineCodePath(m[2]) ? file(m[2], m[2], k) : <code key={k}>{m[2]}</code>, end };
  if (m[3] !== undefined) return { node: <span key={k} className="mention">@{m[3]}</span>, end };
  // `__init__` / `__main__` 这类标识符不是粗体
  if (m[4] !== undefined) return WORD.test(before) || WORD.test(after) || /^\w+$/.test(m[4]) ? null : { node: <b key={k}>{sub(m[4])}</b>, end };
  if (m[5] !== undefined) return { node: <del key={k}>{sub(m[5])}</del>, end };
  // `2*3*4`、`a*b*c` 这类乘号两侧是字母数字，不是斜体
  if (m[6] !== undefined) return WORD.test(before) || WORD.test(after) ? null : { node: <i key={k}>{sub(m[6])}</i>, end };
  if (m[7] !== undefined) return links && isHttpUrl(m[8]) ? { node: externalLink(m[8], inline(m[7], k, undefined, file, false), k), end } : null;
  const url = trimUrl(m[9]);
  return links && isHttpUrl(url) ? { node: externalLink(url, url, k), end: m.index + url.length } : null;
}

function inline(text: string, keyBase: string, image?: ImageRenderer, file?: FileRenderer, links = true): ReactNode[] {
  const imagePattern = /`[^`]*`|!?\[([^\]\n]*)\]\(\s*(<[^>\n]+>|(?:\\.|[^()\s]|\([^()\n]*\))+)(?:\s+["'][^"'\n]*["'])?\s*\)/g;
  if (image || file) {
    const nodes: ReactNode[] = []; let last = 0; let match: RegExpExecArray | null;
    while ((match = imagePattern.exec(text))) {
      if (match[1] === undefined) continue;
      const source = match[2].replace(/^<|>$/g, '').replace(/\\([()\\])/g, '$1');
      const picture = match[0].startsWith('!') || /\.(png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(source);
      if (!(picture && image) && !(file && isOpenablePath(source) && !match[0].startsWith('!'))) continue;
      nodes.push(...inline(text.slice(last, match.index), `${keyBase}-${last}`, undefined, file, links));
      nodes.push(picture && image ? image(source, match[1], `${keyBase}-image-${match.index}`) : file!(source, match[1], `${keyBase}-file-${match.index}`)); last = imagePattern.lastIndex;
    }
    if (last) { nodes.push(...inline(text.slice(last), `${keyBase}-end`, undefined, file, links)); return nodes; }
  }
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    const hit = inlineMatch(m, text, `${keyBase}-${i}`, file, links);
    if (!hit) { re.lastIndex = m.index + 1; continue; }
    if (m.index > last) out.push(...plain(text.slice(last, m.index), `${keyBase}-plain${i}`, file));
    out.push(hit.node);
    i++;
    last = re.lastIndex = hit.end;
  }
  if (last < text.length) out.push(...plain(text.slice(last), `${keyBase}-tail`, file));
  return out;
}

function plain(text: string, key: string, file?: FileRenderer): ReactNode[] {
  if (!file) return [text];
  const nodes: ReactNode[] = []; let last = 0;
  /* 只把有明确路径形态的串提出来：绝对路径、~、./、../、盘符，或「目录 + 已知后缀」的相对路径。
   * `TCP/IP`、`and/or`、`CI/CD`、`24/7`、`A/B`、`HTTP/2`、`输入/输出` 没有已知文件后缀，不会被误判成按钮。 */
  const candidate = /[\w㐀-鿿.~\/\\:-]+/g;
  for (const match of text.matchAll(candidate)) {
    const path = match[0].replace(/[.,;:]+$/, '');
    if (!path || !isLocalPath(path) || !/[\/\\]/.test(path)) continue;
    const start = match.index!;
    nodes.push(text.slice(last, start), file(path, path, `${key}-${start}`));
    last = start + path.length;
  }
  nodes.push(text.slice(last)); return nodes;
}

type Ctx = { image?: ImageRenderer; file?: FileRenderer };

const withBreaks = (lines: string[], key: string, { image, file }: Ctx) =>
  lines.flatMap((l, i) => (i ? [<br key={`${key}-br${i}`} />, ...inline(l, `${key}-${i}`, image, file)] : inline(l, `${key}-${i}`, image, file)));

function renderList(n: ListNode, key: string, ctx: Ctx): ReactNode {
  const items = n.items.map((it, i) => <li key={i}>{withBreaks(it.text.split('\n'), `${key}-i${i}`, ctx)}{it.child && renderList(it.child, `${key}-i${i}c`, ctx)}</li>);
  return n.ordered ? <ol key={key} start={n.start === 1 ? undefined : n.start}>{items}</ol> : <ul key={key}>{items}</ul>;
}

function renderTable(b: Extract<Block, { kind: 'table' }>, key: string, { image, file }: Ctx): ReactNode {
  const align = (i: number) => ({ textAlign: b.align[i] as 'left' | 'center' | 'right' | undefined });
  return (
    <div key={key} className="md-table"><table>
      <thead><tr>{b.head.map((c, i) => <th key={i} style={align(i)}>{inline(c, `${key}-h${i}`, image, file)}</th>)}</tr></thead>
      <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, i) => <td key={i} style={align(i)}>{inline(c, `${key}-r${ri}c${i}`, image, file)}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

function renderBlock(b: Block, key: string, ctx: Ctx): ReactNode {
  switch (b.kind) {
    case 'heading': return <h4 key={key}>{inline(b.text, key, ctx.image, ctx.file)}</h4>;
    case 'para': return <p key={key}>{withBreaks(b.lines, key, ctx)}</p>;
    case 'list': return renderList(b.list, key, ctx);
    case 'quote': return <blockquote key={key}>{b.blocks.map((c, i) => renderBlock(c, `${key}-q${i}`, ctx))}</blockquote>;
    case 'table': return renderTable(b, key, ctx);
    case 'rule': return <hr key={key} />;
    case 'code': return <pre key={key} className="md-code"><code>{b.body}</code></pre>;
  }
}

export function Markdown({ text, image, file, streaming, fenceFrom, fenceOpenEnd }: {
  text?: string; image?: ImageRenderer; file?: FileRenderer; streaming?: boolean;
  /** CW06：工具调用把代码块从中间切开时，上一段结尾处于未闭合的围栏里；本段接着在代码块里开始 */
  fenceFrom?: number;
  /** CW06：本段结尾的围栏在下一段才闭合，当前先按代码块渲染 */
  fenceOpenEnd?: boolean;
}) {
  const renderedImages = new Set<string>();
  const uniqueImage: ImageRenderer | undefined = image ? (source, alt, key) => {
    if (renderedImages.has(source)) return null;
    renderedImages.add(source); return image(source, alt, key);
  } : undefined;
  const ctx: Ctx = { image: uniqueImage, file };
  return <>{parseMarkdown(String(text || ''), { streaming, fenceFrom, fenceOpenEnd }).map((b, i) => renderBlock(b, `b${i}`, ctx))}</>;
}
