import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import { Composer } from './Composer';
import { Home } from './Chat';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  S.mode = 'desktop'; localStorage.clear();
  S.route = { name: 'home' }; S.activeConv = '';
  S.agentCatalog = []; S.agentPick = ''; S.agentModelPick = {}; S.agentEffortPick = {}; S.agentOptions = {};
  S.providers = []; S.model = '';
  S.convs = [
    { id: 'codex1', owner: 'pc', title: '生成一张小狗图片', updated: 1, messages: [], remote: true, loaded: true, agentId: 'ag_codex', agentName: 'Codex CLI' },
    { id: 'lom1', owner: 'pc', title: 'Lom 任务', updated: 1, messages: [], remote: true, loaded: true },
  ];
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const placeholder = () => host.querySelector('textarea')?.getAttribute('placeholder') || '';

it('an external Agent task (owner "pc") keeps its own input: placeholder names the Agent, no phone picker', async () => {
  await act(async () => root.render(<Composer ckey="conv:codex1" agentId="pc" />));
  expect(placeholder()).toContain('交给 Codex CLI');
  expect(host.textContent).not.toContain('添加手机');
});

it('a Lom task still gets the Lom input', async () => {
  await act(async () => root.render(<Composer ckey="conv:lom1" agentId="pc" />));
  expect(placeholder()).toContain('交给 Lom');
});

it('side Lom composer shows its own model while the active parent is an external Agent', async () => {
  S.providers = [{ id: 'own', name: 'Own', platform: 'openai', base_url: '', models: ['side-model'], enabled: true, created_at: 1 }];
  S.route = { name: 'chat' }; S.activeConv = 'codex1';
  S.convs.push({ id: 'side', owner: 'pc', title: 'side', updated: 1, messages: [], remote: true, loaded: true, sideOf: 'codex1', modelId: 'own::side-model' });
  await act(async () => root.render(<Composer ckey="conv:side" compact />));
  expect(host.textContent).toContain('side-model'); expect(host.textContent).not.toContain('添加模型');
});
it('external side composer shares the parent agent model selector instead of the Lom add-model menu', async () => {
  S.route = { name: 'chat' }; S.activeConv = 'codex1'; S.providers = [];
  S.convs.push({ ...S.convs[0], id: 'side-codex', sideOf: 'codex1' });
  S.agentOptions['side-codex'] = [{ id: 'model', category: 'model', current_value: 'luna', options: [{ value: 'luna', name: 'GPT-6-Luna' }] }];
  await act(async () => root.render(<Composer ckey="conv:side-codex" compact />));
  expect(host.textContent).toContain('GPT-6-Luna'); expect(host.textContent).not.toContain('添加模型');
});

it('EFFORT-01 home composer shows the external Agent preselected tier instead of the Lom tier', async () => {
  const codex = { id: 'ag_codex', name: 'Codex CLI', backend: 'codex', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' as const };
  S.agentCatalog = [codex]; S.agentPick = 'ag_codex'; S.agentEffortPick = { ag_codex: 'deep' };
  localStorage.setItem('lom.agent-options:ag_codex', JSON.stringify([
    { id: 'thought_level', category: 'thought_level', current_value: 'balanced', options: [
      { value: 'fast', name: 'Fast' }, { value: 'balanced', name: 'Balanced' }, { value: 'deep', name: 'Deep' },
    ] },
  ]));
  await act(async () => root.render(<Composer ckey="home" />));
  expect(host.textContent).toContain('Deep');
  expect(host.textContent).not.toContain('读取中');
});

it('EFFORT-01 home marks effort unsupported when the selected Lom model cannot use it', async () => {
  S.providers = [{ id: 'ant', name: 'Anthropic', platform: 'anthropic', base_url: '', models: ['claude'], enabled: true, created_at: 1 }];
  S.model = 'ant::claude';
  await act(async () => root.render(<Composer ckey="home" />));
  const button = [...host.querySelectorAll('button')].find(b => b.title === '推理强度');
  expect(button?.className).toContain('is-dim');
});

it('EFFORT-01 home keeps effort available for an OpenAI-compatible Lom model', async () => {
  S.providers = [{ id: 'own', name: 'Own', platform: 'openai', base_url: '', models: ['m'], enabled: true, created_at: 1 }];
  S.model = 'own::m';
  await act(async () => root.render(<Composer ckey="home" />));
  const button = [...host.querySelectorAll('button')].find(b => b.title === '推理强度');
  expect(button?.className).not.toContain('is-dim');
  expect(button?.textContent).toContain('默认');
});

it('CW04 an existing draft hides the overlay and clearing it restores the hint without changing its value', async () => {
  S.drafts['conv:lom1'] = '保留我的草稿';
  await act(async () => root.render(<Composer ckey="conv:lom1" />));
  expect(host.querySelector('.composer__placeholder')).toBeNull();
  expect(host.querySelector('textarea')?.value).toBe('保留我的草稿');
  await act(async () => { S.drafts['conv:lom1'] = ''; root.render(<Composer ckey="conv:lom1" />); });
  expect(host.querySelector('.composer__placeholder')).not.toBeNull();
  expect(host.querySelector('textarea')?.value).toBe('');
  expect(host.querySelector('textarea')?.getAttribute('aria-label')).toBe('输入任务');
});
it('CW04 a custom team hint remains the only placeholder content', async () => {
  await act(async () => root.render(<Composer ckey="team:example" compact placeholder="把目标告诉 Leader…" />));
  expect(placeholder()).toBe('把目标告诉 Leader…');
  expect(host.querySelector('.composer__placeholder')?.textContent).toContain('把目标告诉 Leader');
});

it('PHONE-IMAGE-01 external Agent home keeps the real phone picker visible and selectable', async () => {
  S.agentCatalog = [{ id: 'ag_codex', name: 'Codex CLI', backend: 'codex', agent_type: 'acp', agent_source: 'builtin', enabled: true, installed: true, status: 'online' }];
  S.agentPick = 'ag_codex'; S.phoneOrder = ['dev_image'];
  S.agents.dev_image = { ...S.agents.p1, id: 'dev_image', name: '图片测试手机', real: true, status: 'online' };
  S.lit.dev_image = false;
  await act(async () => root.render(<Home />));
  const phone = host.querySelector<HTMLButtonElement>('[aria-label="图片测试手机：未加入这个任务"]');
  expect(phone).not.toBeNull();
  await act(async () => phone!.click());
  expect(S.lit.dev_image).toBe(true);
  expect(host.textContent).toContain('HTTP MCP');
  expect(host.textContent).not.toContain('请在左上角切回 Lom');
});
