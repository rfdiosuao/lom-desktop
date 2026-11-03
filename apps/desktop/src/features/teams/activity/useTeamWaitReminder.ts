import { useEffect } from 'react';
import { S } from '@/state/store';
import { taskFinished } from '@/app/sound';
import { memberWait } from './memberWait';

/** Reuse the user's existing background sound preference; never focus a window. */
export function useTeamWaitReminder() {
  useEffect(() => {
    const reminded = new Set<string>();
    const timer = setInterval(() => {
      const active = new Set<string>();
      for (const team of S.teams.filter(t => t.real)) {
        const ids = new Set([team.leaderConv, ...Object.values(team.memberConvs || {})]);
        for (const c of S.convs.filter(c => ids.has(c.id))) {
          // Keep every unresolved action alive, including lower-priority results.
          for (const message of c.messages) {
            if ((message.type === 'approval' || message.type === 'question')
              && ['pending', 'submitting', 'unconfirmed'].includes(message.status || '')) active.add(`${c.id}:${message.id}`);
          }
          const wait = memberWait(c);
          if (!wait) continue;
          const key = `${c.id}:${wait.message.id}`;
          if (wait.seconds < 30 || reminded.has(key)) continue;
          const watchingTeam = document.hasFocus() && !document.hidden && S.route.name === 'team' && S.route.id === team.id;
          const watchingChat = document.hasFocus() && !document.hidden && S.route.name === 'chat' && S.activeConv === c.id;
          if (watchingTeam || watchingChat || !S.prefs.sound) continue;
          taskFinished(c.id);
          reminded.add(key);
        }
      }
      for (const key of reminded) if (!active.has(key)) reminded.delete(key);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
}
