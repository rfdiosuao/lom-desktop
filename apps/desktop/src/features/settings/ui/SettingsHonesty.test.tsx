import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { S } from '@/state/store';
import { initialState } from '@/state/state';
import { AgentsPage } from './SettingsAgents';
import { Settings } from './Settings';
import { agentHint, agentState, canPin } from '../runtime/agentState';
import type { AgentRow } from '../runtime/agents';

vi.mock('../runtime/agents', async original => ({ ...await original<object>(), loadAgents: vi.fn(async () => undefined) }));

let host: HTMLDivElement, root: Root;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const row = (id: string, o: Partial<AgentRow> = {}): AgentRow => ({ id, name: id, agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online', backend: id.toLowerCase(), ...o });
const catalog = [
  row('Codex'),
  row('Gemini CLI', { status: 'offline', last_check_error_message: 'ACP initialize failed: invalid JSON at line 1' }),
  row('Grok Build', { status: 'offline', last_check_error_message: 'requires login / authorization' }),
  row('Cursor', { status: 'unchecked' }),
  row('Junie', { installed: false, status: 'missing', last_check_error_message: 'spawn junie ENOENT' }),
];
const seg = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith(label))!;
const titles = () => [...host.querySelectorAll('.list-row__title')].map(x => x.firstChild?.textContent);
const type = (value: string) => {
  const input = host.querySelector<HTMLInputElement>('input[aria-label="搜索 Agent"]')!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};

it('UI-AUDIT-02 UI-02 分类、计数和加入切换器共用同一状态规则', () => {
  expect(catalog.map(agentState)).toEqual(['ok', 'error', 'login', 'unchecked', 'missing']);
  expect(catalog.map(canPin)).toEqual([true, false, false, true, false]);
  S.conn = 'ready'; S.agentCatalog = catalog; S.agentPins = [];
  act(() => root.render(<AgentsPage />));
  expect(seg('可用').textContent).toBe('可用 2');
  expect(seg('待处理').textContent).toBe('待处理 3');
  expect(seg('未安装').textContent).toBe('未安装 1');
  act(() => seg('可用').click());
  expect(titles()).toEqual(['Lom', 'Codex']);
  act(() => seg('待处理').click());
  expect(titles()).toEqual(['Cursor', 'Grok Build', 'Gemini CLI']);
  expect(host.textContent).toContain('待检测');
  expect(host.textContent).toContain('需登录');
  expect(host.textContent).toContain('异常');
});

it('UI-AUDIT-02 UI-04 失败条目给出中文原因和下一步，完整错误可展开复制', () => {
  expect(agentHint(catalog[1])).toContain('更新到最新版');
  expect(agentHint(catalog[2])).toContain('登录');
  expect(agentHint(catalog[4])).toContain('重新检测');
  S.conn = 'ready'; S.agentCatalog = catalog;
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  act(() => root.render(<AgentsPage />));
  const details = [...host.querySelectorAll('details')];
  expect(details).toHaveLength(3);
  const acp = details.find(d => d.querySelector('pre')?.textContent === 'ACP initialize failed: invalid JSON at line 1')!;
  expect(acp.closest('.list-row')?.textContent).toContain('启动握手失败');
  const copy = [...acp.querySelectorAll('button')].find(b => b.textContent === '复制诊断')!;
  act(() => copy.click());
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('ACP initialize failed'));
});

it('UI-AUDIT-02 UI-09 搜索 Lom 能找到内置 Lom，无结果时说明并可清空', () => {
  S.conn = 'ready'; S.agentCatalog = catalog;
  act(() => root.render(<AgentsPage />));
  type('Lom');
  expect(titles()).toEqual(['Lom']);
  type('不存在的 Agent');
  expect(titles()).toEqual([]);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('没有找到与「不存在的 Agent」匹配的 Agent');
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === '清空搜索')!.click());
  expect(titles()).toHaveLength(catalog.length + 1);
});

it('UI-AUDIT-02 UI-01 示例手机不计入已配对数，不显示在线状态', () => {
  Object.assign(S, initialState(true));
  S.settingsPage = 'connections';
  S.agents.dev_real = { id: 'dev_real', kind: 'phone', name: 'REDMI K80 Ultra', persona: '', status: 'online', real: true, device: 'Xiaomi', lastSeen: Date.now() };
  S.phoneOrder = ['p1', 'p2', 'p3', 'dev_real'];
  act(() => root.render(<Settings />));
  const sections = [...host.querySelectorAll('section.section')];
  const paired = sections.find(x => x.querySelector('.section__title')?.textContent?.startsWith('已配对手机'))!;
  const demo = sections.find(x => x.querySelector('.section__title')?.textContent?.startsWith('示例手机'))!;
  expect(paired.querySelector('.section__title .badge')?.textContent).toBe('1');
  expect(paired.textContent).toContain('REDMI K80 Ultra');
  expect(paired.textContent).not.toContain('手机一号');
  expect(demo.textContent).toContain('手机一号');
  expect(demo.textContent).not.toContain('在线');
  expect(demo.querySelector('.avatar__status')).toBeNull();
});

it('UI-AUDIT-02 UI-08 未支持的导出不提供可点击入口', () => {
  S.settingsPage = 'data';
  act(() => root.render(<Settings />));
  const btn = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('暂不支持'));
  expect(btn?.disabled).toBe(true);
  expect(host.textContent).not.toContain('加密压缩包');
});
