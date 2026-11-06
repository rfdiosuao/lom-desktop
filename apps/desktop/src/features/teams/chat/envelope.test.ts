import { expect, it, vi } from 'vitest';
import { channelOf, messageEnvelope } from '@/features/chat/runtime/channelSource';
import { stripSettingsContext } from '@/features/settings/runtime/preferences';
import type { TeamChatMeta } from '@/state/types';
import { teamChatOf } from './envelope';

const meta: TeamChatMeta = { post: 'p1', chain: 'c1', hop: 0, team: 't1', from: { kind: 'user' }, to: [{ key: 'm:b', name: '研究员', role: '检索' }] };

it('TEAM-CHAT-01A envelope round-trips through stored core text and is hidden from the visible body', () => {
  const raw = `[LOM_SETTINGS_V1]\n【Lom 用户设置】x\n[/LOM_SETTINGS_V1]\n\n${messageEnvelope({ id: 'u', type: 'user', at: 1, teamChat: meta })}帮我查一下`;
  expect(channelOf(raw)).toEqual({ source: 'team_chat', teamChat: meta });
  expect(stripSettingsContext(raw)).toBe('帮我查一下');
  expect(raw).toContain('正文里写 @ 不会送达任何人');
});

it('TEAM-CHAT-01A envelope with path, permission or model fields is treated as corrupt and logged', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const bad = (v: unknown) => `[LOM_TEAM_CHAT_V1]\n${JSON.stringify(v)}\n说明\n[/LOM_TEAM_CHAT_V1]\n\n正文`;
  expect(teamChatOf(bad({ ...meta, cwd: '/etc' }))).toBeUndefined();
  expect(teamChatOf(bad({ ...meta, to: [{ key: 'm:b', name: 'x', access: 'full' }] }))).toBeUndefined();
  expect(teamChatOf(bad({ ...meta, hop: 9 }))).toBeUndefined();
  expect(teamChatOf(bad({ ...meta, from: { kind: 'user', id: 'spoof' } }))).toBeUndefined();
  expect(warn).toHaveBeenCalledWith('team.chat_envelope_invalid');
  expect(channelOf(bad({ ...meta, model: 'x' }))).toEqual({});
  warn.mockRestore();
});

it('TEAM-CHAT-01E envelope keeps the sender name recorded at send time and rejects an oversized one', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const wrap = (v: unknown) => `[LOM_TEAM_CHAT_V1]\n${JSON.stringify(v)}\n说明\n[/LOM_TEAM_CHAT_V1]\n\n正文`;
  const named = { ...meta, from: { kind: 'personal' as const, id: 'pa_1', name: '小鹿' } };
  expect(teamChatOf(wrap(named))).toEqual(named);
  expect(teamChatOf(wrap({ ...named, from: { kind: 'personal', id: 'pa_1' } }))?.from).toEqual({ kind: 'personal', id: 'pa_1' });
  expect(teamChatOf(wrap({ ...named, from: { kind: 'personal', id: 'pa_1', name: 'x'.repeat(81) } }))).toBeUndefined();
  warn.mockRestore();
});
