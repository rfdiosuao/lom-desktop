import { fileManagerName } from '@/core/platform';
import { Btn, IconBtn } from '@/shared/ui/Button';
import { Spinner } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { Empty } from '@/shared/ui/Layout';
import { toast, toastError } from '@/shared/overlays/controller';
import { basename } from '@/shared/lib/util';
import { useStore } from '@/state/store';
import { fmtSize } from '../runtime/fileKind';
import { openFile, openInSystem, revealInSystem } from '../runtime/workspace';

/* 文件阅读区：文本显示正文（过长截断并提示）；二进制和过大的文件只给类型、大小和「用默认应用打开」（WS-TREE-01） */

export function FileReading() {
  const s = useStore();
  const file = s.openFile || '', info = s.openFileInfo;
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('当前环境不支持复制');
      await navigator.clipboard.writeText(s.openFileContent);
      toast('已复制文件内容');
    } catch (e) { toastError('复制失败', e); }
  };
  const system = () => { void openInSystem(file).catch(e => toastError('打开失败', e)); };
  const openBtn = <Btn label="用默认应用打开" ic="external" variant="secondary" size="sm" onClick={system} />;
  const ext = /\.[^.\\/]+$/.exec(file)?.[0] || '';
  return <section className="file-reading" aria-label="文件阅读区">
    <div className="file-reading__head">
      <Icon name="file" /><span className="grow ellipsis" title={s.openFile || ''}>{s.openFile ? basename(s.openFile) : '文件预览'}</span>
      {s.openFile && <>
        <IconBtn ic="copy" label="复制内容" size="sm" disabled={!s.openFileContent} onClick={() => void copy()} />
        <IconBtn ic="external" label="用默认应用打开" size="sm" onClick={system} />
        <IconBtn ic="close" label="关闭文件预览" size="sm" onClick={() => void openFile(null)} />
      </>}
    </div>
    {s.openFile && s.openFileError
      ? <Empty ic="info" title="打不开这个文件" desc={s.openFileError} actions={<Btn label={fileManagerName() ? `在${fileManagerName()}中显示` : '在文件管理器中显示'} ic="external" variant="secondary" size="sm" onClick={() => { void revealInSystem(file).catch(e => toastError('打开失败', e)); }} />} />
      : info?.kind === 'binary'
      ? <Empty ic="file" title="这个文件不能在这里预览" desc={`${ext ? `${ext} 文件` : '二进制文件'} · ${fmtSize(info.size)}。请用默认应用打开。`} actions={openBtn} />
      : info?.kind === 'large'
      ? <Empty ic="info" title="文件太大，没有在这里读取" desc={`${fmtSize(info.size)}，在这里读取会卡住界面。请用默认应用打开。`} actions={openBtn} />
      : s.openFile
      ? <>
        {info?.truncated && <p className="file-browser__note" role="status">文件较大，只显示前面一部分（最多 512 KB / 5000 行），完整内容请用默认应用打开。</p>}
        <div className="code" tabIndex={0} aria-label="文件内容">{s.openFileContent ? s.openFileContent.split('\n').map((line, i) => <div key={i} className="code__line">{line || ' '}</div>) : <div className="file-reading__loading"><Spinner />读取中…</div>}</div>
      </>
      : <Empty ic="file" title="选择一个文件" desc="目录会保留在旁边，方便连续查看。" />}
  </section>;
}
