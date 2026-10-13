import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { waitForBook, openNotesPage } from './helpers';

async function open(page: Page) {
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub'));
  await waitForBook(page);
}
async function select(page: Page) {
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible();
}
async function draftChoice(page: Page) {
  await open(page); await select(page); await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('测试草稿\n继续阅读时记录的问题。'); await page.keyboard.press('Escape');
  await expect(page.getByLabel('思考正文')).toHaveCount(0);
  await select(page); await page.getByRole('button', { name: '思考', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '已有本机草稿', exact: true })).toBeVisible();
}
async function draftTexts(page: Page) {
  return page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('annotationDrafts', 'readonly');
      const read = tx.objectStore('annotationDrafts').getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result.map(draft => draft.text)); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

test('草稿弹框主次明确、按钮同排靠右，丢弃使用页内确认，取消与Esc不删除', async ({ page }) => {
  await draftChoice(page);
  const choice = page.getByRole('dialog', { name: '已有本机草稿', exact: true });
  await expect(choice.locator('.delete-actions')).toHaveCSS('justify-content', 'flex-end');
  await expect(choice.getByRole('button', { name: '恢复这份草稿' })).toHaveClass('button-primary');
  await expect(choice.getByRole('button', { name: '丢弃这份草稿' })).toHaveClass('button-danger');
  const buttons = await choice.locator('.delete-actions button').evaluateAll(items => items.map(el => ({ y: el.getBoundingClientRect().y, h: el.getBoundingClientRect().height })));
  expect(buttons).toHaveLength(3); expect(new Set(buttons.map(b => b.y)).size).toBe(1); expect(new Set(buttons.map(b => b.h)).size).toBe(1);
  await page.screenshot({ path: test.info().outputPath('已有草稿.png'), fullPage: true });
  const before = await draftTexts(page);
  await choice.getByRole('button', { name: '丢弃这份草稿' }).click();
  const confirmation = page.getByRole('dialog', { name: '丢弃这份草稿', exact: true });
  await expect(choice).toHaveCount(0); await expect(confirmation).toContainText('正式思考');
  await expect(confirmation.locator('.delete-actions')).toHaveCSS('justify-content', 'flex-end');
  await confirmation.getByRole('button', { name: '取消', exact: true }).click(); await expect(choice).toBeVisible();
  expect(await draftTexts(page)).toEqual(before);
  await choice.getByRole('button', { name: '丢弃这份草稿' }).click(); await page.keyboard.press('Escape');
  await expect(choice).toBeVisible(); expect(await draftTexts(page)).toEqual(before);
  await choice.getByRole('button', { name: '恢复这份草稿' }).click();
  await expect(page.getByLabel('思考正文')).toHaveValue(before[0]);
});

test('另起思考不覆盖旧草稿，确认丢弃只删除指定草稿，多份列表仍可恢复', async ({ page }) => {
  await draftChoice(page);
  await page.getByRole('button', { name: '另起一条思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('第二份草稿'); await page.keyboard.press('Escape');
  await expect(page.getByLabel('思考正文')).toHaveCount(0);
  expect(await draftTexts(page)).toHaveLength(2);
  await select(page); await page.getByRole('button', { name: '思考', exact: true }).click();
  const choice = page.getByRole('dialog', { name: '已有本机草稿', exact: true });
  await expect(choice.locator('.draft-choice-card')).toHaveCount(2);
  await choice.locator('.draft-choice-card').filter({ hasText: '第二份草稿' }).getByRole('button', { name: '丢弃这份草稿' }).click();
  await page.getByRole('button', { name: '确认丢弃', exact: true }).click();
  await expect(choice.locator('.draft-choice-card')).toHaveCount(1);
  expect(await draftTexts(page)).toEqual(['测试草稿\n继续阅读时记录的问题。']);
  await choice.getByRole('button', { name: '恢复这份草稿' }).click();
  await expect(page.getByLabel('思考正文')).toHaveValue('测试草稿\n继续阅读时记录的问题。');
});

test('丢弃草稿写入失败保持确认框，支持重试', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { failDiscard: boolean }; const remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(key) {
      if (this.name === 'annotationDrafts' && state.failDiscard) throw new DOMException('删除失败', 'UnknownError');
      return remove.call(this, key);
    };
  });
  await draftChoice(page);
  await page.getByRole('button', { name: '丢弃这份草稿' }).click();
  await page.evaluate(() => { (window as unknown as { failDiscard: boolean }).failDiscard = true; });
  await page.getByRole('button', { name: '确认丢弃' }).click();
  const confirmation = page.getByRole('dialog', { name: '丢弃这份草稿', exact: true });
  await expect(confirmation.getByRole('alert')).toBeVisible(); expect(await draftTexts(page)).toHaveLength(1);
  await page.evaluate(() => { (window as unknown as { failDiscard: boolean }).failDiscard = false; });
  await confirmation.getByRole('button', { name: '确认丢弃' }).click();
  await expect(confirmation).toHaveCount(0); await expect(page.getByRole('dialog', { name: '已有本机草稿' })).toHaveCount(0);
  expect(await draftTexts(page)).toHaveLength(0);
});

