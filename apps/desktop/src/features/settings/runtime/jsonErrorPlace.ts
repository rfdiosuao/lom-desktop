/**
 * 找到 JSON 文本里第一个语法错误的位置。不同浏览器内核给出的异常文字各不相同（多数不带位置），
 * 所以这里自己扫一遍，让「第几行第几列」在所有平台上一致。文本本身是合法 JSON 时返回 undefined。
 */
export function jsonErrorPlace(source: string): { line: number; column: number } | undefined {
  let i = 0;
  const fail = (): never => { throw i; };
  const ws = () => { while (i < source.length && ' \t\r\n'.includes(source[i])) i++; };
  const expect = (char: string) => { if (source[i] !== char) fail(); i++; };
  const text = () => {
    expect('"');
    while (source[i] !== '"') {
      if (i >= source.length || source[i] < ' ') fail();
      if (source[i] === '\\') { i++; if (!'"\\/bfnrtu'.includes(source[i] ?? '')) fail(); }
      i++;
    }
    i++;
  };
  const literal = () => {
    const number = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
    number.lastIndex = i;
    const hit = number.exec(source);
    if (hit) { i += hit[0].length; return; }
    const word = ['true', 'false', 'null'].find(w => source.startsWith(w, i));
    if (!word) fail();
    i += word!.length;
  };
  const items = (close: string, item: () => void) => {
    i++; ws();
    if (source[i] === close) { i++; return; }
    for (;;) {
      item(); ws();
      if (source[i] === close) { i++; return; }
      expect(','); ws();
    }
  };
  const value = (): void => {
    ws();
    if (source[i] === '{') items('}', () => { ws(); text(); ws(); expect(':'); value(); });
    else if (source[i] === '[') items(']', value);
    else if (source[i] === '"') text();
    else literal();
  };
  try { value(); ws(); if (i < source.length) fail(); return undefined; }
  catch (at) {
    if (typeof at !== 'number') throw at;
    const before = source.slice(0, at);
    return { line: before.split('\n').length, column: at - before.lastIndexOf('\n') };
  }
}
