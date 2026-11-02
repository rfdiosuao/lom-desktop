import { expect, it } from 'vitest';
import { imageData, IMAGE_MAX } from '@/features/chat/runtime/replyImages';
it('D08 图片内容校验拒绝伪装成图片的 HTML、SVG 和过大内容', () => {
  expect(() => imageData(new TextEncoder().encode('<img src=x onerror=alert(1)>'))).toThrow('不是支持的图片');
  expect(() => imageData(new TextEncoder().encode('<svg onload="alert(1)"/>'))).toThrow();
  expect(() => imageData(new Uint8Array(IMAGE_MAX + 1))).toThrow('15 MB');
});
