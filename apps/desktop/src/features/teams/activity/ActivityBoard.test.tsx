import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ActivityBoard } from './ActivityBoard';
import type { BoardLane } from './ActivityBoard';
import { buildActivityItems } from './activityTypes';
import type { TeamMailboxMessage, TeamTask } from './activityTypes';
import type { IdentityResolver } from './MessageCard';

/* D33-AC-5 展开、D33-AC-6 未读徽章、D33-AC-7 空列、任务卡内容。 */

const identity: IdentityResolver = { nameOf: (slot) => ({ lead: 'Lom', w1: 'CodeBuddy' } as Record<string, string>)[slot] ?? slot, colorOf: () => 'var(--brand)' };
const lanes: BoardLane[] = [{ slotId: 'lead', name: 'Lom' }, { slotId: 'w1', name: 'CodeBuddy' }, { slotId: 'w2', name: 'Kimi' }];
const slots = new Set(['lead', 'w1', 'w2']);

const msg = (id: string, from: string, to: string, extra: Partial<TeamMailboxMessage> = {}): TeamMailboxMessage => ({
  id, team_id: 't1', from_agent_id: from, to_agent_id: to, msg_type: 'message', content: '收到，开始处理。',
  summary: null, files: [], read: false, created_at: 1, ...extra,
});

const task = (id: string, owner: string, extra: Partial<TeamTask> = {}): TeamTask => ({
  id, team_id: 't1', subject: '整理本周选题', description: null, status: 'in_progress', owner,
  blocked_by: [], blocks: [], created_at: 2, updated_at: 2, ...extra,
});

let host: HTMLDivElement, root: Root;
const render = async (messages: TeamMailboxMessage[], tasks: TeamTask[] = [], hasMore = false) => {
  const items = buildActivityItems(messages, tasks, slots, 'desc');
  await act(async () => {
    root.render(<ActivityBoard lanes={lanes} items={items} identity={identity} hasMore={hasMore} isLoadingMore={false} onLoadMore={() => undefined} emptyHint={{ title: '团队还没有开工' }} />);
  });
  return items;
};

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

it('D33-AC-7: 空列显示提示，列头显示条目数', async () => {
  await render([msg('m1', 'lead', 'w1')], [task('t1', 'w1')]);
  const columns = [...host.querySelectorAll('[data-testid="activity-board-column"]')];
  expect(columns.map((c) => c.getAttribute('data-lane-id'))).toEqual(['lead', 'w1', 'w2']);
  expect(columns[0].textContent).toContain('还没有活动');
  expect(columns[0].querySelector('.team-board__count')?.textContent).toBe('0');
  expect(columns[1].querySelector('.team-board__count')?.textContent).toBe('2');
});

it('D33-AC-6: 未读/已读徽章跟随消息状态', async () => {
  await render([msg('m1', 'lead', 'w1', { read: false }), msg('m2', 'w1', 'lead', { read: true })]);
  expect(host.textContent).toContain('未读');
  expect(host.textContent).toContain('已读');
});

it('D33-AC-5: 长正文出现展开按钮，展开后完整显示并可收起', async () => {
  const long = '这是一段很长的汇报。'.repeat(30);
  await render([msg('m1', 'w1', 'lead', { content: long })]);
  const button = host.querySelector<HTMLButtonElement>('[data-testid="activity-message-expand"]')!;
  expect(button).not.toBeNull();
  expect(button.getAttribute('aria-expanded')).toBe('false');

  await act(async () => { button.click(); });
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(button.textContent).toBe('收起');

  await act(async () => { button.click(); });
  expect(button.getAttribute('aria-expanded')).toBe('false');
  expect(button.textContent).toBe('展开');
});

it('短正文不显示展开按钮', async () => {
  await render([msg('m1', 'w1', 'lead')]);
  expect(host.querySelector('[data-testid="activity-message-expand"]')).toBeNull();
});

it('消息卡显示发件人、收件人、附件数和广播目标', async () => {
  await render([msg('m1', 'lead', '*', { files: ['a.png', 'b.png'] })]);
  const card = host.querySelector('[data-testid="activity-message-card"]')!;
  expect(card.textContent).toContain('Lom');
  expect(card.textContent).toContain('广播给全员');
  expect(card.textContent).toContain('2 个附件');
});

it('任务卡显示状态、负责人、依赖和描述', async () => {
  await render([], [task('t1', 'w1', { description: '把 5 个选题按美妆和数码分组', blocked_by: ['abcdef123456'] })]);
  const card = host.querySelector('[data-testid="activity-task-card"]')!;
  expect(card.textContent).toContain('整理本周选题');
  expect(card.textContent).toContain('进行中');
  expect(card.textContent).toContain('CodeBuddy');
  expect(card.textContent).toContain('被 #abcdef12 阻塞');
  expect(card.textContent).toContain('把 5 个选题按美妆和数码分组');
});

it('还有下一页时列底出现加载更多', async () => {
  await render([msg('m1', 'lead', 'w1')], [], true);
  expect(host.querySelector('[data-testid="activity-load-sentinel"]')).not.toBeNull();
});
