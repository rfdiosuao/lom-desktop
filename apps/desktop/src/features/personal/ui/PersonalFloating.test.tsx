vi.mock('@/features/account/runtime/serviceConfig', () => ({ cloudConfigured: () => true, LOM_CLOUD_URL: 'https://service.example.invalid', requireCloudService: () => {}, CLOUD_UNAVAILABLE: '后端未包含' }));
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { S, update } from '@/state/store';
import { openPersonalPanel } from '../runtime/panel';
import { PersonalFloating } from './PersonalFloating';
vi.mock('./PersonalAgent', () => ({ PersonalAgent: ({ onClose, onMinimize }: any) => <><button onClick={onClose}>关闭</button><button onClick={onMinimize}>收起</button></> }));
it('PA02 keeps one embedded panel, restores minimized content and clears it on account mismatch', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host); document.body.append(host);
  S.cloud = 'signed-in'; S.account = { id: 'owner', name: '', email: '' }; S.personalPanel = null;
  S.drafts['personal:pa_a'] = '未发送';
  try {
    await act(async () => { root.render(<PersonalFloating />); openPersonalPanel(); openPersonalPanel(); });
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await act(async () => host.querySelectorAll('button')[1].click());
    expect(host.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('.pa-restore button')!.click());
    expect(host.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(false);
    await act(async () => host.querySelector('button')!.click()); expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(S.drafts['personal:pa_a']).toBe('未发送');
    await act(async () => { openPersonalPanel(); update(s => { s.account = { id: 'other', name: '', email: '' }; }); });
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(S.personalPanel).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});
