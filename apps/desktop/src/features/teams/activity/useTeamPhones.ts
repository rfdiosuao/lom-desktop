import { useEffect } from 'react';
import { authAccount } from '@/features/account/runtime/authScope';
import { watchPhone } from '@/features/phones/runtime/phoneChat';
import { S } from '@/state/store';
import type { Team } from '@/state/types';
import { teamPhoneConversations } from './phoneActivity';

/** Reuses the phone watcher (including its per-conversation deduplication), never sends tasks. */
export function useTeamPhones(team: Team) {
  useEffect(() => {
    const current = authAccount();
    const sync = () => {
      if (!current() || document.hidden) return;
      const latest = S.teams.find(t => t.id === team.id);
      if (!latest) return;
      const mapped = new Set(Object.values(latest.memberConvs || {}));
      for (const conv of teamPhoneConversations(latest, S)) {
        if (!conv.phoneSession || S.agents[conv.owner]?.status !== 'online') continue;
        if (mapped.has(conv.id) || S.running[conv.id]) void watchPhone(conv);
      }
    };
    sync();
    const timer = setInterval(sync, 15000);
    return () => clearInterval(timer);
  }, [team.id, S.cloud, S.account?.id]);
}
