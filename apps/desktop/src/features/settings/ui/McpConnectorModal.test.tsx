import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ModalHost } from '@/app/overlays/ModalHost';
import { closeModal, openModal, topModal } from '@/shared/overlays/controller';
import { S } from '@/state/store';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/core/client', () => ({ api }));

it('HUB-UI-02 AC2 a failed save keeps the form and valid values can be retried', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'), root = createRoot(host);
  let resolveSave!: (value: { id: string }) => void;
  api.mockReset().mockRejectedValueOnce(new Error('连接配置未保存'))
    .mockImplementationOnce(() => new Promise(resolve => { resolveSave = resolve; }));
  const props = {};
  const cloud = S.cloud;
  S.cloud = 'signed-in';
  const save = () => [...host.querySelectorAll('button')].find(b => b.textContent === '保存')!;
  const fill = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  try {
    await act(async () => { openModal('mcpConnector', props); root.render(<ModalHost/>); });
    expect(save().disabled).toBe(true);
    const [name, url] = host.querySelectorAll('input');
    await act(async () => { fill(name, '文档工具'); fill(url, 'invalid'); });
    expect(save().disabled).toBe(true);
    await act(async () => fill(url, 'https://example.com/mcp'));
    await act(async () => url.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(host.querySelector('[role=alert]')?.textContent).toBe('连接配置未保存');
    expect(url.value).toBe('https://example.com/mcp');
    await act(async () => save().click());
    expect(api).toHaveBeenLastCalledWith('POST', '/api/mcp/servers', {
      name: '文档工具', transport: { type: 'http', url: 'https://example.com/mcp' },
    }, { timeoutMs: 15000 });
    await act(async () => closeModal());
    expect(topModal()?.props).toBe(props);
    const onOk = vi.fn();
    await act(async () => openModal('confirm', { title: '确认执行', onOk }));
    expect(url.closest('.modal-layer')?.hasAttribute('inert')).toBe(true);
    await act(async () => url.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onOk).not.toHaveBeenCalled();
    await act(async () => resolveSave({ id: 'fixture' }));
    expect(topModal()?.id).toBe('confirm');
    expect(save().disabled).toBe(true);
    await act(async () => closeModal());
    expect(topModal()).toBeUndefined();
  } finally {
    await act(async () => {
      if (topModal()?.id === 'confirm') closeModal(true);
      if (topModal()?.props === props) closeModal(true);
      root.unmount();
      S.cloud = cloud;
    });
  }
});
