import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('D01 §5 模型输出渲染（不可信内容）', () => {
  it('D01 §5 模型输出里的 HTML 只作为文字显示，不会变成元素', () => {
    const out = html('<script>alert(1)</script><img src=x onerror=alert(2)>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
  });

  it('D01 粗体、行内代码、@提及', () => {
    const out = html('**开始探索** 用 `index.html`，@手机一号 去发布');
    expect(out).toContain('<b>开始探索</b>');
    expect(out).toContain('<code>index.html</code>');
    expect(out).toContain('<span class="mention">@手机一号</span>');
  });

  it('D01 标题、无序列表、有序列表、代码块', () => {
    const out = html('## 计划\n\n- 一\n- 二\n\n1. 甲\n2. 乙\n\n```html\n<h1>hi</h1>\n```');
    expect(out).toContain('<h4>计划</h4>');
    expect(out).toContain('<ul><li>一</li><li>二</li></ul>');
    expect(out).toContain('<ol><li>甲</li><li>乙</li></ol>');
    expect(out).toContain('<pre class="md-code"><code>&lt;h1&gt;hi&lt;/h1&gt;</code></pre>');
  });
});

it('D08 多张图片、带空格路径及括号链接按原位置渲染，代码里的示例不加载', () => {
  const text = '前文 ![海报](</work/图片 1.png>) 中间 ![二](https://cdn.example/a(2).png) 后文\n\n`![代码](a.png)`\n\n```md\n![代码块](b.png)\n```';
  const seen: string[] = [];
  const out = renderToStaticMarkup(<Markdown text={text} image={(source, alt, key) => { seen.push(source); return <span key={key} data-image={source}>{alt}</span>; }} />);
  expect(seen).toEqual(['/work/图片 1.png', 'https://cdn.example/a(2).png']);
  expect(out.indexOf('前文')).toBeLessThan(out.indexOf('data-image'));
  expect(out).toContain('<code>![代码](a.png)</code>');
});

it('D11 截图中的 Codex 绝对路径图片及普通图片链接可预览', () => {
  const source = '/Users/a1-6/.codex/generated_images/01a141f7-c53e-7001-9151-6bd4d423f015/exec-fee2ab38-a0cd-4783-9ea3-e96498292ef7.png';
  const seen: string[] = [];
  renderToStaticMarkup(<Markdown text={`[查看小狗图片](<${source}>)\n\n![小金毛](<${source}>)\n\n\`![代码](<${source}>)\``} image={(s, a, k) => { seen.push(s); return <span key={k}>{a}</span>; }} />);
  expect(seen).toEqual([source]);
});

/* ===== CW07：渲染不得改写正文（issue #83 关闭条件逐条对应） ===== */

const withFile = (text: string) => {
  const opened: string[] = [];
  const out = renderToStaticMarkup(<Markdown text={text} file={(p, l, k) => { opened.push(p); return <button key={k} className="message-path">{l}</button>; }} />);
  return { out, opened };
};

describe('CW07 单个疑似列表项不被吃成列表，原文完整保留', () => {
  it.each([
    '127.0.0.1 是本机',
    '3.14 是圆周率',
    '1.2.3 已发布',
    '2026. 年中',
  ])('CW07 %s 保持原文且不是列表', line => {
    const out = html(line);
    expect(out).toContain(line);
    expect(out).not.toContain('<ol');
  });

  it('CW07 版本号连续两行也不是有序列表（序号不递增）', () => {
    const out = html('1.2.3 已发布\n1.2.4 已修复');
    expect(out).not.toContain('<ol');
    expect(out).toContain('1.2.3 已发布');
    expect(out).toContain('1.2.4 已修复');
  });

  it('CW07 真正的有序列表仍是列表', () => {
    expect(html('1. 第一项\n2. 第二项')).toContain('<ol><li>第一项</li><li>第二项</li></ol>');
  });

  it('CW07 序号不连续的两行不判为有序列表', () => {
    const out = html('1. 第一项\n3. 第三项');
    expect(out).not.toContain('<ol');
    expect(out).toContain('1. 第一项');
    expect(out).toContain('3. 第三项');
  });

  it('CW07 真正的单项列表仍保留数字语义', () => {
    expect(html('1. 唯一项')).toContain('<ol><li>唯一项</li></ol>');
    expect(html('3. 从三开始')).toContain('<ol start="3"><li>从三开始</li></ol>');
    expect(html('1、甲')).toContain('<ol><li>甲</li></ol>');
  });

  it('CW07 单项但点后无空格的 `1.甲` 仍按正文，不拆成列表', () => {
    const out = html('1.甲');
    expect(out).toContain('1.甲');
    expect(out).not.toContain('<ol');
  });

  it('CW07 点后无空格与中文顿号的有序列表仍保留数字语义', () => {
    expect(html('1.甲\n2.乙')).toContain('<ol><li>甲</li><li>乙</li></ol>');
    expect(html('1、甲\n2、乙')).toContain('<ol><li>甲</li><li>乙</li></ol>');
  });

  it('CW07 空行分隔的有序列表仍是同一个列表，且非 1 起始保留 start', () => {
    expect(html('1. 甲\n\n2. 乙')).toContain('<ol><li>甲</li><li>乙</li></ol>');
    expect(html('3. 丙\n4. 丁')).toContain('<ol start="3"><li>丙</li><li>丁</li></ol>');
  });
});

describe('CW07 代码围栏不吞语言前缀与后续内容', () => {
  it.each([
    ['```c++\nint x;\n```', 'int x;'],
    ['```c#\nvar x;\n```', 'var x;'],
  ])('CW07 %s 整块进代码且不泄漏语言符号', (input, body) => {
    const out = html(input);
    expect(out).toContain(`<pre class="md-code"><code>${body}</code></pre>`);
    expect(out).not.toContain('++');
    expect(out).not.toContain('#');
  });

  it('CW07 缩进 0-3 空格、info string、四反引号围栏都能成块', () => {
    expect(html('  ```js title=x\nconst a = 1;\n  ```')).toContain('<pre class="md-code"><code>const a = 1;</code></pre>');
    expect(html('````md\n```\ninside\n```\n````')).toContain('<pre class="md-code"><code>```\ninside\n```</code></pre>');
  });

  it('CW07 闭合围栏必须不短于开启围栏', () => {
    const closed = html('````md\ncode\n````');
    expect(closed).toContain('<pre class="md-code"><code>code</code></pre>');
    const shorter = html('````md\ncode\n```');
    expect(shorter).not.toContain('<pre');
    expect(shorter).toContain('code');
  });

  it('CW07 流式未闭合围栏立即按代码块渲染，闭合后不跳版式', () => {
    const partial = renderToStaticMarkup(<Markdown text={'```js\nconst a = 1'} streaming />);
    expect(partial).toContain('<pre class="md-code"><code>const a = 1</code></pre>');
    expect(partial).not.toContain('<p>');
    const complete = renderToStaticMarkup(<Markdown text={'```js\nconst a = 1\n```'} streaming />);
    expect(complete).toContain('<pre class="md-code"><code>const a = 1</code></pre>');
  });

  it('CW07 已结束消息里未闭合围栏不吞后续说明', () => {
    const out = html('```\n说明');
    expect(out).toContain('说明');
    expect(out).not.toContain('<pre');
  });

  it('CW07 正文中单独出现的 ``` 不开启围栏', () => {
    const out = html('用 ``` 包起来即可');
    expect(out).toContain('用');
    expect(out).toContain('包起来即可');
    expect(out).not.toContain('<pre');
  });
});

describe('CW07 @提及不吞技术正文', () => {
  it.each(['@param', '@media', '@Override'])('CW07 %s 不变成提及胶囊', token => {
    expect(html(`见 ${token} 说明`)).not.toContain('class="mention"');
  });

  it('CW07 缺失右边界时不再贪婪吞掉后续正文', () => {
    for (const text of ['@小麓请帮我看看这个文件', '@张三今天做了什么']) {
      const out = html(text);
      expect(out).not.toContain('class="mention"');
      expect(out).toContain(text);
    }
  });

  it('CW07 有明确右边界时真人仍可提及', () => {
    expect(html('@电脑主控 去做')).toContain('<span class="mention">@电脑主控</span>');
    expect(html('@手机一号 发布')).toContain('<span class="mention">@手机一号</span>');
    expect(html('@小麓，请帮我看看')).toContain('<span class="mention">@小麓</span>');
  });
});

describe('CW07 正文里的斜杠词组不是文件路径', () => {
  it.each(['TCP/IP 协议', 'and/or', 'CI/CD', '24/7', '1/2', '10/21', 'A/B', 'HTTP/2', '输入/输出', 'n/a', '读/写', '3.14/2', 'example.com/path', 'github.com/foo/bar.md', 'example.com/a/b.ts'])(
    'CW07 %s 不产生 message-path 且原文完整', text => {
      const { out, opened } = withFile(text);
      expect(opened).toEqual([]);
      expect(out).not.toContain('message-path');
      expect(out).toContain(text);
    });
});

describe('CW07 显式路径与带目录的相对路径可打开', () => {
  it.each(['/work/out', '~/notes/todo.md', './a.md', '../docs/x.md', 'src/a.ts', 'docs/guide.md', './github.com/foo.md', 'C:\\Users\\a.txt', 'c:/Users/a.txt'])(
    'CW07 %s 渲染为可打开入口', path => {
      const { opened } = withFile(`文件：${path}`);
      expect(opened).toEqual([path]);
    });
});

describe('CW07 行内代码与裸串不误判为文件路径', () => {
  it.each(['README.md', 'Node.js', 'e.g', 'v1.2', '3.14'])('CW07 电脑任务里 %s 仍是行内代码', token => {
    const { out, opened } = withFile(`\`${token}\``);
    expect(out).toContain('<code>');
    expect(opened).toEqual([]);
  });

  it('CW07 D15：行内代码里的短路径 a.md 仍可点击', () => {
    const { opened } = withFile('看 `a.md` 和 `docs/b.ts`');
    expect(opened).toEqual(['a.md', 'docs/b.ts']);
  });

  it('CW07 正文里的裸文件名与版本号不打开文件', () => {
    const { out, opened } = withFile('README.md 版本 1.2.3，目录 3.14 个');
    expect(opened).toEqual([]);
    expect(out).toContain('README.md');
    expect(out).toContain('1.2.3');
  });

  it('CW07 正文里没有目录分隔的裸文件名（含中文）仍按正文', () => {
    const { out, opened } = withFile('报告.pdf 和 我的 文档.docx');
    expect(opened).toEqual([]);
    expect(out).toContain('报告.pdf');
    expect(out).toContain('文档.docx');
  });
});

describe('CW07 嵌套列表保持层级', () => {
  it('CW07 缩进的无序子项嵌在父项里，不再压成同一级', () => {
    expect(html('- 外层\n  - 内层')).toBe('<ul><li>外层<ul><li>内层</li></ul></li></ul>');
  });

  it('CW07 多层嵌套，回退到上一层后继续同级', () => {
    const out = html('- 甲\n  - 甲一\n    - 甲一a\n  - 甲二\n- 乙');
    expect(out).toBe('<ul><li>甲<ul><li>甲一<ul><li>甲一a</li></ul></li><li>甲二</li></ul></li><li>乙</li></ul>');
  });

  it('CW07 有序列表下的无序子项，序号和层级都保留', () => {
    expect(html('1. 第一\n   - 子项\n2. 第二')).toBe('<ol><li>第一<ul><li>子项</li></ul></li><li>第二</li></ol>');
    expect(html('3. 从三开始\n   - 子项\n4. 下一项')).toContain('<ol start="3">');
  });

  it('CW07 无序父项下的有序子项', () => {
    expect(html('- 步骤\n  1. 先做\n  2. 再做')).toBe('<ul><li>步骤<ol><li>先做</li><li>再做</li></ol></li></ul>');
  });

  it('CW07 制表符缩进同样算子项', () => {
    expect(html('- 外层\n\t- 内层')).toBe('<ul><li>外层<ul><li>内层</li></ul></li></ul>');
  });

  it('CW07 子项里的粗体、行内代码照常渲染，HTML 仍只是文字', () => {
    const out = html('- 外层\n  - **重点** 用 `a.md` <b>x</b>');
    expect(out).toContain('<b>重点</b>');
    expect(out).toContain('<code>a.md</code>');
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(out).not.toContain('<b>x</b>');
  });

  it('CW07 没有缩进的列表保持原样；只缩进 1 格不算子项', () => {
    expect(html('- 一\n- 二')).toBe('<ul><li>一</li><li>二</li></ul>');
    expect(html('1. 甲\n2. 乙')).toBe('<ol><li>甲</li><li>乙</li></ol>');
    expect(html('- 一\n - 二')).toBe('<ul><li>一</li><li>二</li></ul>');
  });

  it('CW07 带缩进行时，年份、版本号开头的行仍然是正文，不被吃掉数字', () => {
    const out = html('2026. 年中\n  - 备注');
    expect(out).toContain('2026. 年中');
    expect(out).not.toContain('<ol');
    const ip = html('127.0.0.1 是本机\n  - 备注');
    expect(ip).toContain('127.0.0.1 是本机');
    expect(ip).not.toContain('<ol');
  });

  it('CW07 列表项下缩进的说明文字不丢；CW06 起它是该项的续行，层级不再被打散', () => {
    const out = html('- 外层\n  补充说明\n  - 内层');
    expect(out).toContain('补充说明');
    expect(out).toBe('<ul><li>外层<br/>补充说明<ul><li>内层</li></ul></li></ul>');
  });
});
