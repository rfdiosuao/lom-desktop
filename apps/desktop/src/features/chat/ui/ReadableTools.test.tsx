import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { S } from '@/state/store';
import { ToolCalls } from './ToolCalls';
it.each(['Bash', 'mcp__external__internal_action'])('UI-CONTENT-01 AC3 raw arguments stay out of collapsed tool rows (%s)', async toolName => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; S.eventOpen = {};
  const host = document.createElement('div'), root = createRoot(host);
  const args = { command: 'INTERNAL_VAR=1 run_command', owner_id: 'internal_owner_id' };
  try {
    await act(async () => root.render(<ToolCalls ctxId="conv:c" items={[{ id: 'tool', type: 'tool', toolName, tool: toolName === 'Bash' ? '运行命令' : toolName, detail: JSON.stringify(args), args, status: 'done', at: 1 }]} />));
    expect(host.textContent).not.toContain('INTERNAL_VAR'); expect(host.textContent).not.toContain('internal_action');
    expect(host.querySelector('button')?.textContent).toContain(toolName === 'Bash' ? '运行命令' : '调用外部工具');
    await act(async () => host.querySelector('button')!.click());
    expect(host.textContent).toContain('internal_owner_id');
    expect(host.textContent).toContain(toolName);
  } finally { await act(async () => root.unmount()); }
});
