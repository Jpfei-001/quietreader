import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { followBrowserWindows } from './browserWindowFollow';
function clock() {
  let next = 0; const frames = new Map<number, FrameRequestCallback>();
  const window = { closed: false, performance, requestAnimationFrame(callback: FrameRequestCallback) { frames.set(++next, callback); return next; }, cancelAnimationFrame(id: number) { frames.delete(id); }, setInterval(callback: () => void, ms: number) { return setInterval(callback, ms) as unknown as number; }, clearInterval(id: number) { clearInterval(id); } } as unknown as Window;
  return { window, frames, fire() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); } };
}
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
describe('浏览器双窗口逐帧跟随', () => {
  it('随每帧更新；两窗口同一帧不重复执行，不等 500ms', () => {
    const main = clock(), child = clock(), tick = vi.fn(), stop = followBrowserWindows(main.window, child.window, tick);
    main.fire(); child.fire(); expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16); main.fire(); child.fire(); expect(tick).toHaveBeenCalledTimes(2); stop();
  });
  it('主页面不出帧时助手仍可驱动跟随', () => {
    const main = clock(), child = clock(), tick = vi.fn(), stop = followBrowserWindows(main.window, child.window, tick);
    child.fire(); vi.advanceTimersByTime(16); child.fire(); expect(tick).toHaveBeenCalledTimes(2); stop();
  });
  it('帧源受限时 100ms 兜底；停止时清理帧和定时器', () => {
    const main = clock(), child = clock(), tick = vi.fn(); child.window.requestAnimationFrame = () => { throw new Error('Frame source unavailable'); };
    const stop = followBrowserWindows(main.window, child.window, tick); vi.advanceTimersByTime(100); expect(tick).toHaveBeenCalledTimes(1); stop();
    expect(main.frames.size).toBe(0); expect(child.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0); vi.advanceTimersByTime(500); expect(tick).toHaveBeenCalledTimes(1);
  });
  it('回调内停止后不再次注册帧，防止关闭与模式切换后继续移动', () => {
    const main = clock(), child = clock(); let stop = () => {}; const tick = vi.fn(() => stop()); stop = followBrowserWindows(main.window, child.window, tick); main.fire();
    expect(tick).toHaveBeenCalledTimes(1); expect(main.frames.size).toBe(0); expect(child.frames.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
