import { searchSourcesOf, type SearchSource } from '@/features/chat/runtime/searchSources';
import { S } from '@/state/store';
import type { Team } from '@/state/types';
import { conversationOf, memberInfo } from './team';

/* ===== 团队本轮来源：把 Leader 和各成员会话里的搜索来源按 URL 汇总 =====
 * 「本轮」= Leader 会话里最后一条用户消息之后的消息；没有这轮请求时不显示，
 * 避免把历史来源当成当前结论的证据。 */

export interface TeamSourceEntry extends SearchSource {
  /** 提供过这个来源的成员显示名，按团队名单顺序 */
  members: string[];
}

export interface TeamSourceSummary {
  sources: TeamSourceEntry[];
  siteCount: number;
}

const EMPTY: TeamSourceSummary = { sources: [], siteCount: 0 };

const siteOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return url; }
};

export function teamSourcesOf(t: Team): TeamSourceSummary {
  if (!t.leaderConv) return EMPTY;
  const leaderConv = S.convs.find(c => c.id === t.leaderConv);
  const roundStart = [...(leaderConv?.messages ?? [])].reverse().find(m => m.type === 'user')?.at;
  if (roundStart === undefined) return EMPTY;

  const byUrl = new Map<string, TeamSourceEntry>();
  const order: string[] = [];
  const seenConvs = new Set<string>();
  for (const m of t.members) {
    const conv = conversationOf(t, m);
    if (!conv || seenConvs.has(conv.id)) continue;
    seenConvs.add(conv.id);
    const name = memberInfo(m.agent).name;
    for (const source of searchSourcesOf(conv.messages.filter(x => x.at >= roundStart))) {
      const known = byUrl.get(source.url);
      if (known) {
        if (!known.members.includes(name)) known.members.push(name);
        continue;
      }
      byUrl.set(source.url, { ...source, members: [name] });
      order.push(source.url);
    }
  }
  const sources = order.map(url => byUrl.get(url)!);
  return { sources, siteCount: new Set(sources.map(s => siteOf(s.url))).size };
}
