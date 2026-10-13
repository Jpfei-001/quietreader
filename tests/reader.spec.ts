import { expect, test } from '@playwright/test';
import path from 'node:path';
import { waitForBook, savedCfi } from './helpers';

const samplePath = (name: string) => path.resolve('public/demo', name);

test('样书阅读、图片、翻页、目录、主题、字号和缩放', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.screenshot({ path: 'test-results/landing.png', fullPage: true });
  await page.getByRole('button', { name: '先读一段样书' }).click();
  await waitForBook(page);
  const frame = page.frameLocator('.reader-viewport iframe').first();
  await expect(frame.locator('h1')).toContainText('留一点空白');
  await expect.poll(() => frame.locator('img').first().evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const first = await savedCfi(page);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => savedCfi(page)).not.toBe(first);
  await frame.locator('body').evaluate((element) => { element.tabIndex = -1; element.focus(); });
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => savedCfi(page)).toBe(first);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第二章 · On a Quiet Morning' }).click();
  await expect(page.locator('.reading-progress small')).toContainText('第 2 / 3 章');
  await expect(page.frameLocator('.reader-viewport iframe').first().locator('h1')).toContainText('Quiet Morning');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.locator('.app')).toHaveClass(/theme-dark/);
  await page.locator('#font-size').fill('26');
  await expect(page.locator('output')).toHaveText('26 px');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 800, height: 650 });
  await expect(page.locator('.reading-progress small')).toContainText('第 2 / 3 章');
  await expect.poll(() => page.frameLocator('.reader-viewport iframe').first().locator('body').evaluate((element) => getComputedStyle(element).fontSize)).toBe('26px');
  await page.getByRole('button', { name: '进入专注模式' }).click();
  await expect(page.locator('.book-title')).toBeVisible();
  await expect(page.locator('.book-author')).toBeVisible();
  await expect(page.locator('.topbar .toolbar')).toHaveCSS('visibility', 'hidden');
  await page.getByRole('button', { name: '显示工具栏' }).click();
  await expect(page.locator('.topbar')).toHaveCSS('visibility', 'visible');
  await page.screenshot({ path: 'test-results/reading.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('书名和作者为靠左一级标题，宽屏双栏与窄屏单栏自动切换', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: '先读一段样书' }).click();
  await waitForBook(page);
  const heading = page.locator('.book-heading h1');
  await expect(heading).toContainText('静读 · 给文字留一点空白');
  await expect(heading).toContainText('静读工作室');
  await expect(page.locator('.book-heading')).toHaveCSS('text-align', 'left');
  await expect(page.locator('.book-author')).toHaveCSS('font-size', '11px');
  const bounds = await heading.boundingBox();
  expect(bounds!.x).toBeLessThan(1440 / 3);
  await expect(page.locator('.reading-space')).toHaveAttribute('data-columns', '2');
  const viewport = await page.locator('.reader-viewport').boundingBox();
  await expect.poll(() => page.frameLocator('.reader-viewport iframe').first().locator('body').evaluate((body) => parseFloat(getComputedStyle(body).columnWidth))).toBeLessThan(viewport!.width / 2);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第二章 · On a Quiet Morning' }).click();
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.reading-progress small')).toContainText('第 2 / 3 章');
  await page.screenshot({ path: 'test-results/two-columns.png', fullPage: true });
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(page.locator('.reading-space')).toHaveAttribute('data-columns', '1');
  await expect(heading).toBeVisible();
  await expect(page.locator('.reading-progress small')).toContainText('第 2 / 3 章');
  await page.screenshot({ path: 'test-results/one-column.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator('.reading-space')).toHaveAttribute('data-columns', '2');
  await expect(page.locator('.reading-progress small')).toContainText('第 2 / 3 章');
});

test('刷新后重新选择同一本书恢复阅读位置，并可断网翻页', async ({ page, context }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(samplePath('minimal.epub'));
  await waitForBook(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第三章 · 山间来信' }).click();
  await expect(page.locator('.reading-progress small')).toContainText('第 3 / 3 章');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.reading-progress small')).toContainText('本章 2 /');
  const previous = await savedCfi(page);
  await page.reload();
  await context.setOffline(true);
  await page.getByLabel('选择 EPUB 文件').setInputFiles(samplePath('minimal.epub'));
  await expect(page.locator('.book-heading .book-title')).toHaveText('静读 · 给文字留一点空白');
  await expect(page.getByRole('status')).toContainText('已恢复上次阅读位置');
  await expect.poll(() => savedCfi(page)).toBe(previous);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => savedCfi(page)).not.toBe(previous);
});

test('EPUB 2 的 NCX 目录可用', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(samplePath('epub2.epub'));
  await waitForBook(page, '静读 · EPUB 2 样书');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '章节导航' }).getByRole('button')).toHaveCount(3);
  await page.getByRole('button', { name: '第三章 · 山间来信' }).click();
  await expect(page.locator('.reading-progress small')).toContainText('第 3 / 3 章');
});

test('移除书内脚本并拦截外部资源', async ({ page }) => {
  const external: string[] = [];
  const blocked = new Map<string, string>();
  const responses: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('example.invalid')) external.push(request.url());
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('example.invalid')) blocked.set(request.url(), request.failure()?.errorText ?? '');
  });
  page.on('response', (response) => {
    if (response.url().includes('example.invalid')) responses.push(response.url());
  });
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(samplePath('security.epub'));
  await waitForBook(page, '安全验证样书');
  const frame = page.frameLocator('.reader-viewport iframe').first();
  await expect(frame.locator('script')).toHaveCount(0);
  await expect(frame.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('quiet-reader:unsafe-script'))).toBeNull();
  // Chromium 也会为 CSP 拦截产生 request 事件，不能将其当作实际网络发送。
  expect(external.length).toBeGreaterThanOrEqual(2);
  await expect.poll(() => blocked.size).toBe(new Set(external).size);
  for (const reason of blocked.values()) expect(reason).toMatch(/csp|ERR_BLOCKED_BY_CSP/i);
  expect(responses).toEqual([]);
});

test('损坏文件提示错误后仍可打开有效文件', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'broken.epub', mimeType: 'application/epub+zip', buffer: Buffer.from('broken') });
  await expect(page.getByRole('alert')).toContainText('压缩包损坏');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(samplePath('minimal.epub'));
  await waitForBook(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('切换与关闭书籍清理旧 iframe，窄窗口仍可阅读', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 480, height: 720 });
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(samplePath('minimal.epub'));
  await waitForBook(page);
  await page.getByLabel('选择 EPUB 文件').setInputFiles(samplePath('epub2.epub'));
  await waitForBook(page, '静读 · EPUB 2 样书');
  await expect(page.locator('.reader-viewport iframe')).toHaveCount(1);
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  await expect(page.locator('.reader-viewport iframe')).toHaveCount(0);
  await page.getByLabel('选择 EPUB 文件').setInputFiles(samplePath('minimal.epub'));
  await waitForBook(page);
  await expect(page.locator('.reader-viewport iframe')).toHaveCount(1);
  expect(errors).toEqual([]);
});
