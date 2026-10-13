import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';
async function nativeMock(page: Page, failDetached = false, preferredMode?: 'detached' | 'floating') {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.exposeFunction('resizeAiNativeMock', async (width: number) => page.setViewportSize({ width, height: 900 }));
  await page.addInitScript(({ failDetached, preferredMode }) => {
    if (window !== window.top) return;
    if (preferredMode) localStorage.setItem('quiet-reader:ai-preferences:v1', JSON.stringify({ version: 1, model: 'deepseek-chat', preferredMode }));
    const calls: string[] = []; Object.assign(window, { aiNativeCalls: calls });
    const listeners = new Map<string, Set<(event: { payload: unknown }) => void>>();
    window.__TAURI__ = {
      core: { invoke: async (command: string) => {
        calls.push(command);
        if (command === 'ai_key_info') return { configured: false, remembered: false };
        if (command === 'ai_window_expand') { if (failDetached) return { expanded: false, reason: '空间不足' }; await (window as unknown as { resizeAiNativeMock(width: number): Promise<void> }).resizeAiNativeMock(1320); return { expanded: true }; }
        if (command === 'ai_window_restore') { await (window as unknown as { resizeAiNativeMock(width: number): Promise<void> }).resizeAiNativeMock(900); return; }
        if (command === 'ai_expansion_fits') {
          const w = window as any;
          if (w.aiHoldFit) { w.aiHoldFit = false; return new Promise<boolean>(resolve => { (w.aiFitResolvers ??= []).push(resolve); }); }
          return w.aiFitResults?.shift() ?? true;
        }
        if (command === 'ai_detached_open') {
          if (!(window as any).aiDetachedWorks) throw new Error('模拟独立窗口创建失败');
          queueMicrotask(() => listeners.get('quiet-ai-action')?.forEach(callback => callback({ payload: { type: 'snapshot' } }))); return;
        }
        if (command === 'ai_detached_hide' || command === 'ai_detached_show') return;
        throw new Error('Unexpected mock command');
      } },
      event: { listen: async (name: string, cb: (event: { payload: unknown }) => void) => { const group = listeners.get(name) ?? new Set(); group.add(cb); listeners.set(name, group); return () => group.delete(cb); }, emitTo: async () => {} },
      window: { getCurrentWindow: () => ({ isMaximized: async () => false, setBackgroundColor: async () => {}, onResized: async () => () => {}, onCloseRequested: async () => () => {}, minimize: async () => {}, toggleMaximize: async () => {}, close: async () => { calls.push('host-close'); }, destroy: async () => { calls.push('host-destroy'); } }) },
    } as never;
  }, { failDetached, preferredMode });
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page);
}
async function ask(page: Page) {
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => { const range = p.ownerDocument.createRange(); range.selectNodeContents(p); const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range); p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  await page.getByRole('button', { name: '问 AI', exact: true }).click();
}
test('先打开 AI 再打开／固定右侧目录，目录保持原阅读边界，正文与关闭操作可用（窗口 API 模拟）', async ({ page }) => {
  await nativeMock(page); await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('radio', { name: '右侧', exact: true }).check(); await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await ask(page); await expect(page.locator('.ai-expanded-panel')).toBeVisible(); await page.getByRole('button', { name: '目录', exact: true }).click();
  const backdrop = await page.locator('.panel-backdrop').boundingBox(); expect(backdrop!.width).toBe(900); await expect(page.getByRole('button', { name: '固定目录', exact: true })).toBeVisible(); await page.getByRole('button', { name: '固定目录', exact: true }).click();
  await expect(page.locator('.contents-dock')).toHaveCSS('width', '288px'); const dock = await page.locator('.contents-dock').boundingBox(), ai = await page.locator('.ai-expanded-panel').boundingBox(); expect(dock!.x + dock!.width).toBeLessThanOrEqual(ai!.x + 1);
  await expect(page.frameLocator('.reader-viewport iframe').first().locator('p').first()).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  for (const theme of ['护眼', '深色', '明亮']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    await expect(page.locator('.app')).toHaveAttribute('data-ai-reading-expanded', 'true');
    const box = (await page.locator('.contents-dock').boundingBox())!; expect(box.x + box.width).toBeLessThanOrEqual(ai!.x + 1);
  }
  await page.getByRole('complementary', { name: '设置面板' }).getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click(); await expect(page.locator('.ai-expanded-panel')).toHaveCount(0); await expect(page.locator('.app')).not.toHaveAttribute('data-ai-reading-expanded', 'true'); await expect(page.locator('.app')).not.toHaveClass(/ai-reading-expanded/); expect(await page.evaluate(() => innerWidth)).toBe(900); await expect(page.frameLocator('.reader-viewport iframe').first().locator('p').first()).toBeVisible();
});
test('扩展中连续向外／内缩放时阅读壳与 AI 边界逐帧相接，没有透明空隙或叠压', async ({ page }) => {
  await nativeMock(page); await ask(page); await expect(page.getByText('正在切换模式，问答继续保留…', { exact: true })).toHaveCount(0);
  for (const width of [1451, 1413, 1467, 1251, 1320]) {
    await page.setViewportSize({ width, height: 900 });
    const frame = await page.evaluate(() => { const app = document.querySelector('.app')!, panel = document.querySelector('.ai-expanded-panel')!; return { right: app.getBoundingClientRect().right, left: panel.getBoundingClientRect().left, background: getComputedStyle(document.documentElement).backgroundColor }; });
    expect(Math.abs(frame.right - frame.left)).toBeLessThan(1); expect(frame.background).toBe('rgb(250, 250, 248)');
  }
  await expect(page.locator('.ai-expanded-panel')).toBeVisible();
  expect(await page.evaluate(() => (window as any).aiNativeCalls)).not.toContain('ai_detached_open');
});
test('扩展三主题画布不透明，分隔线为单物理像素且无叠加边框／阴影', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'devicePixelRatio', { value: 1.75, configurable: true }));
  await nativeMock(page); await ask(page);
  for (const [theme, color] of [['明亮', 'rgb(250, 250, 248)'], ['护眼', 'rgb(242, 235, 221)'], ['深色', 'rgb(32, 35, 33)']]) {
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: theme, exact: true }).click(); await page.getByRole('complementary', { name: '设置面板' }).getByRole('button', { name: '关闭面板', exact: true }).click();
    const paint = await page.evaluate(() => { const panel = document.querySelector('.ai-expanded-panel')!, ps = getComputedStyle(panel), line = getComputedStyle(panel, '::before'); return { canvas: getComputedStyle(document.documentElement).backgroundColor, root: getComputedStyle(document.querySelector('#root')!).backgroundColor, viewport: getComputedStyle(document.querySelector('.reader-viewport')!).backgroundColor, border: ps.borderLeftWidth, shadow: ps.boxShadow, width: parseFloat(line.width), color: line.backgroundColor, expectedLine: ps.getPropertyValue('--line').trim() }; });
    expect(paint.canvas).toBe(color); expect(paint.root).toBe(color); expect(paint.viewport).toBe(color); expect(paint.border).toBe('0px'); expect(paint.shadow).toBe('none'); expect(Math.abs(paint.width * 1.75 - 1)).toBeLessThan(1.75 / 64 + 0.001); // Chromium layout units are 1/64 CSS px.
  }
});
test('首次扩展后的瞬时不适配不能闪退独立窗，稳定复核后仍保留扩展', async ({ page }) => {
  await nativeMock(page); await ask(page);
  await expect(page.locator('.ai-expanded-panel')).toBeVisible(); await expect(page.getByText('正在切换模式，问答继续保留…', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { Object.assign(window, { aiFitResults: [false, true] }); window.dispatchEvent(new Event('resize')); });
  await expect.poll(() => page.evaluate(() => (window as unknown as { aiFitResults: boolean[] }).aiFitResults.length)).toBe(0);
  await expect(page.locator('.ai-expanded-panel')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { aiNativeCalls: string[] }).aiNativeCalls)).not.toContain('ai_detached_open');
});
test('连续尺寸事件合并检查，持续两次不适配才自动回退一次且不改模式偏好', async ({ page }) => {
  await nativeMock(page); await ask(page); await expect(page.getByText('正在切换模式，问答继续保留…', { exact: true })).toHaveCount(0);
  const before = await page.evaluate(() => localStorage.getItem('quiet-reader:ai-preferences:v1'));
  const checksBefore = await page.evaluate(() => { const count = (window as any).aiNativeCalls.filter((c: string) => c === 'ai_expansion_fits').length; Object.assign(window, { aiFitResults: [false, false], aiDetachedWorks: true }); for (let i = 0; i < 30; i++) window.dispatchEvent(new Event('resize')); return count; });
  await expect(page.locator('.ai-expanded-panel')).toHaveCount(0);
  const calls = await page.evaluate(() => (window as any).aiNativeCalls as string[]);
  expect(calls.filter(c => c === 'ai_expansion_fits')).toHaveLength(checksBefore + 2); expect(calls.filter(c => c === 'ai_detached_open')).toHaveLength(1); expect(calls).toContain('ai_detached_show');
  expect(await page.evaluate(() => localStorage.getItem('quiet-reader:ai-preferences:v1'))).toBe(before);
});
for (const change of ['resize', 'close'] as const) test(`过期失败读数不能触发切窗（${change}）`, async ({ page }) => {
  await nativeMock(page); await ask(page); await expect(page.getByText('正在切换模式，问答继续保留…', { exact: true })).toHaveCount(0);
  const checksBefore = await page.evaluate(() => { const count = (window as any).aiNativeCalls.filter((c: string) => c === 'ai_expansion_fits').length; Object.assign(window, { aiHoldFit: true }); window.dispatchEvent(new Event('resize')); return count; });
  await expect.poll(() => page.evaluate(() => (window as any).aiFitResolvers?.length ?? 0)).toBe(1);
  if (change === 'close') await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  else await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.evaluate(() => (window as any).aiFitResolvers.shift()(false));
  // Trigger a positive settled measurement after an obsolete in-flight false.
  if (change === 'resize') { await expect.poll(() => page.evaluate(() => (window as any).aiNativeCalls.filter((c: string) => c === 'ai_expansion_fits').length)).toBe(checksBefore + 2); await expect(page.locator('.ai-expanded-panel')).toBeVisible(); }
  else await expect(page.locator('.ai-expanded-panel')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).aiNativeCalls)).not.toContain('ai_detached_open');
});
async function expectFocusedHeading(page: Page) {
  await expect(page.locator('.app')).toHaveAttribute('data-ai-reading-expanded', 'true');
  await expect(page.locator('.reading-topbar .brand')).toHaveCSS('display', 'none');
  await expect(page.locator('.reading-topbar .toolbar')).toHaveCSS('display', 'none');
  const edges = await page.locator('.reading-topbar').evaluate(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) }; });
  const [title, author, chapter] = await page.locator('.book-title,.book-author,.reading-chapter').evaluateAll(items => items.map(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
  expect(Math.abs(title.left - edges.left)).toBeLessThan(1); expect(Math.abs(author.left - edges.left)).toBeLessThan(1); expect(Math.abs(chapter.right - edges.right)).toBeLessThan(1);
  await expect(page.locator('.reading-chapter')).toHaveCSS('text-align', 'right'); await expect(page.locator('.book-heading')).toHaveCSS('text-align', 'left');
  await expect(page.locator('.reader-footer')).toHaveCSS('visibility', 'hidden'); await expect(page.locator('.ai-expanded-panel')).toBeVisible(); await expect(page.locator('.contents-dock')).toBeVisible();
  const dock = (await page.locator('.contents-dock').boundingBox())!, ai = (await page.locator('.ai-expanded-panel').boundingBox())!;
  expect(dock.x + dock.width).toBeLessThanOrEqual(ai.x + 1);
  await expect(page.frameLocator('.reader-viewport iframe').first().locator('p').first()).toBeVisible();
}
for (const side of ['左侧', '右侧']) for (const focusFirst of [false, true]) for (const pinFirst of [false, true]) test(`AI 扩展＋${side}固定目录时专注切换与标题左右对齐，退出恢复（先专注=${focusFirst}，先固定=${pinFirst}）`, async ({ page }) => {
  await nativeMock(page); await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('radio', { name: side, exact: true }).check(); await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  const pin = async () => { await page.getByRole('button', { name: '目录', exact: true }).click(); await page.getByRole('button', { name: '固定目录', exact: true }).click(); };
  if (pinFirst) await pin();
  if (focusFirst) await page.getByRole('button', { name: '进入专注模式', exact: true }).click();
  await ask(page); await expect(page.locator('.ai-expanded-panel')).toBeVisible(); await expect(page.getByText('正在切换模式，问答继续保留…', { exact: true })).toHaveCount(0);
  if (!pinFirst) { if (focusFirst) await page.getByRole('button', { name: '显示工具栏', exact: true }).click(); await pin(); if (focusFirst) await page.getByRole('button', { name: '进入专注模式', exact: true }).click(); }
  const width = (await page.locator('.reading-space').boundingBox())!.width;
  if (!focusFirst) await page.getByRole('button', { name: '进入专注模式', exact: true }).click();
  await expectFocusedHeading(page); expect((await page.locator('.reading-space').boundingBox())!.width).toBe(width);
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click(); await expect(page.locator('.reading-topbar .brand')).toBeVisible(); await expect(page.getByRole('button', { name: '目录', exact: true })).toBeVisible(); await expect(page.locator('.reader-footer')).toHaveCSS('visibility', 'visible');
  await page.getByRole('button', { name: '进入专注模式', exact: true }).click(); await expectFocusedHeading(page);
  await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click(); await expect(page.locator('.ai-expanded-panel')).toHaveCount(0); await expect(page.locator('.reading-topbar .brand')).toHaveCSS('display', 'none');
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click(); await expect(page.locator('.reading-topbar .brand')).toBeVisible();
});
for (const saved of ['detached', 'floating'] as const) test(`桌面已有 ${saved} 偏好时新会话仍默认扩展，当前会话手动悬浮保留（窗口 API 模拟）`, async ({ page }) => {
  await nativeMock(page, false, saved); await ask(page); await expect(page.locator('.ai-expanded-panel')).toBeVisible();
  let calls = await page.evaluate(() => (window as unknown as { aiNativeCalls: string[] }).aiNativeCalls); expect(calls).toContain('ai_window_expand'); expect(calls).not.toContain('ai_detached_open');
  await page.getByLabel('助手呈现模式').selectOption('floating'); await expect(page.locator('.ai-floating')).toBeVisible(); await ask(page); await expect(page.locator('.ai-floating')).toBeVisible();
  calls = await page.evaluate(() => (window as unknown as { aiNativeCalls: string[] }).aiNativeCalls); expect(calls.filter(c => c === 'ai_window_expand')).toHaveLength(1);
  await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click(); await expect(page.locator('.ai-floating')).toHaveCount(0); await ask(page); await expect(page.locator('.ai-expanded-panel')).toBeVisible();
});
test('桌面独立助手创建失败不会留在切换中，隐藏失败窗口并回退可关闭的悬浮（窗口 API 模拟）', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await nativeMock(page, true); await ask(page);
  await expect(page.locator('.ai-floating')).toBeVisible(); await expect(page.getByText('正在切换模式，问答继续保留…', { exact: true })).toHaveCount(0); await expect(page.locator('.ai-inline-notice').first()).toContainText('已使用悬浮窗');
  const calls = await page.evaluate(() => (window as unknown as { aiNativeCalls: string[] }).aiNativeCalls); expect(calls).toContain('ai_detached_hide'); expect(calls).not.toContain('ai_detached_show'); expect(errors).toEqual([]);
  await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click(); await expect(page.locator('.ai-floating')).toHaveCount(0); await expect(page.frameLocator('.reader-viewport iframe').first().locator('p').first()).toBeVisible();
});
