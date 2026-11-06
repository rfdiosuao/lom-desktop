import { expect, it } from 'vitest';
import { S } from '@/state/store';
import type { Conv } from '@/state/types';
import { executeTeamTool } from '@/features/personal/runtime/teamTools';
it('PA-TOOLS-02 F non-full desktop approval works without configuring Feishu', async () => {
  localStorage.clear(); S.cloud = 'signed-in'; S.account = { id: 'approval-owner', name: '', email: '' }; S.teams = []; S.modals = [];
  const self: Conv = { id: 'pa-approve', owner: 'pc', title: '', updated: 0, messages: [], workspace: '/work', personal: { id: 'pa_a', name: 'PA', directory: '/work' } };
  S.convs = [self]; S.running = { [self.id]: true };
  localStorage.setItem('lom.personal.v1:approval-owner', JSON.stringify({ items: [{ id: 'pa_a', name: 'PA', directory: '/work', workspace: '/work', conversation: self.id, permission: 'routine' }] }));
  const work = executeTeamTool(self, { id: 'desktop-no-feishu', scope: 'pa-tools-approve', name: 'personal_team_create', arguments: JSON.stringify({ name: 'Approved', members: [{ agent_id: 'lom', role: '主控', leader: true }] }) }, () => true);
  const modal = S.modals.at(-1); expect(modal?.id).toBe('confirm'); expect(modal?.props.title).toBe('批准助理能力操作');
  (modal!.props.onOk as () => void)();
  expect((await work).isError).not.toBe(true); expect(S.teams[0].name).toBe('Approved');
});
