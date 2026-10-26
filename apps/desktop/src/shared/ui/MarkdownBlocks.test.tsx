import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';
import { openFenceAtEnd } from './markdownBlocks';

const html = (text: string, props: Partial<Parameters<typeof Markdown>[0]> = {}) => renderToStaticMarkup(<Markdown text={text} {...props} />);

/* ===== CW06 块级：标题、列表、引用、表格、分隔线不依赖「整段都是同一种东西」 ===== */

describe('CW06 块与块之间不需要空行', () => {
  it('CW06 说明句后紧跟的列表按列表渲染，说明句留在段落里', () => {
    expect(html('步骤如下：\n- 先看\n- 再改')).toBe('<p>步骤如下：</p><ul><li>先看</li><li>再改</li></ul>');
    expect(html('步骤如下：\n1. 先看\n2. 再改')).toBe('<p>步骤如下：</p><ol><li>先看</li><li>再改</li></ol>');
  });

  it('CW06 列表后紧跟的正文单独成段，不再把整段退回成带符号的正文', () => {
    expect(html('- 先看\n- 再改\n以上就是全部')).toBe('<ul><li>先看</li><li>再改</li></ul><p>以上就是全部</p>');
  });

  it('CW06 段落中间的标题按标题渲染，前后文字各自成段', () => {
    expect(html('前言\n## 小结\n结尾')).toBe('<p>前言</p><h4>小结</h4><p>结尾</p>');
    expect(html('# 一\n## 二\n正文')).toBe('<h4>一</h4><h4>二</h4><p>正文</p>');
  });

  it('CW06 非 1 开头的数字行接在说明句后面仍是正文，年份、序号不会被吃成列表', () => {
    const out = html('我在说\n3. 这是正文里的编号');
    expect(out).toBe('<p>我在说<br/>3. 这是正文里的编号</p>');
    expect(html('发布于\n2026. 年中')).not.toContain('<ol');
  });

  it('CW06 列表项下缩进的说明是该项的续行，编号和嵌套层级都保留', () => {
    expect(html('1. **安装**\n   先装依赖\n2. **运行**\n   再启动')).toBe('<ol><li><b>安装</b><br/>先装依赖</li><li><b>运行</b><br/>再启动</li></ol>');
  });

  it('CW06 分隔线单独成块；`**粗体**` 一行不会被当成分隔线', () => {
    expect(html('上\n---\n下')).toBe('<p>上</p><hr/><p>下</p>');
    expect(html('***')).toBe('<hr/>');
    expect(html('**粗体**')).toBe('<p><b>粗体</b></p>');
  });

  it('CW06 CRLF 换行的输出和 LF 渲染结果一样（围栏、空行分段都不受影响）', () => {
    const lf = '## 计划\n\n- 一\n- 二\n\n```ts\nconst a = 1;\n```\n\n结尾';
    expect(html(lf.replace(/\n/g, '\r\n'))).toBe(html(lf));
  });
});

describe('CW06 引用块', () => {
  it('CW06 连续的 > 行合成一个引用，里面的列表、粗体照常渲染', () => {
    expect(html('> **注意**\n> - 一\n> - 二')).toBe('<blockquote><p><b>注意</b></p><ul><li>一</li><li>二</li></ul></blockquote>');
  });

  it('CW06 引用前后的正文不被吞进引用', () => {
    expect(html('前\n> 引用\n后')).toBe('<p>前</p><blockquote><p>引用</p></blockquote><p>后</p>');
  });

  it('CW06 引用里的围栏是代码块，围栏里的 > 不是引用', () => {
    expect(html('> ```\n> a\n> ```')).toContain('<blockquote><pre class="md-code"><code>a</code></pre></blockquote>');
    expect(html('```\n> 不是引用\n```')).toBe('<pre class="md-code"><code>&gt; 不是引用</code></pre>');
  });

  it('CW06 嵌套引用有层数上限，超出的 > 留作文字，不会无限递归', () => {
    const out = html(`${'>'.repeat(50)} 深`);
    expect(out.split('<blockquote>').length - 1).toBeLessThanOrEqual(5);
    expect(out).toContain('深');
  });
});

