import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { waitForBook, savedCfi, databaseCounts } from './helpers';

const title = '静读 · 给文字留一点空白';
const secondTitle = '静读 · EPUB 2 样书';
const sample = (name = 'minimal.epub') => path.resolve('public/demo', name);

async function closeToShelf(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
}

test('书位卡片点击和键盘添加、封面、最近阅读排序、重复文件去重', async ({ page }) => {
  await page.goto('/');
  const addCard = page.locator('.book-grid').getByRole('button', { name: '添加书籍', exact: true });
  await expect(addCard).toBeVisible();
  await expect(page.getByRole('button', { name: /打开 EPUB|导入书籍|选择一本书/ })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/empty-library.png', fullPage: true });
  const initialChooser = page.waitForEvent('filechooser');
  await addCard.click();
  await (await initialChooser).setFiles(sample());
  await waitForBook(page);
  await expect(page.getByRole('button', { name: '打开 EPUB', exact: true })).toHaveCount(0);
  await closeToShelf(page);
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.locator('.book-cover img')).toBeVisible();
  await expect(addCard).toHaveCount(1);
  await expect(page.getByRole('button', { name: /打开 EPUB|导入书籍/ })).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await addCard.focus();
  await addCard.press('Enter');
  await (await chooser).setFiles(sample('epub2.epub'));
  await waitForBook(page, secondTitle);
  await closeToShelf(page);
  await expect(page.locator('.book-card')).toHaveCount(2);
  await expect(page.locator('.book-card').first().getByRole('heading')).toHaveText(secondTitle);
  await expect(page.locator('.book-cover img')).toHaveCount(2);
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page);
  await closeToShelf(page);
  await expect(page.locator('.book-card').first().getByRole('heading')).toHaveText(title);
  const bytes = await readFile(sample());
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: '换了名字.EPUB', mimeType: 'application/epub+zip', buffer: bytes });
  await waitForBook(page);
  await expect(page.getByRole('status')).toContainText('已在书架中');
  await closeToShelf(page);
  await expect(page.locator('.book-card')).toHaveCount(2);
  const counts = await databaseCounts(page);
  expect(counts).toEqual({ books: 2, files: 2, covers: 2, progress: 2 });
  await page.screenshot({ path: 'test-results/library.png', fullPage: true });
});

test('刷新后不再选文件，断网从书架恢复阅读', async ({ page, context }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample());
  await waitForBook(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第三章 · 山间来信' }).click();
  await expect(page.locator('.reading-progress small')).toContainText('第 3 / 3 章');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.reading-progress small')).toContainText('本章 2 /');
  const previous = await savedCfi(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page);
  await expect(page.getByRole('status')).toContainText('已恢复上次阅读位置');
  await expect.poll(() => savedCfi(page)).toBe(previous);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => savedCfi(page)).not.toBe(previous);
});

test('删除可取消，确认后清理所有关联记录', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample());
  await waitForBook(page);
  await closeToShelf(page);
  await page.getByRole('button', { name: `删除 ${title}`, exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('原始文件不受影响');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.getByRole('button', { name: `删除 ${title}`, exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(0);
  await expect(page.locator('.book-grid').getByRole('button', { name: '添加书籍', exact: true })).toBeVisible();
  expect(await databaseCounts(page)).toEqual({ books: 0, files: 0, covers: 0, progress: 0 });
  await page.reload();
  await expect(page.locator('.book-card')).toHaveCount(0);
});

test('旧版 localStorage 的 CFI 迁移到 IndexedDB', async ({ page }) => {
  const bytes = await readFile(sample());
  const id = createHash('sha256').update(bytes).digest('hex');
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample());
  await waitForBook(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第二章 · On a Quiet Morning' }).click();
  await expect(page.locator('.reading-progress small')).toContainText('第 2 / 3 章');
  const cfi = await savedCfi(page);
  await closeToShelf(page);
  await page.getByRole('button', { name: `删除 ${title}`, exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(0);
  await page.evaluate(({ key, position }) => localStorage.setItem(key, JSON.stringify({ version: 1, cfi: position, updatedAt: 123 })), { key: `quiet-reader:progress:${id}`, position: cfi });
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample());
  await waitForBook(page);
  await expect(page.getByRole('status')).toContainText('已恢复上次阅读位置');
  await expect(page.locator('.reading-progress small')).toContainText('第 2 / 3 章');
  expect(await page.evaluate((key) => localStorage.getItem(key), `quiet-reader:progress:${id}`)).toBeNull();
});

test('存储空间不足时提示中文错误，导入事务没有残留', async ({ page }) => {
  await page.addInitScript(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === 'files') throw new DOMException('空间不足', 'QuotaExceededError');
      return key === undefined ? add.call(this, value) : add.call(this, value, key);
    };
  });
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample());
  await expect(page.getByRole('alert')).toContainText('存储空间不足');
  expect(await databaseCounts(page)).toEqual({ books: 0, files: 0, covers: 0, progress: 0 });
  await expect(page.locator('.book-card')).toHaveCount(0);
});
