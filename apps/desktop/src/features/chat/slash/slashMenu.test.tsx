import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { loadCommandSkills } from '../runtime/commandSkills';
import { afterComposerInput } from '../actions/composer';
import { MenuHost } from '@/app/overlays/MenuHost';
import { MENUS } from '@/app/overlays/menu-registry';
import { slashMenu } from './slashMenu';
const api = vi.fn();
vi.mock('@/core/client', () => ({ api: (...args: unknown[]) => api(...args), getEndpoint: () => null }));
it('D04 添加菜单删除截图和网页链接两个按钮', () => {
  const names = MENUS.attach({ckey:'home'}).filter(x=>x !== '-').map(x=>typeof x === 'object' ? x.label : '');
  expect(names).not.toContain('截取手机一号画面'); expect(names).not.toContain('粘贴网页链接'); expect(names).toContain('海龟汤提问卡');
});
it('D04 真正加载技能、来源并填入选择，不立即发送', async () => {
  api.mockResolvedValue([{name:'sample-skill',description:'整理材料',source:'custom'}]); await loadCommandSkills();
  expect(api).toHaveBeenCalledWith('GET','/api/skills');
  const row = slashMenu('home','sample').find(x=>x !== '-' && x.label === 'sample-skill');
  if (!row || row === '-' || row.header) throw new Error('missing skill');
  expect(row.hint).toBe('个人'); row.onSelect(); expect(S.drafts.home).toBe('使用技能「sample-skill」：');
});
it('D04 加载失败清除旧列表并可重试', async () => {
  api.mockRejectedValueOnce(new Error('连接断开')); await loadCommandSkills();
  expect(S.commandSkills.error).toBe('连接断开'); expect(S.commandSkills.items).toEqual([]);
  api.mockResolvedValueOnce([]); await loadCommandSkills(); expect(S.commandSkills.error).toBe('');
});
it('D04 没有打开任务时，压缩不可用并说明原因，也不编造上下文百分比', () => {
  const row = slashMenu('home','压缩').find(x=>x !== '-' && x.label === '压缩');
  if (!row || row === '-' || row.header) throw new Error('missing command');
  expect(row.disabled).toBe(true); expect(row.desc).toContain('先打开一个任务'); expect(row.desc).not.toContain('%');
});
it('D04 输入过滤、键盘选择技能并关闭菜单', async () => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
  const area=document.createElement('textarea');document.body.appendChild(area);area.value='/';
  api.mockResolvedValue([{name:'test-skill',description:'测试技能',source:'builtin'}]);
  try {
    await act(async()=>{root.render(<MenuHost/>); afterComposerInput('home',area); await loadCommandSkills();});
    expect(host.querySelector('.menu--commands')).not.toBeNull();
    area.value='/test'; area.setSelectionRange(5,5);
    await act(async()=>{update(s=>{s.drafts.home='/test';});afterComposerInput('home',area);});
    expect(host.textContent).toContain('test-skill');expect(host.textContent).not.toContain('重命名');
    await act(async()=>{area.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
    expect(S.drafts.home).toBe('使用技能「test-skill」：');expect(host.querySelector('.menu')).toBeNull();
  } finally {await act(async()=>root.unmount());host.remove();area.remove();}
});

it('D04 没有可选命令或技能时，Enter 按普通消息发送（例如以 /Users/... 开头的路径）', async () => {
  const { slashHasChoice } = await import('./slashMenu');
  expect(slashHasChoice('home', '')).toBe(true);
  expect(slashHasChoice('home', 'Users/me/notes.txt')).toBe(false);
});

it('D04 上游内部技能不出现在菜单里，场景技能和用户自建技能照常展示', async () => {
  const { slashMenu } = await import('./slashMenu');
  const { update } = await import('@/state/store');
  update(s => { s.mode = 'desktop'; s.commandSkills = { items: [
    { name: 'aionui-webui-setup', description: 'WebUI', source: 'builtin' },
    { name: 'session-message', description: '跨会话消息', source: 'builtin' },
    { name: 'conversation-create', description: '新建会话', source: 'builtin' },
    { name: 'cron', description: '定时任务', source: 'builtin' },
    { name: 'cron', description: '我自己写的', source: 'custom' },
    { name: 'xiaohongshu-recruiter', description: '招聘', source: 'builtin' },
  ], loading: false, error: '' }; });
  const items = slashMenu('home', '').filter(it => it !== '-' && !it.header) as { label: string; hint?: string }[];
  const labels = items.map(it => it.label);
  for (const hidden of ['aionui-webui-setup', 'session-message', 'conversation-create']) expect(labels).not.toContain(hidden);
  expect(items.filter(it => it.label === 'cron').map(it => it.hint)).toEqual(['个人']);
  expect(labels).toContain('xiaohongshu-recruiter');
});
