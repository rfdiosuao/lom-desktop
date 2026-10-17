import type { ReactNode } from 'react';
import { isLocalPath } from '../core/localPaths';

/* ===== 轻量 Markdown：段落、标题、列表、代码块、**粗体**、`代码`、@提及 =====
 * 模型输出属于不可信内容：这里只生成 React 节点，不使用 innerHTML。 */

const MENTION = /@([一-龥A-Za-z]+?(?=[\s，。,:：]|$))/;

type FileRenderer = (source: string, label: string, key: string) => ReactNode;
type ImageRenderer = (source: string, alt: string, key: string) => ReactNode;

function inline(text: string, keyBase: string, image?: ImageRenderer, file?: FileRenderer): ReactNode[] {
  const imagePattern = /`[^`]*`|!?\[([^\]\n]*)\]\(\s*(<[^>\n]+>|(?:\\.|[^()\s]|\([^()\n]*\))+)(?:\s+["'][^"'\n]*["'])?\s*\)/g;
  if (image || file) {
    const nodes: ReactNode[] = []; let last = 0; let match: RegExpExecArray | null;
    while ((match = imagePattern.exec(text))) {
      if (match[1] === undefined) continue;
      const source = match[2].replace(/^<|>$/g, '').replace(/\\([()\\])/g, '$1');
      const picture = match[0].startsWith('!') || /\.(png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(source);
      if (!(picture && image) && !(file && isLocalPath(source) && !match[0].startsWith('!'))) continue;
      nodes.push(...inline(text.slice(last, match.index), `${keyBase}-${last}`, undefined, file));
      nodes.push(picture && image ? image(source, match[1], `${keyBase}-image-${match.index}`) : file!(source, match[1], `${keyBase}-file-${match.index}`)); last = imagePattern.lastIndex;
    }
    if (last) { nodes.push(...inline(text.slice(last), `${keyBase}-end`, undefined, file)); return nodes; }
  }
  const out: ReactNode[] = [];
  const re = new RegExp(`\\*\\*(.+?)\\*\\*|\`([^\`]+?)\`|${MENTION.source}`, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...plain(text.slice(last, m.index), `${keyBase}-plain${i}`, file));
    const k = `${keyBase}-${i++}`;
    if (m[1] !== undefined) out.push(<b key={k}>{inline(m[1], k, undefined, file)}</b>);
    else if (m[2] !== undefined) out.push(file && isLocalPath(m[2]) ? file(m[2], m[2], k) : <code key={k}>{m[2]}</code>);
    else out.push(<span key={k} className="mention">@{m[3]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...plain(text.slice(last), `${keyBase}-tail`, file));
  return out;
}

function plain(text: string, key: string, file?: FileRenderer): ReactNode[] {
  if (!file) return [text];
  const nodes: ReactNode[] = []; let last = 0;
  const paths = /(?:^|(?<=[\s（(：:]))((?:~?\/)[^\s<>"'`，。；！？）)]+)/g;
  for (const match of text.matchAll(paths)) {
    const path = match[1].replace(/[.,;:]+$/, '');
    if (!isLocalPath(path)) continue;
    const start = match.index!;
    nodes.push(text.slice(last, start), file(path, path, `${key}-${start}`));
    last = start + path.length;
  }
  nodes.push(text.slice(last)); return nodes;
}

const withBreaks = (lines: string[], key: string, image?: ImageRenderer, file?: FileRenderer) =>
  lines.flatMap((l, i) => (i ? [<br key={`${key}-br${i}`} />, ...inline(l, `${key}-${i}`, image, file)] : inline(l, `${key}-${i}`, image, file)));

function block(raw: string, key: string, image?: ImageRenderer, file?: FileRenderer): ReactNode[] {
  const lines = raw.split('\n');
  const out: ReactNode[] = [];
  while (lines.length && /^#{1,6}\s/.test(lines[0])) {
    const h = (lines.shift() as string).replace(/^#+\s/, '');
    out.push(<h4 key={`${key}-h${out.length}`}>{inline(h, `${key}-h${out.length}`, image, file)}</h4>);
  }
  if (!lines.length) return out;
  if (lines.every(l => /^\s*[-•*]\s/.test(l))) {
    out.push(<ul key={`${key}-ul`}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*[-•*]\s/, ''), `${key}-li${i}`, image, file)}</li>)}</ul>);
  } else if (lines.every(l => /^\s*\d+[.)、]\s?/.test(l))) {
    out.push(<ol key={`${key}-ol`}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\s*\d+[.)、]\s?/, ''), `${key}-oli${i}`, image, file)}</li>)}</ol>);
  } else {
    out.push(<p key={`${key}-p`}>{withBreaks(lines, key, image, file)}</p>);
  }
  return out;
}

export function Markdown({ text, image, file }: { text?: string; image?: ImageRenderer; file?: FileRenderer }) {
  const renderedImages = new Set<string>();
  const uniqueImage: ImageRenderer | undefined = image ? (source, alt, key) => {
    if (renderedImages.has(source)) return null;
    renderedImages.add(source); return image(source, alt, key);
  } : undefined;
  const src = String(text || '');
  const nodes: ReactNode[] = [];
  /* 先切出 ``` 代码块，其余按空行分段 */
  const parts = src.split(/```[\w-]*\n?/);
  parts.forEach((part, pi) => {
    if (pi % 2 === 1) {
      nodes.push(<pre key={`code${pi}`} className="md-code"><code>{part.replace(/\n$/, '')}</code></pre>);
      return;
    }
    part.split(/\n{2,}/).filter(b => b.trim()).forEach((b, bi) => nodes.push(...block(b.replace(/^\n+|\n+$/g, ''), `b${pi}-${bi}`, uniqueImage, file)));
  });
  return <>{nodes}</>;
}
