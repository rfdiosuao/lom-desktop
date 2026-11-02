import { expect, it, vi } from 'vitest';
vi.mock('./phoneRpc', () => ({ phoneRpc: vi.fn() }));
import { applyAcpTool } from '@/features/chat/runtime/toolImages';
import { mapHistory } from '@/features/chat/runtime/history';
import { parseDeviceStatus } from './deviceStatus';
import { personaOf } from '@/state/selectors';
import type { Conv, Msg, Agent } from '@/state/types';
it('D11 Codex 图片完成后显示，增量不重复，历史蛇形字段也恢复', () => {
  const messages: Msg[] = [];
  applyAcpTool(messages, { update: { tool_call_id: 'ig', title: 'imageGeneration' } });
  expect(messages[0].images).toBeUndefined();
  const update = { tool_call_id: 'ig', status: 'completed', rawOutput: { image: { path: '/work/dog.png' }, saved_path: '/work/dog.png' } };
  applyAcpTool(messages, { update }); applyAcpTool(messages, { update });
  expect(messages).toHaveLength(1); expect(messages[0].images).toEqual(['/work/dog.png']);
  const history = mapHistory([{ id: 'ig', msg_id: 'ig', conversation_id: 'c', type: 'acp_tool_call', created_at: 1, content: { update: { ...update, rawOutput: undefined, raw_output: update.rawOutput } } }], { id: 'c' } as Conv);
  expect(history.messages[0].images).toEqual(['/work/dog.png']);
  applyAcpTool(messages, { update: { tool_call_id: 'ig', status: 'failed' } }); expect(messages[0].images).toBeUndefined();
});
it('D11 电量0有效，缺失和超界不冒充读数，网络中文', () => {
  expect(parseDeviceStatus({ battery: '0', network: 'cellular', sampled_at: '1' })).toEqual({ battery: 0, network: '移动网络' });
  for (const battery of ['', 'undefined', '101', '-1']) expect(parseDeviceStatus({ battery, network: 'bad', sampled_at: '1' })).toEqual({ battery: undefined, network: '网络未知' });
});
it('D11 真实手机以已同步的灵魂配置状态显示人格', () => {
  expect(personaOf({ kind: 'phone', real: true, soulConfigured: true } as Agent)).toBe('已配置人格');
  expect(personaOf({ kind: 'phone', real: true, soulConfigured: false, persona: '旧模板' } as Agent)).toBe('未配置人格');
});
it('D11 统一 Session 工具输出的图片路径从持久化历史恢复', () => {
  const history = mapHistory([{ id: 'i', msg_id: 'm', conversation_id: 'c', type: 'tool_call', created_at: 1, content: { call_id: 'ig', name: 'imageGeneration', status: 'completed', output: JSON.stringify({ kind: 'lom.tool-output.v1', text: '', images: ['/work/dog.png'] }) } }], { id: 'c' } as Conv);
  expect(history.messages[0].images).toEqual(['/work/dog.png']);
});
