import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TeamEmptyState } from './TeamEmptyState';
import type { EmptyStateMember } from './TeamEmptyState';

/* D33 成员空状态：48px logo/首字母、身份色、Leader 问候与三条建议。 */

let host: HTMLDivElement, root: Root;
const member: EmptyStateMember = { name: 'Lom', memberId: 'm1', agentId: 'pc', leader: true };
const teammate: EmptyStateMember = { name: 'CodeBuddy', memberId: 'm2', agentId: 'ag:codebuddy', leader: false };

const render = async (ui: ReactNode) => { await act(async () => { root.render(ui); }); };

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

it('Leader 显示身份色名字、问候和三条建议', async () => {
  await render(<TeamEmptyState member={member} />);
  const name = host.querySelector('.team-empty__name')!;
  expect(name.textContent).toBe('Lom');
  expect((name.getAttribute('style') || '')).not.toContain('color');
  expect(host.querySelector<HTMLImageElement>('.team-empty__logo')?.getAttribute('src')).toBe('/logo.png');
  // D33-UX-04：Lom 的长方形 logo 放进圆形底座，不再被方框裁掉
  expect(host.querySelector('.team-empty__logo')?.classList.contains('team-empty__logo--lom')).toBe(true);
  expect(host.textContent).toContain('我负责理解目标并协调团队');
  expect(host.querySelectorAll('[data-testid^="team-empty-suggestion-"]')).toHaveLength(3);
  // 没接输入框时只展示，不假装能点
  expect(host.querySelector<HTMLButtonElement>('[data-testid="team-empty-suggestion-debate"]')!.disabled).toBe(true);
});

it('成员只显示自己的问候，没有建议', async () => {
  await render(<TeamEmptyState member={teammate} />);
  expect(host.textContent).toContain('我听 Leader 和你的指挥');
  expect(host.querySelectorAll('[data-testid^="team-empty-suggestion-"]')).toHaveLength(0);
});

it('Lom uses the project logo, while unknown members retain their fallback', async () => {
  await render(<TeamEmptyState member={member} />);
  expect(host.querySelector('.team-empty__logo--letter')).toBeNull();
  await render(<TeamEmptyState member={{ ...teammate, agentId: 'ag:missing', name: 'Unknown' }} />);
  expect(host.querySelector('.team-empty__logo--letter')?.textContent).toBe('U');
});

it('点建议把文案交给输入框', async () => {
  const onSuggest = vi.fn();
  await render(<TeamEmptyState member={member} onSuggest={onSuggest} />);
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="team-empty-suggestion-expert_review"]')!.click(); });
  expect(onSuggest).toHaveBeenCalledWith('让多位专家会诊同一个问题');
});
