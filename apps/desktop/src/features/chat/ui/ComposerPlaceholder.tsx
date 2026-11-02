import { useEffect, useState } from 'react';

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const changed = () => setReduced(query.matches);
    changed(); query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return reduced;
}

// Only the decorative overlay updates; the textarea value and accessible label stay intact.
export function ComposerPlaceholder({ phrases, focused }: { phrases: string[]; focused: boolean }) {
  const reduced = useReducedMotion();
  const [text, setText] = useState('');
  const signature = JSON.stringify(phrases);
  useEffect(() => {
    if (reduced) return;
    const lines: string[] = JSON.parse(signature);
    if (!lines.length) return;
    let index = 0, count = 0, deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    setText('');
    const step = () => {
      const chars = Array.from(lines[index]);
      count += deleting ? -1 : 1;
      setText(chars.slice(0, count).join(''));
      let delay = deleting ? 16 : 30 + 18 * Math.random();
      if (!deleting && count === chars.length) { deleting = true; delay = 2000; }
      else if (deleting && count === 0) { deleting = false; index = (index + 1) % lines.length; delay = 400; }
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, 300);
    return () => clearTimeout(timer);
  }, [signature, reduced]);
  return <div className="composer__placeholder" aria-hidden="true">
    <span className="composer__placeholder-text">{reduced ? phrases[0] : text}</span>
    {!focused && !reduced && <span className="composer__placeholder-caret">|</span>}
  </div>;
}
