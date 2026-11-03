import { expect, it } from 'vitest';
import { contextRecovery } from './contextRecovery';

it.each([
  { code: 'USER_LLM_PROVIDER_CONTEXT_TOO_LARGE', message: 'The request is too large for the model provider' },
  { message: 'ContextTooLarge: prompt exceeds context limit' },
  { code: 'ContextTooLarge', message: 'rejected' },
  { message: 'API request failed: HTTP 413 Payload Too Large' },
  { code: 'UserLlmProviderContextTooLarge', message: 'The model provider returned an error' },
  { http_status: 413, message: 'rejected' },
  { status: 413, message: 'rejected' },
  new Error('maximum context length exceeded'),
])('PA-CONTEXT-01 AC-1 identifies actual context and payload failures: %j', error => {
  expect(contextRecovery(error)).toEqual({ recovery: 'compact', text: '上下文或请求体过大，模型未能完成这一轮。请先压缩上下文，完成后再手动发送任务。' });
});
it.each([{ code: 'USER_LLM_PROVIDER_GATEWAY_ERROR', message: 'The model provider returned an error' }, { code: 'UserLlmProviderGatewayError', message: 'The model provider returned an error' }, { status: 429 }, new Error('network unavailable'), { message: 'File 413.png not found' }])('PA-CONTEXT-01 AC-1 does not offer compression for unrelated errors: %j', error => {
  expect(contextRecovery(error)).toBeNull();
});
