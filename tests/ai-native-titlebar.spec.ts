import { expect, test } from '@playwright/test';

test('桌面独立助手自绘标题栏同色、窗口按钮可用，关闭只通知主窗口（公开 API 模拟）', async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 780 });
  await page.addInitScript(() => {
    const calls: string[] = [], backgrounds: string[] = [], actions: { type: string }[] = [];
    let maximized = false, closeSubscriptions = 0, version = 0;
    let receive: ((event: { payload: unknown }) => void) | undefined, resize: (() => void) | undefined;
    const setTheme = (theme: string) => receive?.({ payload: { version: ++version, open: true, activeMode: 'detached', preferredMode: 'expanded', model: 'deepseek-chat', configured: false, switching: false, generating: false, notice: '', theme } });
    const native = {
      isMaximized: async () => maximized,
      minimize: async () => { calls.push('minimize'); },
      toggleMaximize: async () => { calls.push('toggleMaximize'); maximized = !maximized; resize?.(); },
      close: async () => { calls.push('close'); }, destroy: async () => { calls.push('destroy'); },
      setBackgroundColor: async (color: string) => { backgrounds.push(color); },
      onResized: async (handler: () => void) => { resize = handler; return () => { resize = undefined; }; },
      onCloseRequested: async () => { closeSubscriptions++; return () => {}; },
    };
    Object.assign(window, { __TAURI__: { window: { getCurrentWindow: () => native }, core: { invoke: async () => undefined }, event: {
      listen: async (name: string, handler: (event: { payload: unknown }) => void) => { if (name === 'quiet-ai-state') receive = handler; return () => {}; },
      emitTo: async (_label: string, _name: string, action: { type: string }) => { actions.push(action); if (action.type === 'snapshot') setTheme('light'); },
    } }, aiCaptionTest: { calls, backgrounds, actions, setTheme, closeSubscriptions: () => closeSubscriptions } });
  });
  await page.goto('/?ai-assistant=1');
  const bar = page.getByRole('toolbar', { name: '桌面窗口标题栏' });
  await expect(bar).toBeVisible(); await expect(bar).toContainText('静读 · AI 阅读助手');
  await expect(bar.locator('.desktop-title-drag')).toHaveAttribute('data-tauri-drag-region', 'deep');
  for (const [theme, color] of [['light', '#fafaf8'], ['sepia', '#f2ebdd'], ['dark', '#202321']]) {
    await page.evaluate(theme => (window as any).aiCaptionTest.setTheme(theme), theme);
    await expect.poll(() => page.evaluate(() => (window as any).aiCaptionTest.backgrounds.at(-1))).toBe(color);
    expect(await bar.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await page.locator('.ai-question').evaluate(el => getComputedStyle(el).backgroundColor));
    await expect(page.locator('.ai-composer-footer')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
  await bar.getByRole('button', { name: '最小化窗口', exact: true }).click();
  await bar.getByRole('button', { name: '最大化窗口', exact: true }).click();
  await bar.getByRole('button', { name: '还原窗口', exact: true }).click();
  await bar.getByRole('button', { name: '关闭窗口', exact: true }).click();
  expect(await page.evaluate(() => (window as any).aiCaptionTest.calls)).toEqual(['minimize', 'toggleMaximize', 'toggleMaximize']);
  expect(await page.evaluate(() => (window as any).aiCaptionTest.closeSubscriptions())).toBe(0);
  expect(await page.evaluate(() => (window as any).aiCaptionTest.actions.filter((a: { type: string }) => a.type === 'close'))).toHaveLength(1);
});
