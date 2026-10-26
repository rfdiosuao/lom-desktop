import { beforeEach, expect, it } from 'vitest';
import { S } from '@/state/store';
import { EN } from '@/shared/i18n/locales/en';
import { composerHints, HINT_GROUPS } from './composerHints';

const cjk = /[㐀-鿿]/;
const all = Object.values(HINT_GROUPS).flat();
const groupOf = (text: string) => Object.entries(HINT_GROUPS).find(([, rows]) => rows.includes(text))?.[0];

beforeEach(() => { S.prefs.lang = '简体中文'; });

it('CW04 the first hint is always the real input hint of that composer', () => {
  expect(composerHints('描述你的想法…')[0]).toBe('描述你的想法…');
  expect(composerHints('Describe your idea…')[0]).toBe('Describe your idea…');
});

/** 显示宽度：全角字符算 2，其余算 1（省略号按 1） */
const width = (text: string) => [...text].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x7f && ch !== '…' ? 2 : 1), 0);

it('CW04 there are plenty of hints, none empty, none repeated, all short enough to read in a glance', () => {
  const hints = composerHints('描述你的想法…');
  expect(hints.length).toBeGreaterThanOrEqual(35);
  expect(new Set(hints).size).toBe(hints.length);
  // 中文界面：一行大约 26 个汉字以内；英文界面：一行大约 72 个字符以内（输入框最多放两行）
  for (const h of hints.slice(1)) { expect(h.trim()).not.toBe(''); expect(width(h), h).toBeLessThanOrEqual(52); }
  S.prefs.lang = 'English';
  for (const h of composerHints('Describe your idea…').slice(1)) expect(h.length, h).toBeLessThanOrEqual(72);
  S.prefs.lang = '简体中文';
  // 真实提示和库里的某一句相同时只保留一句
  expect(composerHints(HINT_GROUPS.ENGLISH[0]).filter(h => h === HINT_GROUPS.ENGLISH[0])).toHaveLength(1);
});

it('CW04 covers every kind: things to say, tips, OPC lines, encouragement and English lines', () => {
  const hints = composerHints('描述你的想法…');
  for (const [name, rows] of Object.entries(HINT_GROUPS)) {
    expect(rows.length, name).toBe(8);
    expect(rows.every(r => hints.includes(r)), name).toBe(true);
  }
  expect(HINT_GROUPS.ENGLISH.every(r => !cjk.test(r))).toBe(true);
  expect(HINT_GROUPS.OPC.some(r => r.includes('OPC')) && HINT_GROUPS.OPC.some(r => r.includes('一人公司'))).toBe(true);
});

it('CW04 neighbouring hints never come from the same kind, so the rotation stays lively', () => {
  const kinds = composerHints('描述你的想法…').slice(1).map(groupOf);
  expect(kinds.every(Boolean)).toBe(true);
  for (let i = 1; i < kinds.length; i++) expect(kinds[i], `#${i} ${kinds[i]}`).not.toBe(kinds[i - 1]);
});

it('CW04 every Chinese hint has an English translation, so the English UI never shows Chinese', () => {
  for (const h of all.filter(x => cjk.test(x))) {
    expect(EN[h], h).toBeDefined();
    expect(cjk.test(EN[h]), `${h} → ${EN[h]}`).toBe(false);
  }
  S.prefs.lang = 'English';
  const hints = composerHints('Describe your idea…');
  expect(hints.some(h => cjk.test(h))).toBe(false);
  // 英文原句原样保留，中文句子换成译文
  expect(hints).toContain('Start small. Ship today.');
  expect(hints).toContain('One person can be a whole company.');
  expect(hints).toContain(EN['输入 @ 提及手机，让它去干活…']);
});

it('CW04 the tip that names slash commands only names commands that really exist in the menu', () => {
  const tip = HINT_GROUPS.TIPS.find(x => x.startsWith('输入 /'))!;
  const named = tip.replace(/^[^：]*：/, '').replace(/…$/, '').split('、');
  expect(named).toEqual(['目标', '记忆', '定时任务']);
  // 这三个都是斜杠菜单里真实的命令名（英文界面里也有对应译文）
  for (const name of named) expect(EN[name], name).toBeDefined();
});
