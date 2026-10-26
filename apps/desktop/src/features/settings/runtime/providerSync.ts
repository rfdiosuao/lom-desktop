import { update } from '@/state/store';
import { api } from '@/core/client';
import type { CoreProvider } from '@/core/types';

export async function refreshProviders(isCurrent: () => boolean = () => true) {
  const list = await api<CoreProvider[]>('GET', '/api/providers');
  if (!isCurrent()) return;
  update(s => { s.providers = list.map(({ id, platform, name, base_url, models, enabled, created_at }) => ({ id, platform, name, base_url, models, enabled, created_at })); });
}
