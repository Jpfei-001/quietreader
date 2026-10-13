import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { openNotesPage, waitForBook } from './helpers';

async function mockDesktop(page: Page) {
  // Simulate the public native API. This is browser regression evidence, not a Windows system-window test.
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const state = { calls: [] as string[], backgrounds: [] as string[], maximized: false, prevented: false };
    let closeHandler: ((event: { preventDefault(): void }) => void) | undefined;
    let resizeHandler: (() => void) | undefined;
    const requestClose = () => {
      state.prevented = false;
      closeHandler?.({ preventDefault: () => { state.prevented = true; } });
    };
    const native = {
      isMaximized: async () => state.maximized,
      minimize: async () => { state.calls.push('minimize'); },
      toggleMaximize: async () => { state.calls.push('toggleMaximize'); state.maximized = !state.maximized; resizeHandler?.(); },
      close: async () => { state.calls.push('close'); requestClose(); },
      destroy: async () => { state.calls.push('destroy'); },
      setBackgroundColor: async (color: string) => { state.backgrounds.push(color); },
      onResized: async (handler: () => void) => { resizeHandler = handler; return () => { if (resizeHandler === handler) resizeHandler = undefined; }; },
      onCloseRequested: async (handler: (event: { preventDefault(): void }) => void) => { closeHandler = handler; return () => { if (closeHandler === handler) closeHandler = undefined; }; },
    };
    window.__TAURI__ = { window: { getCurrentWindow: () => native } };
    Object.assign(window, { desktopTest: { state, requestClose } });
  });
}
async function nativeState(page: Page) {
  return page.evaluate(() => (window as unknown as { desktopTest: { state: { calls: string[]; backgrounds: string[]; prevented: boolean } } }).desktopTest.state);
}
async function open(page: Page) {
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page);
}
async function select(page: Page) {
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible();
}
async function drafts(page: Page) {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, transaction = db.transaction('annotationDrafts', 'readonly'), result = transaction.objectStore('annotationDrafts').getAll();
      transaction.oncomplete = () => { db.close(); resolve(result.result.map((row: { text: string }) => row.text)); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
}

test('浏览器版不额外出现桌面标题栏', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('toolbar', { name: '桌面窗口标题栏' })).toHaveCount(0);
});

