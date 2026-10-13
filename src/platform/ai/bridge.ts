interface TauriBridge {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  event: { listen<T>(name: string, callback: (event: { payload: T }) => void): Promise<() => void>; emitTo(target: string, name: string, payload: unknown): Promise<void> };
}
export function tauriBridge(): TauriBridge | undefined {
  const native = typeof window === 'undefined' ? undefined : window.__TAURI__ as unknown as TauriBridge | undefined;
  return typeof native?.core?.invoke === 'function' && typeof native?.event?.listen === 'function' ? native : undefined;
}
export function invokeAi<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const native = tauriBridge();
  if (!native) return Promise.reject(new Error('此操作需要桌面版。'));
  return native.core.invoke<T>(command, args);
}
