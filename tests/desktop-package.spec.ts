import { expect, test, type Page } from '@playwright/test';

async function counts(page: Page) {
  return page.evaluate(() => new Promise<Record<string, number>>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tables = ['books', 'files', 'covers', 'progress', 'annotations', 'thoughts', 'annotationDrafts'];
      const tx = db.transaction(tables, 'readonly'), result: Record<string, number> = {};
      for (const name of tables) {
        const query = tx.objectStore(name).count(); query.onsuccess = () => { result[name] = query.result; };
      }
      tx.oncomplete = () => { db.close(); resolve(result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

test('桌面前端新用户首次启动书架、笔记、草稿为空，不自动导入指南与样书', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '使用指南', exact: true })).toBeVisible();
  await expect(page.locator('.book-card')).toHaveCount(0);
  await expect.poll(() => counts(page)).toEqual({ books: 0, files: 0, covers: 0, progress: 0, annotations: 0, thoughts: 0, annotationDrafts: 0 });
  await page.reload(); await expect(page.locator('.book-card')).toHaveCount(0);
  await page.getByRole('button', { name: '我的笔记', exact: true }).click();
  await expect(page.locator('.annotation-card')).toHaveCount(0);
  await expect(page.locator('.draft-list')).toHaveCount(0);
});

test('使用指南仅用户点击后导入，重启不清理已有书籍，也不自动附带笔记', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '使用指南', exact: true }).click();
  await expect(page.locator('.book-heading .book-title')).toHaveText('静读操作指南');
  await expect.poll(async () => (await counts(page)).books).toBe(1);
  const saved = await counts(page);
  expect(saved.annotations).toBe(0); expect(saved.thoughts).toBe(0); expect(saved.annotationDrafts).toBe(0);
  await page.reload(); await expect(page.locator('.book-card')).toHaveCount(1);
  expect((await counts(page)).books).toBe(1);
});
