import { useEffect, useState } from 'react';
import { Button } from './components/Button';
import { Gallery } from './desktop/Gallery';
import { Activity } from './components/Activity';
import { Markdown } from './components/Markdown';
import { openDocument, saveDocument, type Document } from './core/documents';

const welcome: Document = { name: '欢迎使用.md', kind: 'text', content: `# 一个轻巧的本地工作台

这里是 **Lom Desktop** 的开源桌面外壳。

- 打开本地 Markdown、文本或图片
- 在左边编辑文字，在右边即时预览
- 切换明暗主题，保存一份自己的文档

## 为桌面开发者准备

复用窗口、设计令牌、图标、Markdown 渲染和系统文件对话框，构建你自己的桌面应用。

这份源码不包含 AI 执行引擎、账号服务或手机连接。本地文档不联网；可选 CLI 连接层只访问本机运行时，没有模拟的 AI 回复。

\`开始创作吧。\`` };

export function App() {
  const [view, setView] = useState<'documents' | 'components'>('documents');
  const [doc, setDoc] = useState<Document>(welcome);
  const [dark, setDark] = useState(() => localStorage.getItem('desktop-theme') !== 'light');
  const [pending, setPending] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    localStorage.setItem('desktop-theme', dark ? 'dark' : 'light');
  }, [dark]);
  async function open() {
    if (pending) return;
    setPending('正在打开…'); setNotice('');
    try { const selected = await openDocument(); if (selected) { setDoc(selected); setView('documents'); } }
    catch (error) { setNotice(String(error)); }
    finally { setPending(''); }
  }
  async function save() {
    if (pending) return;
    setPending('正在保存…'); setNotice('');
    try { if (await saveDocument(doc.content)) setNotice('已导出文档'); }
    catch (error) { setNotice(String(error)); }
    finally { setPending(''); }
  }
  return <div className="workspace">
    <aside className="sidebar">
      <div className="brand"><img src="/logo.png" alt="Lom" /><div>Lom <span>Desktop</span></div></div>
      <p className="eyebrow">本地工作台</p>
      <Button className="primary" icon="folder" onClick={() => void open()} disabled={!!pending}>打开文件</Button>
      <Button icon="file" onClick={() => { setDoc(welcome); setNotice(''); setView('documents'); }} disabled={!!pending}>欢迎使用</Button>
      <Button icon="cube" onClick={() => setView(view === 'documents' ? 'components' : 'documents')}>{view === 'documents' ? '桌面组件与 CLI' : '返回文档'}</Button>
      <div className="sidebar-bottom"><p>只在你的电脑上处理文档。<br />无需登录，无需配置密钥。</p>
        <Button icon="sun" onClick={() => setDark(!dark)}>{dark ? '切换浅色' : '切换深色'}</Button>
      </div>
    </aside>
    <main>
      {view === 'components' ? <Gallery /> : <>
      <header><div><h1>{doc.name}</h1><span className="subtitle">Lom Desktop · 开源桌面外壳</span></div>
        <Button icon="download" onClick={() => void save()} disabled={!!pending || doc.kind !== 'text'}>导出 Markdown</Button>
      </header>
      <div className="status">{pending ? <Activity label={pending} /> : <span>本地文档 · {doc.kind === 'text' ? '编辑与预览' : '图片预览'}</span>}
        {notice && <span role="status" className="notice">{notice}</span>}</div>
      {doc.kind === 'text' ? <div className="panes">
        <section className="editor"><h2>源文档</h2><textarea aria-label="Markdown 源文档" spellCheck={false} value={doc.content} onChange={e => setDoc({ ...doc, content: e.target.value })} /></section>
        <section className="preview"><h2>预览</h2><article><Markdown text={doc.content} /></article></section>
      </div> : <section className="image-preview"><img src={doc.content} alt={doc.name} /></section>}
      </>}
      <footer>这份开源源码可独立运行。完整 Lom 产品请访问官网。</footer>
    </main>
  </div>;
}