for (const width of [1440, 800, 390, 320]) test(`摘录调整窗口加宽，工具条随宽度布局并保持线色右对齐，窄屏不越界（${width}px）`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await open(page); await select(page);
  await page.getByRole('button', { name: '实线', exact: true }).click();
  await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openNotesPage(page); await page.getByRole('button', { name: '调整摘录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整已有摘录', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(async () => (await dialog.boundingBox())!.width).toBe(Math.min(560, width - 24));
  expect(await dialog.locator('.adjust-styles').evaluate(row => row.scrollWidth <= row.clientWidth + 1)).toBe(true);
  for (const button of await dialog.locator('.adjust-styles button').all()) {
    const b = (await button.boundingBox())!, pane = (await dialog.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(pane.x); expect(b.x + b.width).toBeLessThanOrEqual(pane.x + pane.width);
  }
  if (width >= 800) {
    await expect.poll(async () => {
      const b = (await dialog.boundingBox())!, color = (await page.getByLabel('划线颜色').boundingBox())!;
      return b.x + b.width - color.x - color.width;
    }).toBeLessThan(15);
    const title = (await page.getByLabel('摘录标题').boundingBox())!, color = (await page.getByLabel('划线颜色').boundingBox())!;
    expect(Math.abs(title.x + title.width - color.x - color.width)).toBeLessThan(2);
  }
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
  for (const button of await dialog.locator('.adjust-actions button').all()) {
    const b = (await button.boundingBox())!; expect(b.x).toBeGreaterThanOrEqual(box.x); expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
  }
  await page.getByLabel('划线颜色').fill('#123456'); await page.getByLabel('摘录标题').fill('紧凑窗口中的自拟标题');
  await page.screenshot({ path: test.info().outputPath(`调整摘录-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(dialog).toHaveCount(0); await openNotesPage(page);
  await expect(page.locator('.annotation-card')).toContainText('紧凑窗口中的自拟标题');
});

async function openExcerptPreview(page: Page, excerpt: string) {
  const zip = await JSZip.loadAsync(await readFile(path.resolve('public/demo/minimal.epub')));
  zip.file('OEBPS/chapter0.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>完整摘录</title></head><body><h1>第一章 · 完整摘录</h1><p>${excerpt}</p></body></html>`);
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'excerpt-preview.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await waitForBook(page); await select(page);
  await page.getByRole('button', { name: '实线', exact: true }).click();
  await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openNotesPage(page); await page.getByRole('button', { name: '调整摘录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整已有摘录', exact: true });
  await dialog.getByText('查看当前摘录', { exact: true }).click();
  return dialog;
}

test('查看当前摘录完整展开，超过原120px限制也没有预览区滚动条', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const excerpt = '数字化之后仍需完整保留这一段摘录，最后一句也必须显示。'.repeat(12);
  const dialog = await openExcerptPreview(page, excerpt), preview = dialog.locator('.adjust-preview');
  await expect(preview.locator('blockquote')).toHaveText(excerpt);
  await expect(preview).toHaveCSS('max-height', 'none'); await expect(preview).toHaveCSS('overflow-y', 'visible');
  expect((await preview.boundingBox())!.height).toBeGreaterThan(120);
  expect(await preview.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  const b = (await dialog.boundingBox())!; expect(b.y + b.height).toBeLessThanOrEqual(900);
  await expect(dialog.getByRole('button', { name: '保存调整', exact: true })).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('完整展开摘录.png'), fullPage: true });
});

for (const width of [1440, 320]) test(`超长摘录不裁切，只由整个弹框滚动，末尾与保存均可访问（${width}px）`, async ({ page }) => {
  await page.setViewportSize({ width, height: 720 });
  const excerpt = '完整记录这一段长摘录，不以固定的小滚动区域截断内容。'.repeat(120) + '这里是摘录最后一句。';
  const dialog = await openExcerptPreview(page, excerpt), preview = dialog.locator('.adjust-preview');
  await expect(preview.locator('blockquote')).toHaveText(excerpt);
  expect(await preview.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  expect(await dialog.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const box = (await dialog.boundingBox())!; expect(box.y + box.height).toBeLessThanOrEqual(720);
  const save = dialog.getByRole('button', { name: '保存调整', exact: true });
  await save.scrollIntoViewIfNeeded(); await expect(save).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath(`长摘录-${width}.png`), fullPage: true });
  await save.click(); await expect(dialog).toHaveCount(0); await openNotesPage(page);
  await expect(page.locator('.annotation-quote')).toHaveText(excerpt);
});

test('触屏工具条色板展开后按可用宽度换行，不出现横向滚动或挤掉线色', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 320, height: 720 } });
  try {
    const page = await context.newPage(); await open(page); await select(page);
    await page.getByRole('button', { name: '实线', exact: true }).click();
    await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await openNotesPage(page); await page.getByRole('button', { name: '调整摘录', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '调整已有摘录', exact: true });
    await dialog.getByRole('button', { name: '展开高亮色板' }).click();
    const row = dialog.locator('.adjust-styles');
    expect(await row.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const box = (await dialog.boundingBox())!;
    for (const button of await row.getByRole('button').all()) {
      const b = (await button.boundingBox())!; expect(b.x).toBeGreaterThanOrEqual(box.x); expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByLabel('划线颜色')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('工具条色板展开-320.png'), fullPage: true });
    await dialog.getByRole('button', { name: '蓝色高亮选项', exact: true }).click();
    await expect(dialog.getByRole('button', { name: '蓝色高亮', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: test.info().outputPath('工具条自适应-320.png'), fullPage: true });
  } finally { await context.close(); }
});

test('触屏草稿弹框长内容与按钮可见，44px点击面积且无横向溢出', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 320, height: 720 } });
  try {
    const page = await context.newPage(); await draftChoice(page);
    const dialog = page.getByRole('dialog', { name: '已有本机草稿' });
    for (const button of await dialog.locator('.delete-actions button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('草稿触屏-320.png'), fullPage: true });
  } finally { await context.close(); }
});
