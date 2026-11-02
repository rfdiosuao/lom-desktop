/* ===== Markdown 块级解析（CW06）：纯函数，不依赖 React =====
 * 一段模型输出拆成：标题 / 段落 / 列表 / 引用 / 表格 / 分隔线 / 代码块。
 * 逐行判断块边界，所以「说明句 + 紧跟的列表」「列表后接正文」「段落中间的标题」都按块渲染；
 * 以前整段只要有一行不是列表项，列表符号就原样留在正文里。
 * 模型输出属于不可信内容：这里只产出结构，渲染层只生成 React 节点，不使用 innerHTML。 */

export type ListNode = { ordered: boolean; start: number; items: { text: string; raw: string; child?: ListNode }[] };
export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; lines: string[] }
  | { kind: 'list'; list: ListNode }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; head: string[]; align: (string | undefined)[]; rows: string[][] }
  | { kind: 'rule' }
  | { kind: 'code'; body: string };

export type ParseOptions = {
  /** 流式输出中：尚未闭合的围栏立刻按代码块渲染 */
  streaming?: boolean;
  /** 本段正文从一个未闭合的围栏里接着开始（工具调用把代码块从中间切开时，上一段留下的围栏长度） */
  fenceFrom?: number;
  /** 本段结尾的围栏在下一段才闭合：按代码块渲染，不当正文 */
  fenceOpenEnd?: boolean;
};

/* CW07：有序列表的判据。
 * - 多项：序号必须连续递增；`1.甲` 这类点后无空格的写法在多行列表里仍成立。
 * - 单项：保留真正的单项列表（`1. 唯一项`、`3. 从三开始`、`1、甲`），
 *   但单项最容易和年份/版本/IP 混淆，所以要求数字 1–99；
 *   点/右括号后必须有空白、内容不以数字开头；年份 1900–2100 一律按正文。
 *   这样 `2026. 年中`、`1.2.3 已发布`、`3.14 是圆周率`、`127.0.0.1 是本机` 仍是正文。
 * 中文顿号 `1、甲` 没有空格也视为列表。 */
const ORDERED = /^(\s{0,3})(\d{1,9})([.)、])([ \t]*)(\S.*)$/;
function orderedItems(lines: string[]): RegExpExecArray[] | null {
  const items = lines.map(l => ORDERED.exec(l));
  if (items.some(m => !m)) return null;
  const rows = items as RegExpExecArray[];
  if (rows.length === 1) {
    const n = Number(rows[0][2]);
    if (n < 1 || n > 99 || (n >= 1900 && n <= 2100)) return null;
    if (rows[0][3] === '、') return rows;
    if (!rows[0][4] || /^\d/.test(rows[0][5])) return null;
    return rows;
  }
  if (rows.some(m => !m[4] && /^\d/.test(m[5]))) return null;
  for (let i = 1; i < rows.length; i++) if (Number(rows[i][2]) !== Number(rows[i - 1][2]) + 1) return null;
  return rows;
}

