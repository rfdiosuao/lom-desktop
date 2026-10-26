import { useSyncExternalStore } from 'react';
import { initialState, loadPersisted, persist, type AppState } from './state';

/* ===== 状态容器 =====
 * 和原型一样只有一棵状态树：update(fn) 修改后通知所有订阅者重新渲染。
 * - update：同步通知（输入框等受控组件必须同步刷新，否则光标和输入法会被打断）
 * - updateSoon：合并到下一帧（流式回复等高频更新） */

export const S: AppState = initialState();
loadPersisted(S);

let version = 0;
const listeners = new Set<() => void>();
const notify = () => { version++; listeners.forEach(l => l()); };

export const update = (fn?: (s: AppState) => void) => {
  fn?.(S);
  persist(S);
  notify();
};

let frame = 0;
export const updateSoon = (fn?: (s: AppState) => void) => {
  fn?.(S);
  if (frame) return;
  frame = requestAnimationFrame(() => { frame = 0; persist(S); notify(); });
};

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
/** 非 React 代码跟踪状态变化（如 FEISHU-02 跟踪一轮回复）；返回取消订阅 */
export const watchStore = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** 订阅整棵状态树；返回当前状态（只读使用，修改一律走 update） */
export const useStore = (): AppState => {
  useSyncExternalStore(subscribe, () => version);
  return S;
};

/* 按路径读写（表单绑定用） */
export const getPath = (p: string): unknown => p.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], S);
export const setPath = (p: string, v: unknown) => {
  const ks = p.split('.');
  const last = ks.pop() as string;
  const o = ks.reduce<Record<string, unknown>>((acc, k) => (acc[k] ??= {}) as Record<string, unknown>, S as unknown as Record<string, unknown>);
  o[last] = v;
};
