import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { initialState } from '@/state/state';
import { S, update } from '@/state/store';
import { MenuHost } from '@/app/overlays/MenuHost';
import { openMenu } from '@/shared/overlays/controller';
import { Composer } from './Composer';

let host: HTMLDivElement, root: Root;
const render = (ckey: string) => act(async () => root.render(<><Composer ckey={ckey} /><MenuHost /></>));
const options = () => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
const menu = (ckey: string) => act(async () => openMenu('effort', host, { ckey }));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); Object.assign(S, initialState());
  S.mode = 'desktop'; S.agentPick = ''; S.effortPick = '';
  S.providers = [{ id: 'own', name: 'Own', platform: 'openai', base_url: '', models: ['gpt-5.1'], enabled: true, created_at: 1 }];
  S.model = 'own::gpt-5.1';
  S.convs = [{ id: 'c', owner: 'pc', title: '任务', updated: 1, messages: [], remote: true, loaded: true, providerId: 'own', effort: 'none' }];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('EFFORT-02 AC-1 choosing no thinking at home preserves explicit none and labels the composer', async () => {
  await render('home'); await menu('home');
  const off = options().find(b => b.textContent?.includes('不思考'));
  expect(off).toBeDefined();
  expect(off?.title).toContain('需模型支持');
  await act(async () => off!.click());
  expect(S.effortPick).toBe('none');
  expect(host.querySelector('[title="推理强度"]')?.textContent).toContain('不思考');
  await menu('home');
  expect(options().find(b => b.getAttribute('aria-checked') === 'true')?.textContent).toContain('不思考');
  await act(async () => options().find(b => b.textContent?.includes('默认'))!.click());
  expect(S.effortPick).toBe('');
  expect(host.querySelector('[title="推理强度"]')?.textContent).toContain('默认');
});

it('EFFORT-02 AC-2 an existing native conversation displays and selects saved no thinking', async () => {
  await render('conv:c'); await menu('conv:c');
  expect(host.querySelector('[title="推理强度"]')?.textContent).toContain('不思考');
  expect(options().find(b => b.getAttribute('aria-checked') === 'true')?.textContent).toContain('不思考');
});

it('EFFORT-02 AC-2 Personal Agent uses its own conversation for the shared no-thinking menu', async () => {
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' };
  S.convs[0].personal = { id: 'pa_a', name: '助理', directory: '/a' };
  localStorage.setItem('lom.personal.v1:owner', JSON.stringify({ items: [{ id: 'pa_a', name: '助理', directory: '/a', workspace: '/a', conversation: 'c' }] }));
  await render('personal:pa_a'); await menu('personal:pa_a');
  expect(host.querySelector('[title="推理强度"]')?.textContent).toContain('不思考');
  expect(options().find(b => b.getAttribute('aria-checked') === 'true')?.textContent).toContain('不思考');
});

it('EFFORT-02 AC-4 external menus never invent none and retain a reported none verbatim', async () => {
  S.convs[0].agentId = 'external';
  S.agentOptions = { c: [{ id: 'thought_level', current_value: 'high', options: [{ value: 'high', name: 'High' }] }] };
  await render('conv:c'); await menu('conv:c');
  expect(options().map(b => b.textContent)).toEqual(['High']);
  await act(async () => update(s => { s.agentOptions.c[0].options.unshift({ value: 'none', name: '不思考' }); s.agentOptions.c[0].current_value = 'none'; }));
  expect(options().find(b => b.getAttribute('aria-checked') === 'true')?.textContent).toBe('不思考');
});
