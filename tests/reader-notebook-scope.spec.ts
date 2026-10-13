import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';

const firstTitle = '静读 · 给文字留一点空白';
const secondTitle = '静读 · EPUB 2 样书';
async function importBook(page: Page, filename: string, title: string) {
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve(`public/demo/${filename}`));
  await waitForBook(page, title);
}
async function mark(page: Page) {
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await page.getByRole('button', { name: '实线', exact: true }).click();
  await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '关闭选文工具条', exact: true }).click();
}
async function expectBookScope(page: Page, title: string, count: number) {
  const scope = page.getByLabel('笔记范围');
  await expect(scope).toHaveValue('book');
  await expect(scope.locator('option:checked')).toHaveText(title);
  await expect(page.locator('.annotation-card')).toHaveCount(count);
  if (count) await expect(page.locator('.annotation-card-top').first()).toContainText(title);
}

test('阅读入口按当前书籍筛选，可切全部或其他书，重新进入恢复本书；书架入口仍为全部', async ({ page }) => {
  await page.goto('/');
  await importBook(page, 'minimal.epub', firstTitle);
  await mark(page);
  const firstId = await page.locator('.reading-space').getAttribute('data-book-id');
  await importBook(page, 'epub2.epub', secondTitle);
  await mark(page);
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await expectBookScope(page, secondTitle, 1);
  await expect(page.getByRole('button', { name: '导出本书', exact: true })).toBeVisible();
  await page.getByLabel('笔记范围').selectOption('all');
  await expect(page.locator('.annotation-card')).toHaveCount(2);
  await page.getByLabel('笔记范围').selectOption(`book:${firstId}`);
  await expect(page.getByLabel('笔记范围').locator('option:checked')).toHaveText(firstTitle);
  await expect(page.locator('.annotation-card')).toHaveCount(1);
  await expect(page.locator('.annotation-card-top')).toContainText(firstTitle);
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await expectBookScope(page, secondTitle, 1);
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await page.getByRole('button', { name: '静读，返回首页', exact: true }).click();
  await page.getByRole('button', { name: `阅读 ${firstTitle}`, exact: true }).click();
  await waitForBook(page);
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await expectBookScope(page, firstTitle, 1);
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await page.getByRole('button', { name: '静读，返回首页', exact: true }).click();
  await page.getByRole('button', { name: '我的笔记', exact: true }).click();
  await expect(page.getByLabel('笔记范围')).toHaveValue('all');
  await expect(page.locator('.annotation-card')).toHaveCount(2);
});

test('本书没有笔记时仍显示真实书名，不混入其它书；书架分类入口也能显示空笔记书名', async ({ page }) => {
  await page.goto('/');
  await importBook(page, 'minimal.epub', firstTitle);
  await mark(page);
  await importBook(page, 'epub2.epub', secondTitle);
  const secondId = await page.locator('.reading-space').getAttribute('data-book-id');
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await expectBookScope(page, secondTitle, 0);
  await expect(page.locator('.notebook-empty')).toBeVisible();
  await page.getByLabel('笔记范围').selectOption('all');
  await expect(page.locator('.annotation-card')).toHaveCount(1);
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await page.getByRole('button', { name: '静读，返回首页', exact: true }).click();
  await page.locator(`.book-card[data-book-id="${secondId}"] .card-notes`).first().click();
  await expectBookScope(page, secondTitle, 0);
});
