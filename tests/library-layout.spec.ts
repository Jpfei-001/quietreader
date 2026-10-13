import { expect, test } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';

test('书架作者与章节进度同一行，左右对齐，窄屏长作者不挤出卡片', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub'));
  await waitForBook(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第二章 · On a Quiet Morning' }).click();
  await expect(page.locator('.reading-progress small')).toContainText('第 2 / 3 章');
  const id = await page.locator('.reading-space').getAttribute('data-book-id');
  expect(id).not.toBeNull();
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await expect(page.locator('.card-progress')).toHaveText('读到第 2 / 3 章');

  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await expect(page.locator('.card-author')).toHaveText('静读工作室');
    const bounds = await page.locator('.card-meta').evaluate((row) => {
      const author = row.querySelector('.card-author')!.getBoundingClientRect();
      const progress = row.querySelector('.card-progress')!.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      return {
        left: author.left - box.left,
        right: box.right - progress.right,
        centerDifference: Math.abs(author.y + author.height / 2 - progress.y - progress.height / 2),
        gap: progress.left - author.right,
        overflowing: row.scrollWidth > row.clientWidth,
      };
    });
    expect(bounds.left).toBeCloseTo(0, 1);
    expect(bounds.right).toBeCloseTo(0, 1);
    expect(bounds.centerDifference).toBeLessThanOrEqual(2);
    expect(bounds.gap).toBeGreaterThanOrEqual(7);
    expect(bounds.overflowing).toBe(false);
    if (width !== 320) await page.screenshot({ path: `test-results/author-progress-${width}.png`, fullPage: true });
  }

  const longAuthor = '这是一位名字非常长的作者，用于验证窄屏显示和省略处理';
  await page.evaluate(({ bookId, author }) => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('quiet-reader-library');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('books', 'readwrite');
      const store = transaction.objectStore('books');
      const request = store.get(bookId);
      request.onsuccess = () => store.put({ ...request.result, author });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }), { bookId: id!, author: longAuthor });
  await page.reload();
  const author = page.locator('.card-author');
  await expect(author).toHaveAttribute('title', longAuthor);
  await expect(author).toHaveCSS('text-overflow', 'ellipsis');
  await expect(page.locator('.card-progress')).toHaveText('读到第 2 / 3 章');
  const widths = await page.locator('.card-meta').evaluate((row) => {
    const author = row.querySelector('.card-author')!;
    return { fits: row.scrollWidth <= row.clientWidth, truncated: author.scrollWidth > author.clientWidth, authorWidth: author.clientWidth };
  });
  expect(widths.fits).toBe(true);
  expect(widths.truncated).toBe(true);
  expect(widths.authorWidth).toBeGreaterThan(0);
});
