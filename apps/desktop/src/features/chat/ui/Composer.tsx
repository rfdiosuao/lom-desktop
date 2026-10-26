import { personalPermissionLabel } from '@/features/personal/runtime/permissions';
import { dropHistory, isHistoryDrop } from '@/features/history/runtime/historyImport';
import { toastError } from '@/shared/overlays/controller';
import { t } from '@/shared/i18n/index';
import { ComposerPlaceholder } from './ComposerPlaceholder';
import { composerHints } from './composerHints';
import { TurtleCard } from './TurtleCard';
import { convOfKey } from '@/features/teams/runtime/team';
import { GoalStrip } from './GoalStrip';
import { effortName, lomSupportsEffort } from '../runtime/commands';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { attachFiles, filesFrom } from '../actions/attachments';
import { isFileDrop } from '../actions/fileDrop';
import { afterComposerInput, removeAttach, runKeyOf, send, stopRun } from '../actions/composer';
import { slashHasChoice } from '../slash/slashMenu';
import { closeMenu, openMenu } from '@/shared/overlays/controller';
import { Dropdown, IconBtn } from '@/shared/ui/Button';
import { Spinner } from '@/shared/ui/Controls';
import { Icon } from '@/shared/ui/Icon';
import { agent, attached, currentPcModel, model, pcModels, perm, phone, phoneModelName } from '@/state/selectors';
import { agentRow, externalAgentName, externalEffort, externalModel } from '@/features/settings/runtime/agents';
import { prepareAgentTask } from '@/features/settings/runtime/agentWarmup';
import { getEndpoint } from '@/core/client';
import { isProbing } from '@/features/settings/runtime/agentOptions';
import { S, update, useStore } from '@/state/store';
import { cx } from '@/shared/lib/util';

/* ===== 输入框（首页、对话、团队窗格共用一个实现） ===== */

