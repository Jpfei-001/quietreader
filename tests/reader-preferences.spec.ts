import { expect, test, type Locator, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';

const title = '静读 · 给文字留一点空白';
const sample = path.resolve('public/demo/minimal.epub');

async function preferences(page: Page) {
  return page.evaluate(() => new Promise<{ theme?: string; fontSize?: number; contentsSide?: 'left' | 'right' }>((resolve, reject) => {
    const open = indexedDB.open('quiet-reader-library');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('settings');
      const request = transaction.objectStore('settings').get('reader');
      request.onsuccess = () => resolve(request.result?.value ?? {});
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    };
  }));
}

async function expectCentered(button: Locator) {
  await button.hover();
  const delta = await button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    return {
      x: Math.abs(text.x + text.width / 2 - box.x - box.width / 2),
      y: Math.abs(text.y + text.height / 2 - box.y - box.height / 2),
    };
  });
  expect(delta.x).toBeLessThanOrEqual(2);
  expect(delta.y).toBeLessThanOrEqual(2);
}

async function bodyFont(page: Page) {
  return page.frameLocator('.reader-viewport iframe').first().locator('body').evaluate((body) => getComputedStyle(body).fontSize);
}

test('默认 16px，主题和字号跨刷新及跨书保存，恢复默认也保存', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample);
  await waitForBook(page);
  await expect.poll(() => bodyFont(page)).toBe('16px');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('output')).toHaveText('16 px');
  await page.getByRole('button', { name: '护眼', exact: true }).click();
  await page.locator('#font-size').fill('24');
  await expect.poll(() => preferences(page)).toMatchObject({ theme: 'sepia', fontSize: 24 });
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page);
  await expect(page.locator('.app')).toHaveClass(/theme-sepia/);
  await expect.poll(() => bodyFont(page)).toBe('24px');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/epub2.epub'));
  await waitForBook(page, '静读 · EPUB 2 样书');
  await expect.poll(() => bodyFont(page)).toBe('24px');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.locator('output')).toHaveText('24 px');
  await page.getByRole('button', { name: '恢复默认设置', exact: true }).click();
  await expect.poll(() => preferences(page)).toMatchObject({ theme: 'light', fontSize: 16 });
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page);
  await expect(page.locator('.app')).toHaveClass(/theme-light/);
  await expect.poll(() => bodyFont(page)).toBe('16px');
});

test('目录位置左右切换，跨刷新和跨书保存，恢复默认重置为左侧', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample);
  await waitForBook(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const left = page.getByRole('radio', { name: '左侧', exact: true });
  const right = page.getByRole('radio', { name: '右侧', exact: true });
  await expect(left).toBeChecked();
  await left.focus();
  await page.keyboard.press('ArrowRight');
  await expect(right).toBeChecked();
  await expect.poll(() => preferences(page)).toMatchObject({ contentsSide: 'right' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '章节目录' });
  await expect(panel).toBeVisible();
  const bounds = await panel.boundingBox();
  expect(bounds!.x).toBeGreaterThan(0);
  expect(bounds!.x + bounds!.width).toBeCloseTo(page.viewportSize()!.width, 1);
  await page.screenshot({ path: 'test-results/right-contents.png', fullPage: true });
  await page.getByRole('button', { name: '第二章 · On a Quiet Morning' }).click();
  await expect(page.locator('.reading-progress small')).toContainText('第 2 / 3 章');
  await page.reload();
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(right).toBeChecked();
  await page.keyboard.press('Escape');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/epub2.epub'));
  await waitForBook(page, '静读 · EPUB 2 样书');
  await page.setViewportSize({ width: 390, height: 720 });
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x).toBeCloseTo(30, 1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await left.check();
  await expect.poll(() => preferences(page)).toMatchObject({ contentsSide: 'left' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x).toBe(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await right.check();
  await expect.poll(() => preferences(page)).toMatchObject({ contentsSide: 'right' });
  await page.getByRole('button', { name: '恢复默认设置', exact: true }).click();
  await expect(left).toBeChecked();
  await expect.poll(() => preferences(page)).toMatchObject({ contentsSide: 'left', fontSize: 16, theme: 'light' });
  await page.reload();
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x).toBe(0);
});