/* CommonMark：围栏可缩进 0–3 空格，info string 可带空格，3 个以上反引号按长度配对。 */
const FENCE_OPEN = /^( {0,3})(`{3,})([^`]*)$/;
const fenceClose = (line: string, length: number) => {
  const m = /^ {0,3}(`{3,})[ \t]*$/.exec(line);
  return !!m && m[1].length >= length;
};
const findClose = (lines: string[], from: number, length: number) => {
  for (let j = from; j < lines.length; j++) if (fenceClose(lines[j], length)) return j;
  return -1;
};
/** 围栏缩进了几格，代码体每行就去掉几格（最多），不让列表里的代码块整体右移 */
const codeBody = (lines: string[], from: number, end: number, indent: number) =>
  lines.slice(from, end).map(l => l.replace(new RegExp(`^ {0,${indent}}`), '')).join('\n').replace(/\n$/, '');

const normalize = (text: string) => text.replace(/\r\n?/g, '\n');

/** 文本结尾是否停在一个未闭合的围栏里；返回该围栏的反引号数。`fenceFrom` 是这段开头已处于的围栏。 */
export function openFenceAtEnd(text: string, fenceFrom?: number): number | undefined {
  let open = fenceFrom ?? 0;
  for (const line of normalize(text).split('\n')) {
    if (open) { if (fenceClose(line, open)) open = 0; continue; }
    const m = FENCE_OPEN.exec(line);
    if (m) open = m[2].length;
  }
  return open || undefined;
}

/** 空行分隔的有序列表仍是同一个列表：只合并两侧都是列表项的空行，不合并普通段落。 */
function mergeOrderedBlankLines(part: string) {
  const lines = part.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim() && out.length && ORDERED.test(out[out.length - 1])) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j < lines.length && ORDERED.test(lines[j])) continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

/** 按空行切成若干块；只有空白的行也算空行 */
function splitBlank(lines: string[]): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const l of mergeOrderedBlankLines(lines.join('\n')).split('\n')) {
    if (l.trim()) cur.push(l);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

/* CW07：嵌套列表。整段列表里只要有缩进行（或缩进的续行）就启用，没有缩进的列表走平铺路径。
 * 子项必须比父项多缩进 2 格，只缩进 1 格仍是同级；各层的类型由该层第一项的标记决定。
 * CW06：列表项下缩进的非列表行是这一项的续行（换行显示），不再让整段列表退回成正文。 */
const LIST_LINE = /^([ \t]*)(?:([-•*])[ \t]+|(\d{1,9})(?:[.)][ \t]+|、[ \t]*))(\S.*)$/;
const CONTINUATION = /^(?: {2,}|\t)\S/;
const indentWidth = (ws: string) => ws.replace(/\t/g, '    ').length;
function nestedList(lines: string[]): ListNode | null {
  if (!lines.some(l => /^(?: {2,}|\t)/.test(l))) return null;
  const parsed: { raw: string; indent: number; num: number | null; text: string }[] = [];
  for (const line of lines) {
    const m = LIST_LINE.exec(line);
    if (m) parsed.push({ raw: line, indent: indentWidth(m[1]), num: m[3] === undefined ? null : Number(m[3]), text: m[4] });
    else if (parsed.length && CONTINUATION.test(line)) parsed[parsed.length - 1].text += `\n${line.trim()}`;
    else return null;
  }
  if (parsed[0].indent > 3) return null;
  const newList = (num: number | null): ListNode => ({ ordered: num !== null, start: num ?? 1, items: [] });
  const root = newList(parsed[0].num);
  const stack = [{ indent: parsed[0].indent, list: root }];
  for (const r of parsed) {
    while (stack.length > 1 && r.indent < stack[stack.length - 1].indent) stack.pop();
    let top = stack[stack.length - 1];
    const last = top.list.items[top.list.items.length - 1];
    if (last && r.indent >= top.indent + 2) {
      last.child ??= newList(r.num);
      top = { indent: r.indent, list: last.child };
      stack.push(top);
    }
    top.list.items.push({ text: r.text, raw: r.raw });
  }
  if (root.ordered && !orderedItems(root.items.map(i => i.raw))) return null;
  return root;
}
function flatList(lines: string[]): ListNode | null {
  if (lines.every(l => /^\s*[-•*]\s/.test(l))) return { ordered: false, start: 1, items: lines.map(l => ({ raw: l, text: l.replace(/^\s*[-•*]\s/, '') })) };
  const ordered = orderedItems(lines);
  return ordered ? { ordered: true, start: Number(ordered[0][2]), items: ordered.map(m => ({ raw: m[0], text: m[5] })) } : null;
}

const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?(.*)$/;
const MAX_QUOTE_DEPTH = 4;

/* 表格：表头行 + 分隔行（`---`、`:--`、`--:`、`:-:`，列数要和表头一致）+ 若干数据行；
 * 数据行补齐/截断到表头列数；单元格里的 `\|` 是字面竖线。 */
function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') { cur += '|'; k++; }
    else if (s[k] === '|') { cells.push(cur.trim()); cur = ''; }
    else cur += s[k];
  }
  cells.push(cur.trim());
  return cells;
}
function tableAt(lines: string[], i: number): { block: Block; end: number } | null {
  const delim = lines[i + 1];
  if (delim === undefined || !lines[i].includes('|') || !delim.includes('|')) return null;
  const head = splitRow(lines[i]);
  const marks = splitRow(delim);
  if (marks.length !== head.length || !marks.every(c => /^:?-+:?$/.test(c))) return null;
  const align = marks.map(c => (c.startsWith(':') ? (c.endsWith(':') ? 'center' : 'left') : c.endsWith(':') ? 'right' : undefined));
  let end = i + 2;
  const rows: string[][] = [];
  while (end < lines.length && lines[end].includes('|')) {
    const cells = splitRow(lines[end++]);
    rows.push(head.map((_, c) => cells[c] ?? ''));
  }
  return { block: { kind: 'table', head, align, rows }, end };
}

/** 从 i 行起的一串列表行（含缩进续行）；和前面的说明句相连时，只有从 1 开始的有序列表才打断段落 */
function listAt(lines: string[], i: number, afterText: boolean): { block?: Block; end: number } | null {
  if (!LIST_LINE.test(lines[i]) && !ORDERED.test(lines[i])) return null;
  let end = i + 1;
  while (end < lines.length && (LIST_LINE.test(lines[end]) || ORDERED.test(lines[end]) || CONTINUATION.test(lines[end]))) end++;
  const list = nestedList(lines.slice(i, end)) ?? flatList(lines.slice(i, end));
  if (!list || (afterText && list.ordered && list.start !== 1)) return { end };
  return { block: { kind: 'list', list }, end };
}

/** 一个无空行的文本块里，从 i 行起识别一个非段落块；返回 null 表示这一行是段落文字。block 缺省表示 [i,end) 都是段落文字。 */
function blockAt(lines: string[], i: number, depth: number, afterText: boolean): { block?: Block; end: number } | null {
  const line = lines[i];
  const heading = HEADING.exec(line);
  if (heading) return { block: { kind: 'heading', text: heading[1] }, end: i + 1 };
  if (RULE.test(line)) return { block: { kind: 'rule' }, end: i + 1 };
  if (QUOTE.test(line) && depth < MAX_QUOTE_DEPTH) {
    let end = i;
    const inner: string[] = [];
    while (end < lines.length) {
      const q = QUOTE.exec(lines[end]);
      if (!q) break;
      inner.push(q[1]);
      end++;
    }
    return { block: { kind: 'quote', blocks: parseMarkdown(inner.join('\n'), {}, depth + 1) }, end };
  }
  return tableAt(lines, i) ?? listAt(lines, i, afterText);
}

function chunkBlocks(lines: string[], depth: number): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) out.push({ kind: 'para', lines: para }); para = []; };
  for (let i = 0; i < lines.length;) {
    const step = blockAt(lines, i, depth, para.length > 0);
    if (!step) { para.push(lines[i++]); continue; }
    if (step.block) { flush(); out.push(step.block); } else para.push(...lines.slice(i, step.end));
    i = step.end;
  }
  flush();
  return out;
}

export function parseMarkdown(text: string, opts: ParseOptions = {}, depth = 0): Block[] {
  const lines = normalize(text).split('\n');
  const out: Block[] = [];
  let buffer: string[] = [];
  const flush = () => { splitBlank(buffer).forEach(chunk => out.push(...chunkBlocks(chunk, depth))); buffer = []; };
  let i = 0;
  if (opts.fenceFrom) {
    const close = findClose(lines, 0, opts.fenceFrom);
    out.push({ kind: 'code', body: codeBody(lines, 0, close < 0 ? lines.length : close, 0) });
    i = close < 0 ? lines.length : close + 1;
  }
  /* CW07：逐行扫描并按反引号长度配对闭合。流式输出里尚未闭合的围栏立刻按代码块渲染，
   * 避免补上闭围栏时整段从段落跳成代码块；已结束的消息里未闭合围栏仍按正文，不吞后续。 */
  for (; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]);
    if (!open) { buffer.push(lines[i]); continue; }
    const close = findClose(lines, i + 1, open[2].length);
    if (close < 0 && !opts.streaming && !opts.fenceOpenEnd) { buffer.push(lines[i]); continue; }
    flush();
    out.push({ kind: 'code', body: codeBody(lines, i + 1, close < 0 ? lines.length : close, open[1].length) });
    if (close < 0) break;
    i = close;
  }
  flush();
  return out;
}
