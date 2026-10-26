import { afterEach } from 'vitest';
import { initialState } from '@/state/state';
import { S } from '@/state/store';

// Node 25 may expose an incomplete Web Storage global before jsdom initializes.
for (const name of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[name]?.getItem === 'function') continue;
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: key => data.get(String(key)) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => { data.delete(String(key)); },
    setItem: (key, value) => { data.set(String(key), String(value)); },
  };
  Object.defineProperty(globalThis, name, { configurable: true, value: storage });
}

/* jsdom 没有 requestAnimationFrame 时用定时器代替（updateSoon 依赖它合并刷新） */
globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0) as unknown as number;

/** 每个用例结束后把状态树恢复成初始值，用例之间互不影响 */
afterEach(() => { Object.assign(S, initialState()); });