test('桌面标题栏在三种主题、笔记页和重新打开后保持同色，窗口按钮独立工作', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1100 }); await mockDesktop(page); await open(page);
  const bar = page.getByRole('toolbar', { name: '桌面窗口标题栏' });
  await expect(bar).toBeVisible(); await expect(bar.locator('.desktop-title-drag')).toHaveAttribute('data-tauri-drag-region', 'deep');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  for (const [name, color] of [['护眼', '#f2ebdd'], ['明亮', '#fafaf8'], ['深色', '#202321']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(async () => (await nativeState(page)).backgrounds.at(-1)).toBe(color);
    expect(await bar.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await page.locator('.app').evaluate(el => getComputedStyle(el).backgroundColor));
    expect(await bar.evaluate(el => getComputedStyle(el).color)).toBe(await page.locator('.app').evaluate(el => getComputedStyle(el).color));
    await page.screenshot({ path: test.info().outputPath(`桌面标题栏-${name}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  await page.getByRole('button', { name: '最小化窗口', exact: true }).click();
  await page.getByRole('button', { name: '最大化窗口', exact: true }).click();
  await expect(page.getByRole('button', { name: '还原窗口', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '还原窗口', exact: true }).click();
  expect((await nativeState(page)).calls).toEqual(['minimize', 'toggleMaximize', 'toggleMaximize']);
  await openNotesPage(page); await expect(bar).toHaveCSS('background-color', 'rgb(32, 35, 33)');
  await page.reload(); await expect(bar).toHaveCSS('background-color', 'rgb(32, 35, 33)');
  await expect.poll(async () => (await nativeState(page)).backgrounds.at(-1)).toBe('#202321');
});

for (const [width, height] of [[800, 1100], [763, 1050], [733, 1008], [506, 696], [354, 488]]) test(`不同屏幕尺寸下正文与底部操作都在窗口内，不增加页面滚动（${width}×${height}）`, async ({ page }) => {
  await page.setViewportSize({ width, height }); await mockDesktop(page); await open(page);
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '进入专注模式', exact: true })).toBeInViewport();
  const reader = (await page.getByRole('region', { name: '阅读区域', exact: true }).boundingBox())!;
  expect(reader.height).toBeGreaterThanOrEqual(120);
  expect(reader.y).toBeGreaterThanOrEqual(32); expect(reader.y + reader.height).toBeLessThanOrEqual(height);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`自适应窗口-${width}-${height}.png`), fullPage: true });
});

test('所有滚动条隐藏，但长笔记可滚轮滚动，正文iframe与编辑器仍能滚动', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 720 }); await mockDesktop(page); await open(page); await select(page);
  await page.getByRole('button', { name: '思考', exact: true }).click();
  const textarea = page.getByLabel('思考正文'); await textarea.fill('滚动条隐藏，输入内容仍可完整访问。\n'.repeat(80));
  await expect(textarea).toHaveCSS('scrollbar-width', 'none');
  expect(await textarea.evaluate(el => { el.scrollTop = 100; return el.scrollTop > 0; })).toBe(true);
  await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  const frame = page.frameLocator('.reader-viewport iframe').first();
  expect(await frame.locator('html').evaluate(el => getComputedStyle(el).scrollbarWidth)).toBe('none');
  expect(await frame.locator('body').evaluate(el => {
    const probe = el.ownerDocument.createElement('div'); probe.style.cssText = 'width:100px;height:40px;overflow:auto';
    const content = el.ownerDocument.createElement('div'); content.style.height = '400px'; probe.append(content); el.append(probe);
    probe.scrollTop = 100; const result = getComputedStyle(probe).scrollbarWidth === 'none' && probe.scrollTop > 0; probe.remove(); return result;
  })).toBe(true);
  await openNotesPage(page);
  await page.getByText('展开思考（1）', { exact: true }).click();
  await expect(page.locator('.thought-entry')).toContainText('滚动条隐藏，输入内容仍可完整访问。');
  await expect(page.locator('html')).toHaveCSS('scrollbar-width', 'none');
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.clientWidth === innerWidth)).toBe(true);
  await page.mouse.move(700, 600); await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect(page.getByRole('toolbar', { name: '桌面窗口标题栏' })).toBeInViewport();
});

for (const method of ['button', 'native'] as const) test(`桌面关闭先保存快速输入的草稿，再关闭窗口（${method}）`, async ({ page }) => {
  await mockDesktop(page); await open(page); await select(page);
  await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('刚输入的文字，关闭桌面窗口也要保留草稿');
  if (method === 'button') await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  else await page.evaluate(() => (window as unknown as { desktopTest: { requestClose(): void } }).desktopTest.requestClose());
  await expect.poll(async () => (await nativeState(page)).calls.filter(call => call === 'destroy').length).toBe(1);
  expect((await nativeState(page)).prevented).toBe(true);
  expect(await drafts(page)).toEqual(['刚输入的文字，关闭桌面窗口也要保留草稿']);
});

test('桌面草稿写入失败时不关闭，可重试关闭', async ({ page }) => {
  await mockDesktop(page); await open(page); await select(page);
  await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'annotationDrafts') throw new DOMException('测试写入失败', 'QuotaExceededError');
      return original.apply(this, args);
    };
    Object.assign(window, { restoreDesktopDraftWrites: () => { IDBObjectStore.prototype.put = original; } });
  });
  await page.getByLabel('思考正文').fill('写入失败不能关闭或丢失的草稿');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible();
  await expect(page.getByLabel('思考正文')).toHaveValue('写入失败不能关闭或丢失的草稿');
  expect((await nativeState(page)).calls).not.toContain('destroy');
  await page.evaluate(() => (window as unknown as { restoreDesktopDraftWrites(): void }).restoreDesktopDraftWrites());
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await expect.poll(async () => (await nativeState(page)).calls.includes('destroy')).toBe(true);
  expect(await drafts(page)).toEqual(['写入失败不能关闭或丢失的草稿']);
});

test('桌面浮窗与模态框避让标题栏，调整未保存时关闭窗口仍有确认', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 720 }); await mockDesktop(page); await open(page); await select(page);
  await page.getByRole('button', { name: '实线', exact: true }).click();
  await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openNotesPage(page); await page.getByRole('button', { name: '调整摘录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整已有摘录', exact: true });
  await dialog.getByText('查看当前摘录', { exact: true }).click();
  expect((await dialog.boundingBox())!.y).toBeGreaterThanOrEqual(44);
  await page.getByLabel('摘录标题').fill('尚未保存的调整');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '有未保存修改', exact: true });
  await expect(confirmation).toBeVisible(); expect((await confirmation.boundingBox())!.y).toBeGreaterThanOrEqual(32);
  expect((await nativeState(page)).calls).not.toContain('destroy');
  await page.keyboard.press('Escape'); await expect(confirmation).toHaveCount(0);
  await expect(dialog).toBeVisible(); await expect(page.getByLabel('摘录标题')).toHaveValue('尚未保存的调整');
});