export function Composer({ ckey, compact = false, agentId, placeholder, toolbar = true, note = true }: {
  ckey: string; compact?: boolean; agentId?: string; placeholder?: string; toolbar?: boolean; note?: boolean;
}) {
  const s = useStore();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);
  // `focused` 一旦聚焦过就保持（它驱动 Codex 预热，失焦不能销毁预热好的会话：点发送按钮前输入框必然先失焦）；
  // 占位光标要跟着真实焦点走，所以单独记 `inputFocused`。
  const [focused, setFocused] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  // 电脑任务的 owner 是 'pc'（也是 p 开头），不能当成示例手机 p1、p2，否则 Codex 等外部 Agent 的任务会被当成 Lom 任务
  const personal = ckey.startsWith('personal:');
  const desk = personal || s.mode === 'desktop' && (!agentId || agentId === 'pc' || !agentId.startsWith('p'));
  const ag = agentId ? agent(agentId) : desk ? agent('pc') : phone();
  const isPhone = ag?.kind === 'phone';
  const running = !!s.running[runKeyOf(ckey)];
  const atts = s.attachments[ckey] || [];
  const nAtt = attached(ckey).length;
  const max = compact ? 120 : 240;
  /* 外部 Agent（Codex CLI 等）的任务：模型由它自己决定，手机工具由会话独立授权 */
  const ext = !personal && desk && !isPhone ? externalAgentName(ckey) : '';
  const extModel = ext ? externalModel(ckey) : null;
  const ph = placeholder || (isPhone ? `给${ag?.name}安排一个任务…` : ext ? `描述你的想法，交给 ${ext} 完成…` : nAtt ? `已添加 ${nAtt} 台手机，可以说「看看它们的任务做得怎么样、有没有问题」` : '描述你的想法，或交给 Lom 一个任务…  输入 @ 提及手机或成员');
  /* 推理强度按钮（模型按钮左边）：每个 Agent 用它自己的档位。
   *  Lom 任务是低/中/高；外部 Agent 是它 CLI 报给核心的选项；手机没有这项。
   *  三态：ready 可用 · unloaded 还没读到（不能说不支持）· unsupported 确实没有。 */
  const effortConv = convOfKey(ckey);
  // 新任务页同样要显示所选外部 Agent 的档位；Lom 任务则看当前模型是否支持。
  const extEff = !isPhone && (effortConv?.agentId || ckey === 'home') ? externalEffort(ckey) : null;
  const lomEffState = isPhone ? 'unsupported'
    : effortConv ? (lomSupportsEffort(effortConv.providerId) ? 'ready' : 'unsupported')
    : desk && !S.agentPick ? (lomSupportsEffort(currentPcModel()?.providerId) ? 'ready' : 'unsupported')
    : 'unsupported';
  const effState = extEff ? extEff.state : lomEffState;
  const effLabel = isPhone ? ''
    : extEff ? (extEff.state === 'ready' ? (extEff.label || '默认') : (extEff.state === 'unloaded' ? '读取中' : '不支持'))
    : effState === 'ready' ? effortName(effortConv ? effortConv.effort : s.effortPick)
    : '';
  const keyConv = effortConv ?? convOfKey(ckey);
  const modelLabel = isPhone ? phoneModelName(ag?.model || s.phoneModel) : `${(keyConv?.remote && keyConv.modelId ? model(keyConv.modelId) : currentPcModel() ?? (keyConv?.lomTier ? model(`lom-${keyConv.lomTier}`) : s.model ? model(s.model) : undefined) ?? pcModels()[0])?.name ?? '添加模型'}`;

  // Focus starts a bounded, prompt-free Codex warmup. Scope changes retire the unused session.
  useEffect(() => {
    const a = ckey === 'home' && desk && !isPhone && focused ? agentRow(s.agentPick) : undefined;
    if (a?.backend !== 'codex') return;
    let dispose: (() => void) | undefined;
    const timer = setTimeout(() => { dispose = prepareAgentTask(a, s.folder || getEndpoint()?.defaultFolder || ''); }, 350);
    return () => { clearTimeout(timer); dispose?.(); };
  }, [ckey, desk, isPhone, focused, s.agentPick, s.folder, s.permission, s.agentModelPick[s.agentPick], s.agentEffortPick[s.agentPick], s.account?.id]);

  /* 高度随内容增长 */
  useLayoutEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, max)}px`;
  });
  /* 导航后把焦点交给对应的输入框 */
  useEffect(() => {
    if (s.focusNext === `composer:${ckey}` && ref.current) {
      const t = ref.current;
      S.focusNext = null;
      t.focus();
      t.setSelectionRange(t.value.length, t.value.length);
    }
  });

  return (
    <div className="composer-wrap">
      {!isPhone && <TurtleCard key={ckey} ckey={ckey} />}
      {/* 工作文件夹、发送文件到手机、添加手机都收在左下角「+」里 */}
      {toolbar && !isPhone && <GoalStrip ckey={ckey} />}
      <div
        className={cx('composer', compact && 'composer--compact', dragOver && 'is-dragover')}
        onDragOver={e => { if (isFileDrop(e.dataTransfer) || isHistoryDrop(e.dataTransfer)) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false); }}
        onDrop={e => {
          setDragOver(false);
          if (isHistoryDrop(e.dataTransfer)) {
            e.preventDefault(); e.stopPropagation();
            void dropHistory(e.dataTransfer, ckey).catch(error => toastError('添加历史上下文失败', error));
            return;
          }
          if (!isFileDrop(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          const files = filesFrom(e.dataTransfer);
          if (!files.length) return;
          void attachFiles(ckey, files);
        }}
      >
        {atts.length > 0 && (
          <div className="composer__attachments">
            {atts.map((a, i) => (
              <span key={`${a.name}${i}`} data-history-reference={a.historyId ? true : undefined} className={cx('attach', a.uploading && 'is-uploading')} title={a.uploading ? '正在上传…' : a.name}>
                {a.uploading ? <Spinner size={14} /> : a.preview ? <img className="attach__thumb" src={a.preview} alt="" /> : <Icon name={a.ic || 'file'} />}
                {a.name}{a.uploading && a.progress != null ? ` · ${a.progress}%` : ''}
                <IconBtn ic="close" label={a.historyId ? "移除会话引用" : "移除附件"} disabled={a.uploading} onClick={() => removeAttach(ckey, i)} size="sm" />
              </span>
            ))}
          </div>
        )}
        <div className="composer__field">
          {!s.drafts[ckey] && <ComposerPlaceholder
            key={`${ckey}:${ph}`} focused={inputFocused}
            phrases={placeholder || isPhone || ext || nAtt
              ? [t(ph)]
              : composerHints(t(ph))}
          />}
          <textarea
            onFocus={() => { setFocused(true); setInputFocused(true); }}
            onBlur={() => setInputFocused(false)}
            onPaste={e => {
              /* 粘贴截图或文件：作为附件上传；剪贴板里同时有文字时，文字照常粘贴 */
              const files = filesFrom(e.clipboardData);
              if (!files.length) return;
              if (!e.clipboardData.getData('text/plain')) e.preventDefault();
              void attachFiles(ckey, files);
            }}
            ref={ref} className="composer__input composer__input--animated" rows={1} data-composer={ckey} placeholder={t(ph)} aria-label="输入任务"
            value={s.drafts[ckey] || ''}
            onChange={e => { const v = e.target.value, el = e.target; update(st => { st.drafts[ckey] = v; }); afterComposerInput(ckey, el); }}
            onKeyDown={e => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              if (S.menu?.id === 'mention' && S.menu.ctx.kind === 'slash') {
                if (slashHasChoice(ckey, S.menu.ctx.query || '')) return;
                closeMenu();
              }
              if (S.menu?.id === 'mention') { (document.querySelector('.menu .menu__item') as HTMLElement | null)?.click(); return; }
              if (!running) void send(ckey);
            }}
          />
        </div>
        <div className="composer__bar">
          <div className="composer__group">
            <IconBtn ic="plus" label="添加" variant="soft" className="ibtn--round" size={compact ? 'sm' : undefined} onClick={e => openMenu('attach', e.currentTarget.closest<HTMLElement>('.composer') || e.currentTarget, { key: `att${ckey}`, ckey, matchWidth: 'true' })} />
            {personal ? <span className="pa-muted" title={`个人助理当前权限：${personalPermissionLabel(convOfKey(ckey))}`}>{personalPermissionLabel(convOfKey(ckey))}</span> : <Dropdown label={perm(s.permission).name} ic={perm(s.permission).ic} menu="permission" ctx={{ ckey }} size={compact ? 'sm' : undefined} />}
          </div>
          <div className="composer__group">
            {/* 推理强度：每个 Agent 用它自己的档位（Lom 低/中/高，外部 Agent 是它 CLI 报的选项） */}
            {!isPhone && <Dropdown
              label={effLabel || '推理'} ic="brain" menu="effort" size={compact ? 'sm' : undefined}
              dim={effState !== 'ready'}
              title={extEff ? `${extEff.agentId === 'pc' ? 'Lom' : agentRow(extEff.agentId)?.name || 'Agent'} 的推理强度` : '推理强度'}
              ctx={{ ckey, key: `eff${ckey}` }} />}
            {ext
              ? <Dropdown label={extModel?.label || (extModel && isProbing(extModel.agentId) ? '正在读取模型…' : `${ext} · 默认模型`)} ic="cube" menu="agentModel" ctx={{ ckey, key: `am${ckey}` }} size={compact ? 'sm' : undefined} />
              : <Dropdown label={modelLabel} menu="model" ctx={{ agent: ag?.id ?? 'pc', ckey }} size={compact ? 'sm' : undefined} />}
            {running
              ? <button type="button" className="composer__send is-stop" onClick={() => stopRun(runKeyOf(ckey))} aria-label="停止" title="停止（Esc）"><Icon name="stop" /></button>
              : <button type="button" className="composer__send" onClick={() => void send(ckey)} aria-label="发送" title="发送（Enter）"><Icon name="up" /></button>}
          </div>
        </div>
      </div>
      {note && !compact && <div className="composer__note">{t('Enter 发送 · Shift+Enter 换行 · @ 提及手机 · / 快捷命令')}</div>}
    </div>
  );
}
