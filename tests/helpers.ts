import { expect, type Page } from '@playwright/test';

export async function waitForBook(page: Page, title = '静读 · 给文字留一点空白') {
  await expect(page.locator('.book-heading .book-title')).toHaveText(title);
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeVisible();
  await expect(page.locator('.reading-progress small')).toContainText('章');
}

export async function savedCfi(page: Page) {
  const id = await page.locator('.reading-space').getAttribute('data-book-id');
  if (!id) return '';
  return page.evaluate((bookId) => new Promise<string>((resolve, reject) => {
    const open = indexedDB.open('quiet-reader-library');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('progress', 'readonly');
      const request = transaction.objectStore('progress').get(bookId);
      request.onsuccess = () => resolve(request.result?.cfi ?? '');
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    };
  }), id);
}

const lastReaderBook = new WeakMap<Page, string>();
/** Follow the actual new navigation: reader → bookshelf → per-book notes page. */
export async function openNotesPage(page: Page) {
  if (await page.getByRole('main', { name: '我的笔记', exact: true }).isVisible()) {
    for (const summary of await page.locator('.annotation-card details[open] > summary').all()) await summary.click();
    return;
  }
  const id = await page.locator('.reading-space').getAttribute('data-book-id');
  if (id) {
    lastReaderBook.set(page, id);
    await page.getByRole('button', { name: '静读，返回首页' }).click();
    await page.locator(`.book-card[data-book-id="${id}"] .card-notes`).first().click();
    await page.getByLabel('笔记分类').selectOption('all');
  } else await page.getByRole('button', { name: '我的笔记', exact: true }).click();
  await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toBeVisible();
}
export async function resumeReading(page: Page) {
  if (await page.getByRole('main', { name: '我的笔记', exact: true }).isVisible()) await page.getByRole('button', { name: /返回阅读|返回书架/, exact: true }).click();
  if (await page.getByRole('region', { name: '阅读区域', exact: true }).isVisible()) return;
  const id = lastReaderBook.get(page); if (!id) throw new Error('没有待恢复的阅读书籍');
  await page.locator(`.book-card[data-book-id="${id}"] .book-open`).click();
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeVisible();
  await expect(page.locator('.reading-progress small')).toContainText('章');
}

export async function databaseCounts(page: Page) {
  return page.evaluate(() => new Promise<Record<string, number>>((resolve, reject) => {
    const open = indexedDB.open('quiet-reader-library');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const names = ['books', 'files', 'covers', 'progress'];
      const transaction = db.transaction(names, 'readonly');
      const counts: Record<string, number> = {};
      for (const name of names) {
        const request = transaction.objectStore(name).count();
        request.onsuccess = () => { counts[name] = request.result; };
      }
      transaction.oncomplete = () => { db.close(); resolve(counts); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
}
