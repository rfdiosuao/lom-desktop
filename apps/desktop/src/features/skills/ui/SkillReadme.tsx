import { useState } from 'react';
import { Markdown } from '@/shared/ui/Markdown';
import { Btn } from '@/shared/ui/Button';

/** Presentation only: never change the SKILL.md passed to the agent or installer. */
export function SkillReadme({ text }: { text: string }) {
  const [openedFor, setOpenedFor] = useState<string>();
  const header = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  const metadata = header && /^[A-Za-z_][\w-]*[ \t]*:/m.test(header[1]) ? header : undefined;
  const body = metadata ? text.slice(metadata[0].length) : text;
  const open = openedFor === text;
  return <div className="msg__text"><Markdown text={body || '没有技能说明'} />
    {metadata && <><Btn label={open ? '收起技能配置' : '查看技能配置'} size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpenedFor(open ? undefined : text)} />
      {open && <pre className="md-code"><code>{metadata[1]}</code></pre>}</>}
  </div>;
}
