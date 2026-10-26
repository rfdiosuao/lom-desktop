const STOP_TIMEOUT = 15000;

/** A transport may ignore abort; callers must also stop awaiting it before updating state. */
export function stopAttempt() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STOP_TIMEOUT);
  const wait = <T>(work: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => {
      controller.signal.removeEventListener('abort', abort);
      reject(new Error('核心尚未确认停止，任务仍显示运行中，请重试或等待发送登记完成'));
    };
    if (controller.signal.aborted) { abort(); return; }
    controller.signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
  });
  return { signal: controller.signal, wait, finish: () => clearTimeout(timer) };
}
