/** Both windows can drive following, so an unfocused reading page is not the only frame source.
 * This is still best-effort: browsers may suspend JS during native dragging or throttle both pages.
 */
export function followBrowserWindows(main: Window, child: Window, tick: () => void): () => void {
  let stopped = false, lastTick = -Infinity, mainFrame: number | undefined, childFrame: number | undefined;
  const run = () => { if (stopped) return; const now = main.performance.now(); if (now - lastTick < 12) return; lastTick = now; tick(); };
  const mainLoop = () => { if (stopped) return; run(); if (!stopped) mainFrame = main.requestAnimationFrame(mainLoop); };
  const childLoop = () => { if (stopped) return; run(); if (!stopped && !child.closed) { try { childFrame = child.requestAnimationFrame(childLoop); } catch { /* A navigated/closed child cannot provide frames. */ } } };
  mainFrame = main.requestAnimationFrame(mainLoop);
  try { childFrame = child.requestAnimationFrame(childLoop); } catch { /* Main frames and the fallback still work. */ }
  const timer = main.setInterval(run, 100);
  return () => { stopped = true; if (mainFrame !== undefined) main.cancelAnimationFrame(mainFrame); if (childFrame !== undefined) { try { child.cancelAnimationFrame(childFrame); } catch { /* Child may no longer be same-origin. */ } } main.clearInterval(timer); };
}