describe('CW06 表格', () => {
  const table = '| 名称 | 数量 | 备注 |\n| :-- | --: | :-: |\n| **苹果** | 3 | `ok` |\n| 梨 | 12 | 甜 |';

  it('CW06 表头、对齐和数据行都渲染，单元格里的行内格式照常生效', () => {
    const out = html(table);
    expect(out).toContain('<div class="md-table"><table>');
    expect(out).toContain('<th style="text-align:left">名称</th><th style="text-align:right">数量</th><th style="text-align:center">备注</th>');
    expect(out).toContain('<td style="text-align:left"><b>苹果</b></td><td style="text-align:right">3</td><td style="text-align:center"><code>ok</code></td>');
    expect(out.match(/<tr>/g)).toHaveLength(3);
  });

  it('CW06 没有首尾竖线、没有对齐标记的写法同样成表；转义竖线是单元格里的字面竖线', () => {
    const out = html('a | b\n- | -\n1 \\| 2 | 3');
    expect(out).toContain('<th>a</th><th>b</th>');
    expect(out).toContain('<td>1 | 2</td><td>3</td>');
  });

  it('CW06 数据行列数不齐时补空、多余的截掉；表格流式输出到一半也不抛错', () => {
    const ragged = html('| a | b |\n| - | - |\n| 1 |\n| 1 | 2 | 3 |');
    expect(ragged).toContain('<td>1</td><td></td>');
    expect(ragged).not.toContain('<td>3</td>');
    expect(() => html('| a | b |\n| - |')).not.toThrow();
  });

  it('CW06 只有一行带竖线的文字、或分隔行列数对不上，仍是正文，原文不丢', () => {
    for (const text of ['a | b | c', '| a | b |\n| - |', '| a | b |\n| x | y |']) {
      const out = html(text);
      expect(out).not.toContain('<table');
      expect(out).toContain(text.split('\n')[0]);
    }
  });

  it('CW06 单元格里的 HTML 只是文字', () => {
    const out = html('| x |\n| - |\n| <img src=x onerror=alert(1)> |');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
});

describe('CW06 行内格式', () => {
  it('CW06 下划线粗体、斜体、删除线', () => {
    expect(html('__粗体__ 与 *斜体* 与 ~~删掉~~')).toBe('<p><b>粗体</b> 与 <i>斜体</i> 与 <del>删掉</del></p>');
    expect(html('这是*重点*内容')).toContain('<i>重点</i>');
  });

  it('CW06 标识符、乘号、通配符不被当成格式：__init__ snake_case_name 2*3*4 *.ts', () => {
    for (const text of ['__init__', '__main__ 入口', 'snake_case_name', '2*3*4', '匹配 *.ts 和 *.js 文件', 'a * b * c']) {
      const out = html(text);
      expect(out, text).not.toMatch(/<(b|i|del)>/);
      expect(out, text).toContain(text);
    }
  });

  it('CW06 行内代码里的格式符号原样保留', () => {
    expect(html('`*a* __b__ ~~c~~ [d](https://e.com)`')).toBe('<p><code>*a* __b__ ~~c~~ [d](https://e.com)</code></p>');
  });

  it('CW06 http(s) 链接可点击且带 noopener；文字里的格式照常渲染', () => {
    const out = html('看 [**官网**](https://example.com/a?b=1) 和 [维基](https://zh.wikipedia.org/wiki/Foo_(bar))');
    expect(out).toContain('<a class="md-link" href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer" title="https://example.com/a?b=1"><b>官网</b></a>');
    expect(out).toContain('href="https://zh.wikipedia.org/wiki/Foo_(bar)"');
  });

  it('CW06 裸网址自动成链接，句末标点、中文标点、不成对的右括号不算网址', () => {
    expect(html('见 https://example.com/a。')).toContain('<a class="md-link" href="https://example.com/a"');
    expect(html('(https://example.com/a)')).toContain('href="https://example.com/a"');
    expect(html('网址https://example.com/x，然后')).toContain('href="https://example.com/x"');
    expect(html('https://example.com/a.')).toContain('href="https://example.com/a"');
    expect(html('example.com/path 没有协议')).not.toContain('<a');
  });

  it('CW06 非 http(s) 的链接保持原文，不生成可点击链接', () => {
    for (const text of ['[点我](javascript:alert(1))', '[文件](file:///etc/passwd)', '[邮件](mailto:a@b.com)', '[相对](./a.md)']) {
      const out = html(text);
      expect(out, text).not.toContain('<a');
      expect(out, text).toContain(text.split('](')[0].slice(1));
    }
  });

  it('CW06 链接文字里的网址不会再嵌一层链接', () => {
    const out = html('[https://a.com](https://a.com)');
    expect(out.match(/<a /g)).toHaveLength(1);
  });
});

describe('CW06 围栏与列表', () => {
  it('CW06 列表项里缩进的围栏代码块去掉缩进，把列表切开后后半截的编号保持原样', () => {
    const out = html('1. 安装\n   ```bash\n   npm i\n   ```\n2. 运行');
    expect(out).toBe('<ol><li>安装</li></ol><pre class="md-code"><code>npm i</code></pre><ol start="2"><li>运行</li></ol>');
  });

  it('CW06 openFenceAtEnd 只在结尾确实停在围栏里时才返回围栏长度', () => {
    expect(openFenceAtEnd('说明\n```ts\nconst a = 1')).toBe(3);
    expect(openFenceAtEnd('````md\n```\n内层\n```')).toBe(4);
    expect(openFenceAtEnd('```\nx\n```\n结尾')).toBeUndefined();
    expect(openFenceAtEnd('尾巴\n```', 3)).toBeUndefined();
    expect(openFenceAtEnd('还在代码里', 3)).toBe(3);
  });

  it('CW06 上一段留下的围栏：本段开头按代码块，遇到闭合围栏后恢复正文', () => {
    const out = html('const b = 2;\n```\n后面的说明\n- 列表', { fenceFrom: 3 });
    expect(out).toBe('<pre class="md-code"><code>const b = 2;</code></pre><p>后面的说明</p><ul><li>列表</li></ul>');
  });

  it('CW06 本段结尾的围栏在下一段才闭合时，当前先按代码块渲染；没有后续时仍是正文', () => {
    expect(html('说明\n```ts\nconst a = 1;', { fenceOpenEnd: true })).toBe('<p>说明</p><pre class="md-code"><code>const a = 1;</code></pre>');
    expect(html('说明\n```ts\nconst a = 1;')).not.toContain('<pre');
  });
});

describe('CW06 不可信内容', () => {
  it('CW06 新增的块和行内规则都不会让 HTML 变成元素', () => {
    const out = html('> <script>1</script>\n\n| <b>x</b> |\n| - |\n| y |\n\n[<img src=x>](https://a.com) *<i>z</i>* ~~<u>w</u>~~');
    expect(out).not.toMatch(/<(script|img|u)\b/);
    expect(out).not.toContain('<b>x</b>');
    expect(out).toContain('&lt;script&gt;');
  });
});
