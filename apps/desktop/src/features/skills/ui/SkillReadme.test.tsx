import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { SkillReadme } from './SkillReadme';
it('UI-CONTENT-01 AC1 hides skill metadata by default, renders body and preserves optional configuration', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host);
  const text = '---\nname: internal-skill\ndescription: tool_variables\n---\n# 技能说明\n\n**正常正文**\n\n- 第一步';
  try {
    await act(async () => root.render(<SkillReadme text={text} />));
    expect(host.textContent).not.toContain('tool_variables');
    expect(host.querySelector('h4')?.textContent).toBe('技能说明');
    expect(host.querySelector('b,strong')?.textContent).toBe('正常正文');
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('pre')?.textContent).toContain('description: tool_variables');
  } finally { await act(async () => root.unmount()); }
});
it.each(['---\n正文不能消失', '前言\n---\nname: keep\n---', '---\n普通正文\n---\n保留正文'])('UI-CONTENT-01 AC1 only complete YAML headers are hidden (%s)', async text => {
  const host = document.createElement('div'), root = createRoot(host);
  try { await act(async () => root.render(<SkillReadme text={text} />)); expect(host.querySelector('button')).toBeNull(); expect(host.textContent).toContain(text.includes('keep') ? 'name: keep' : '正文'); }
  finally { await act(async () => root.unmount()); }
});
