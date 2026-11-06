import { expect, it } from 'vitest';
import { redactDiagnostic, redactSecrets } from './redact';

it('SET-AGENT-01 #436 secrets are hidden by the shared rules', () => {
  const text = redactSecrets('key sk-abc123_DEF Authorization: Bearer abc.def api_key=hunter2 https://x.test/cb?code=999&state=1');
  expect(text).not.toMatch(/abc123|abc\.def|hunter2|999/);
  expect(text).toContain('state=1');
});

it.each([
  ['/Users/example/.codex/auth.json', '/Users/[用户]/.codex/auth.json'],
  ['C:\\Users\\Heang Li\\AppData\\x', 'C:\\Users\\[用户]\\AppData\\x'],
  ['/home/ubuntu/.config/a', '/home/[用户]/.config/a'],
  ['ENOENT: /Users/me/bin/agent and /Users/me/x', 'ENOENT: /Users/[用户]/bin/agent and /Users/[用户]/x'],
])('SET-AGENT-01 #436 the user name in %j is hidden but the rest of the path stays readable', (input, expected) => {
  expect(redactDiagnostic(input)).toBe(expected);
});

it('SET-AGENT-01 #436 text without sensitive parts is unchanged', () => {
  expect(redactDiagnostic('ACP initialize failed: invalid JSON at line 1')).toBe('ACP initialize failed: invalid JSON at line 1');
});
