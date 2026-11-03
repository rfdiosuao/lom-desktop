import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { MessageCard } from './MessageCard';
import { TaskCard } from './TaskCard';
import { PhoneActivityCard } from './PhoneActivityCard';
const identity = { nameOf: () => '成员', colorOf: () => 'var(--brand)' };
const markdown = '## 汇报\n\n**已完成**\n\n- 核对结果';
it.each(['message', 'task', 'phone'])('UI-CONTENT-01 AC2 %s cards render Markdown instead of raw punctuation', async kind => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  try {
    await act(async () => root.render(kind === 'message'
      ? <MessageCard identity={identity} message={{ id: 'm', team_id: 't', from_agent_id: 'a', to_agent_id: 'b', content: markdown, summary: null, msg_type: 'message', files: [], read: false, created_at: 1 }} />
      : kind === 'task' ? <TaskCard identity={identity} task={{ id: 't', team_id: 't', subject: '任务', description: markdown, status: 'in_progress', owner: 'a', blocked_by: [], blocks: [], created_at: 1, updated_at: 1 }} />
      : <PhoneActivityCard at={1} activity={{ category: 'task', title: '手机任务', label: '进行中', text: markdown, files: 0 } as any} />));
    expect(host.querySelector('h4')?.textContent).toBe('汇报');
    expect(host.querySelector('b,strong')?.textContent).toBe('已完成');
    expect(host.textContent).not.toContain('**');
    expect(host.querySelector('li')?.textContent).toBe('核对结果');
  } finally { await act(async () => root.unmount()); }
});
