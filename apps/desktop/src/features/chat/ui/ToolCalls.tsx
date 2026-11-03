import { useMemo } from 'react';
import { toggleEvent } from '../actions/conversations';
import { ReplyImage } from '@/shared/ui/ReplyImage';
import { Spinner } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { SiteIcon } from '@/shared/ui/SiteIcon';
import { toolSite, toolState } from '../runtime/toolIdentity';
import { toolSummary } from '../runtime/tools';
import { searchSourcesOf } from '../runtime/searchSources';
import { SearchSources } from './SearchSources';
import { Elapsed } from './Elapsed';
import { conv } from '@/state/selectors';
import { update, useStore } from '@/state/store';
import type { Msg } from '@/state/types';
import { cx } from '@/shared/lib/util';

/* ===== 工具调用：连着的几次调用折叠成一组「运行了 N 条命令」，每次调用一行一句话，点开看命令和输出 ===== */

const TOOL_ICONS: Record<string, string> = {
  读取文件: 'file', 写入文件: 'fileCode', 修改文件: 'edit', 运行命令: 'terminal', 打开应用: 'phone', 点击: 'hand', 输入: 'keyboard', 截图: 'camera',
  读取界面: 'scan', 读取任务记录: 'history', 运行任务: 'play', 安装: 'download', 滑动: 'hand', 搜索内容: 'search', 查找文件: 'search',
  调用技能: 'grid', 派生子任务: 'people', 进入规划: 'flag', 完成规划: 'flag', 查找工具: 'search', 联网搜索: 'globe', 读取网页: 'globe', 更新计划: 'flag',
  生成图片: 'image',
};
const iconOf = (m: Msg) => {
  const raw = (m.toolName || '').replace(/^mcp__.+?__/, '');
  if (raw.startsWith('phone_')) return 'phone';
  if (raw.startsWith('agent_')) return 'people';
  if (raw === 'lom_view_image') return 'image';
  return TOOL_ICONS[m.tool || ''] || 'terminal';
};
const isCommand = (m: Msg) => m.tool === '运行命令' || m.toolName === 'Bash' || m.toolName === 'ExecCommand';

/** 组标题：「运行了 2 条命令，调用了 3 个工具」 */
function summary(items: Msg[]) {
  const commands = items.filter(isCommand).length, others = items.length - commands;
  return [commands && `运行了 ${commands} 条命令`, others && `调用了 ${others} 个工具`].filter(Boolean).join('，');
}

function ToolRow({ m }: { m: Msg }) {
  const s = useStore();
  const open = !!s.eventOpen[m.id];
  const text = toolSummary(m);
  const details = !!(m.toolName || m.args || m.command || m.output || m.detail);
  const site = toolSite(m), state = toolState(m);
  return (
    <div className={cx('tool', open && 'is-open', m.status === 'error' && 'is-error')}>
      <button type="button" className="tool__row" onClick={() => details && toggleEvent(m.id)} aria-expanded={details ? open : undefined} disabled={!details} title={text}>
        <span className={cx('tool__state', m.status === 'done' && 'is-done')} title={state.label}>{m.status === 'running' ? <Spinner size={12} /> : <Icon name={state.icon} />}</span>
        <span className="tool__identity">{site ? <SiteIcon url={site} fallback={<Icon name={iconOf(m)} />} /> : <Icon name={iconOf(m)} />}</span>
        <span className="tool__text">{text}</span>
        {m.status === 'error' && <span className="tool__fail">失败</span>}
        <Elapsed items={[m]} active={m.status === 'running'} compact />
        {details && <Icon name="chevron" className="tool__chev" />}
      </button>
      {open && details && <div className="tool__body">
        {m.toolName && <><span>工具名称</span><pre>{m.toolName}</pre></>}
        {m.args && <><span>调用参数</span><pre>{JSON.stringify(m.args, null, 2)}</pre></>}
        {m.command && <><span>执行命令</span><pre>{m.command}</pre></>}
        {!m.args && m.detail && <><span>调用详情</span><pre>{m.detail}</pre></>}
        {m.output && <><span>原始输出</span><pre>{m.output}</pre></>}
      </div>}
    </div>
  );
}

/** 连着的工具调用。只有一次时不加组标题；点标题切换。默认：组内还在运行，或所在的一轮还没结束（live，UI-AUDIT-05 F-10）时展开，
 *  整轮结束后收起；与执行过程（ActivityGroup）的默认一致。过程组里由外层的 expanded 决定。 */
export function ToolCalls({ items, ctxId, compact = false, expanded, live = false }: { items: Msg[]; ctxId: string; compact?: boolean; expanded?: boolean; live?: boolean }) {
  const s = useStore();
  const id = `tools:${items[0].id}`;
  const running = items.some(m => m.status === 'running');
  const failed = items.filter(m => m.status === 'error').length;
  const open = expanded ?? (items.length === 1 || (s.eventOpen[id] ?? (running || live)));
  const c = conv(ctxId.replace(/^conv:/, ''));
  const images = items.filter(m => m.status === 'done' && m.images?.length);
  // 流式刷新时 items 每次都是新数组；用稳定签名避免每帧重复 JSON.parse
  const sourceKey = items.map(m => `${m.id}:${m.toolName ?? m.tool ?? ''}:${m.status}:${m.output?.length ?? 0}`).join('|');
  const sources = useMemo(() => searchSourcesOf(items), [sourceKey]);
  // 过程组收起时，没有失败行、来源和图片就不留空白的工具条
  if (compact && !open && !failed && !sources.length && !images.length) return null;
  return (
    <div className={cx('tools', compact && 'tools--compact')}>
      {!compact && items.length > 1 && (
        <button type="button" className="tools__head" onClick={() => update(st => { st.eventOpen[id] = !open; })} aria-expanded={open}>
          {running && <Spinner size={12} />}<span>{summary(items)}</span>{failed > 0 && <span className="tool__fail">{failed} 个失败</span>}
          <Elapsed items={items} active={running} />
          <Icon name="chevron" className={cx('tools__chev', open && 'is-open')} />
        </button>
      )}
      {(open || failed > 0) && <div className="tools__list">{(open ? items : items.filter(m => m.status === 'error')).map(m => <ToolRow key={m.id} m={m} />)}</div>}
      {sources.length > 0 && <SearchSources sources={sources} />}
      {images.map(m => m.images!.map(source => <ReplyImage key={`${m.id}:${source}`} source={source} alt="Agent 生成的图片"
        context={{ account: s.account?.id || 'local', conversation: ctxId, message: m.callId || m.id, workspace: c?.workspace }} />))}
    </div>
  );
}
