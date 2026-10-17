import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('模型输出渲染（不可信内容）', () => {
  it('模型输出里的 HTML 只作为文字显示，不会变成元素', () => {
    const out = html('<script>alert(1)</script><img src=x onerror=alert(2)>');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;script&gt;');
  });

  it('粗体、行内代码、@提及', () => {
    const out = html('**开始探索** 用 `index.html`，@助手 去发布');
    expect(out).toContain('<b>开始探索</b>');
    expect(out).toContain('<code>index.html</code>');
    expect(out).toContain('<span class="mention">@助手</span>');
  });

  it('标题、无序列表、有序列表、代码块', () => {
    const out = html('## 计划\n\n- 一\n- 二\n\n1. 甲\n2. 乙\n\n```html\n<h1>hi</h1>\n```');
    expect(out).toContain('<h4>计划</h4>');
    expect(out).toContain('<ul><li>一</li><li>二</li></ul>');
    expect(out).toContain('<ol><li>甲</li><li>乙</li></ol>');
    expect(out).toContain('<pre class="md-code"><code>&lt;h1&gt;hi&lt;/h1&gt;</code></pre>');
  });
});

it('多张图片、带空格路径及括号链接按原位置渲染，代码里的示例不加载', () => {
  const text = '前文 ![海报](</work/图片 1.png>) 中间 ![二](https://cdn.example/a(2).png) 后文\n\n`![代码](a.png)`\n\n```md\n![代码块](b.png)\n```';
  const seen: string[] = [];
  const out = renderToStaticMarkup(<Markdown text={text} image={(source, alt, key) => { seen.push(source); return <span key={key} data-image={source}>{alt}</span>; }} />);
  expect(seen).toEqual(['/work/图片 1.png', 'https://cdn.example/a(2).png']);
  expect(out.indexOf('前文')).toBeLessThan(out.indexOf('data-image'));
  expect(out).toContain('<code>![代码](a.png)</code>');
});

it('本地图片链接按来源去重', () => {
  const source = '/workspace/artwork/dog.png';
  const seen: string[] = [];
  renderToStaticMarkup(<Markdown text={`[查看小狗图片](<${source}>)\n\n![小金毛](<${source}>)\n\n\`![代码](<${source}>)\``} image={(s, a, k) => { seen.push(s); return <span key={k}>{a}</span>; }} />);
  expect(seen).toEqual([source]);
});