test('旧设置缺少目录位置时保留原有主题字号，位置默认为左侧', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample);
  await waitForBook(page);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('quiet-reader-library');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('settings', 'readwrite');
      transaction.objectStore('settings').put({ id: 'reader', value: { version: 1, theme: 'dark', fontSize: 22 } });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
  await page.reload();
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page);
  await expect(page.locator('.app')).toHaveClass(/theme-dark/);
  await expect.poll(() => bodyFont(page)).toBe('22px');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('radio', { name: '左侧', exact: true })).toBeChecked();
  expect((await preferences(page)).contentsSide).toBeUndefined();
  await page.getByRole('radio', { name: '右侧', exact: true }).check();
  await expect.poll(() => preferences(page)).toMatchObject({ theme: 'dark', fontSize: 22, contentsSide: 'right' });
});

test('悬浮文字居中、品牌无悬浮边框、右侧按钮与默认左侧目录弹框', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample);
  await waitForBook(page);
  await expectCentered(page.getByRole('button', { name: '进入专注模式', exact: true }));
  const contents = page.getByRole('button', { name: '目录', exact: true });
  const settings = page.getByRole('button', { name: '设置', exact: true });
  await expect(page.getByRole('button', { name: '阅读设置', exact: true })).toHaveCount(0);
  for (const button of [contents, settings]) {
    await button.hover();
    await expect(button).toHaveCSS('border-top-width', '0px');
  }
  const contentsBounds = await contents.boundingBox();
  const headingBounds = await page.locator('.book-heading').boundingBox();
  const settingsBounds = await settings.boundingBox();
  expect(contentsBounds!.x).toBeGreaterThanOrEqual(headingBounds!.x + headingBounds!.width);
  expect(contentsBounds!.x + contentsBounds!.width).toBeLessThanOrEqual(settingsBounds!.x);
  await expect(page.locator('.toolbar')).toContainText('目录');
  await contents.click();
  const panel = page.getByRole('complementary', { name: '章节目录' });
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x).toBe(0);
  await expect(panel).toHaveCSS('border-top-width', '0px');
  await page.screenshot({ path: 'test-results/left-contents.png', fullPage: true });
  await page.keyboard.press('Escape');
  await settings.click();
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/settings.png', fullPage: true });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 720 });
  expect((await contents.boundingBox())!.x).toBeGreaterThan(390 / 2);
  const toolbarBounds = await page.locator('.toolbar').boundingBox();
  expect(toolbarBounds!.x + toolbarBounds!.width).toBeCloseTo(390 - 20, 1);
  await contents.click();
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())!.x).toBe(0);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  const brand = page.getByRole('button', { name: '静读，返回首页' });
  await brand.hover();
  await expect(brand).toHaveCSS('border-top-width', '0px');
  await expect(brand).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expectCentered(page.getByRole('button', { name: `删除 ${title}`, exact: true }));
  await page.screenshot({ path: 'test-results/delete-hover.png', fullPage: true });
});

test('宽比例封面保持比例铺满组件，边缘居中裁切而不留白', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample);
  await waitForBook(page);
  const id = await page.locator('.reading-space').getAttribute('data-book-id');
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await page.evaluate((bookId) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('quiet-reader-library');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('covers', 'readwrite');
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180"><rect width="600" height="180" fill="#afbfaa"/><circle cx="300" cy="90" r="65" fill="#52735c"/></svg>';
      transaction.objectStore('covers').put({ bookId, blob: new Blob([svg], { type: 'image/svg+xml' }) });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), id);
  await page.reload();
  const image = page.locator('.book-cover img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(600);
  await expect(image).toHaveCSS('object-fit', 'cover');
  await expect(image).toHaveCSS('object-position', '50% 50%');
  const imageBox = await image.boundingBox();
  const coverBox = await page.locator('.book-cover').boundingBox();
  expect(imageBox!.width).toBeCloseTo(coverBox!.width, 1);
  expect(imageBox!.height).toBeCloseTo(coverBox!.height, 1);
  await page.screenshot({ path: 'test-results/cover-fill.png', fullPage: true });
});

test('设置保存失败明确提示，当前阅读仍可使用新字号', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'settings') throw new DOMException('空间不足', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample);
  await waitForBook(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#font-size').fill('24');
  await expect(page.locator('.notice[role="status"]')).toContainText('设置保存失败');
  await page.keyboard.press('Escape');
  await expect.poll(() => bodyFont(page)).toBe('24px');
  expect((await preferences(page)).fontSize).toBeUndefined();
});
