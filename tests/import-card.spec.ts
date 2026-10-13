import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { databaseCounts, waitForBook } from './helpers';

async function dropFiles(page: Page, files: { name: string; bytes: number[] }[]) {
  const transfer = await page.evaluateHandle((entries) => {
    const data = new DataTransfer();
    for (const entry of entries) data.items.add(new File([Uint8Array.from(entry.bytes)], entry.name));
    return data;
  }, files);
  const card = page.getByRole('button', { name: '添加书籍', exact: true });
  await card.dispatchEvent('dragenter', { dataTransfer: transfer });
  await expect(card).toHaveClass(/is-dragging/);
  await card.dispatchEvent('drop', { dataTransfer: transfer });
  await transfer.dispose();
}

test('书架空白书位支持拖放校验、导入、重复去重和窄屏显示', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = page.getByRole('button', { name: '添加书籍', exact: true });
  await expect(card).toBeVisible();
  const bounds = await card.boundingBox();
  expect(bounds!.width).toBeGreaterThan(100);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await dropFiles(page, [{ name: 'not-an-epub.pdf', bytes: [1, 2, 3] }]);
  await expect(page.getByRole('alert')).toContainText('.epub');
  await expect(card).not.toHaveClass(/is-dragging/);
  expect((await databaseCounts(page)).books).toBe(0);

  const bytes = Array.from(await readFile(path.resolve('public/demo/minimal.epub')));
  await dropFiles(page, [{ name: 'first.epub', bytes }, { name: 'second.epub', bytes }]);
  await expect(page.getByRole('alert')).toContainText('每次请拖入一本');
  expect((await databaseCounts(page)).books).toBe(0);

  await dropFiles(page, [{ name: 'first.epub', bytes }]);
  await waitForBook(page);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(card).toBeVisible();

  await dropFiles(page, [{ name: 'renamed.epub', bytes }]);
  await waitForBook(page);
  await expect(page.getByRole('status')).toContainText('已在书架中');
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(card).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/import-card-mobile.png', fullPage: true });
});
