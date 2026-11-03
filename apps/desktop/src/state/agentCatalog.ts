import { getEndpoint } from '@/core/client';
import { S } from './store';
export const agentRow = (id?: string) => id ? S.agentCatalog?.find(a => a.id === id) : undefined;
export const logoUrl = (icon?: string) => (icon && icon.startsWith('/') && getEndpoint() ? getEndpoint()!.url + icon : icon || '');
