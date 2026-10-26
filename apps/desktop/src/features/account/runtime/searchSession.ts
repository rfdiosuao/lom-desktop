import { api } from '@/core/client';
import { toast } from '@/shared/overlays/controller';

/** Optional search setup must never prevent normal model provisioning. Tokens stay in memory. */
export async function syncSearchSession(session: string | null, isCurrent: () => boolean) {
  if (!isCurrent()) return;
  try {
    await api('PUT', '/api/lom/search-session', { session }, { timeoutMs: 20000 });
  } catch {
    // Older cores lack S05; cloud validation may also be unavailable. Do not log credentials or payloads.
    if (!isCurrent()) return;
    console.warn(session ? 'search.session_setup_failed' : 'search.session_clear_failed');
    if (session) toast('联网搜索暂不可用，普通对话可继续。', 'info');
  }
}
