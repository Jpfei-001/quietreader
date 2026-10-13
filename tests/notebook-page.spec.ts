import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { waitForBook, openNotesPage, resumeReading, savedCfi } from './helpers';

async function open(page: Page) {
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page);
}
async function select(page: Page, index = 0) {
  if (await page.getByRole('region', { name: '选文工具条' }).isVisible()) await page.getByRole('button', { name: '关闭选文工具条' }).click();
  await page.frameLocator('.reader-viewport iframe').first().locator('p').nth(index).evaluate(p => {
    const r = p.ownerDocument.createRange(); r.setStart(p.firstChild!, 0); r.setEnd(p.lastChild!, p.lastChild!.textContent!.length);
    const s = p.ownerDocument.defaultView!.getSelection()!; s.removeAllRanges(); s.addRange(r);
  });
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible();
}
async function mark(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
}

for (const mode of ['normal', 'focus', 'narrow'] as const) test(`长摘录从预览进入笔记先显示列表总览，正文不穿透，返回位置不变（${mode}）`, async ({ page }) => {
  await page.setViewportSize(mode === 'narrow' ? { width: 390, height: 720 } : { width: 1440, height: 900 });
  const zip = await JSZip.loadAsync(await readFile(path.resolve('public/demo/minimal.epub')));
  const longQuote = '这是一段很长的摘录，用来验证笔记页面不会被正文覆盖，也不会直接滚到卡片底部。'.repeat(120);
  zip.file('OEBPS/chapter0.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>长摘录</title></head><body><h1>长摘录测试</h1><p>这是另一条需要同时显示的笔记。</p><p>${longQuote}</p></body></html>`);
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'long-notes.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await waitForBook(page);
  await select(page, 0); await mark(page, '实线');
  await select(page, 1); await mark(page, '波浪线');
  for (let i = 1; i <= 6; i++) {
    if (i > 1) await select(page, 1);
    await page.getByRole('button', { name: '思考', exact: true }).click();
    await page.getByLabel('思考正文').fill(`长摘录的第 ${i} 条思考`);
    await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  }
  if (mode === 'focus') await page.getByRole('button', { name: '进入专注模式' }).click();
  const cfi = await savedCfi(page), readerSize = await page.locator('.reader-viewport').boundingBox();
  const frame = await page.locator('.reader-viewport iframe').first().elementHandle();
  await page.getByRole('button', { name: '打开摘录，思考 6 条', exact: true }).click();
  await expect(page.getByRole('region', { name: '思考预览' }).locator('.thought-entry')).toHaveCount(5);
  await page.getByRole('button', { name: '在笔记中查看', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的笔记', exact: true })).toBeInViewport();
  await expect(page.getByLabel('笔记范围')).toBeInViewport();
  await expect(page.getByLabel('笔记范围')).toHaveValue('book');
  await expect(page.getByLabel('笔记分类')).toHaveValue('all');
  await expect(page.getByLabel('章节筛选')).toHaveValue('');
  await expect(page.locator('.annotation-card')).toHaveCount(2);
  const card = page.locator('.annotation-card').filter({ hasText: longQuote });
  await expect(card.locator('details')).toHaveAttribute('open', '');
  await expect(card.locator('.thought-entry')).toHaveCount(6);
  await expect(page.locator('.thought-hover,.annotation-marker')).toHaveCount(0);
  await expect(page.locator('.annotation-drawing')).toBeHidden();
  await expect(page.locator('.reading-space')).toHaveAttribute('inert', '');
  await expect(page.locator('.reading-space')).toHaveCSS('opacity', '0');
  // epub.js explicitly sets visibility:visible on its view and iframe. It must still be clipped.
  expect(await page.locator('.reader-viewport iframe').first().evaluate(el => getComputedStyle(el).visibility)).toBe('visible');
  expect((await page.locator('.reader-viewport').boundingBox())?.height).toBe(readerSize?.height);
  expect(await savedCfi(page)).toBe(cfi);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.locator('.reading-space').evaluate(el => {
    const box = el.getBoundingClientRect();
    return !document.elementsFromPoint(box.x + 10, box.y + 10).some(item => el.contains(item));
  })).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await expect(page.locator('.reading-space')).toHaveCSS('opacity', '1');
  await expect(page.locator('.reader-viewport iframe').first()).toBeVisible();
  expect(await frame!.evaluate(el => el.isConnected)).toBe(true);
  expect(await savedCfi(page)).toBe(cfi);
});

test('首页我的笔记直接进入独立页面，空列表也不经过归档壳或抽屉', async ({ page }) => {
  await page.goto('/');
  const shelfHeading = await page.locator('.library-heading h1').evaluate(el => ({ font: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight, x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y }));
  await expect(page.locator('.library-nav')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '我的笔记', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: '我的笔记', exact: true }).click();
  expect(await page.locator('.library-heading h1').evaluate(el => ({ font: getComputedStyle(el).fontFamily, size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight, x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y }))).toEqual(shelfHeading);
  await expect(page.getByRole('button', { name: '我的笔记', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '我的书架', exact: true })).toHaveCount(0);
  const notebook = page.getByRole('main', { name: '我的笔记', exact: true });
  await expect(notebook).toBeVisible(); await expect(page.getByRole('heading', { name: '我的笔记', exact: true })).toBeVisible();
  await expect(page.getByLabel('笔记范围')).toHaveValue('all');
  await expect(page.locator('.notes-modal-backdrop')).toHaveCount(0); await expect(page.locator('.archive-shell')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /全部 \/ 归档笔记/ })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '原书未载入' })).toHaveCount(0);
  await page.getByRole('button', { name: '返回书架', exact: true }).click(); await expect(page.locator('.library-page')).toBeVisible();
});

test('书架标记、高亮和思考独立统计，一次点击直达该书对应分类，且不打开原书', async ({ page }) => {
  await open(page); await select(page); await mark(page, '实线');
  await select(page, 1); await mark(page, '绿色高亮');
  await select(page, 2); await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('第三段自己的思考'); await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await expect(page.getByRole('button', { name: '笔记', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await page.screenshot({ path: 'docs/images/笔记页面-书架入口.png', fullPage: true });
  for (const [category, label, count] of [['line', '标记', 2], ['highlight', '高亮', 1], ['thought', '思考', 1]] as const) {
    const card = page.locator('.book-card').first(); await expect(card.locator('.card-note-tags')).not.toContainText('书签');
    await card.getByRole('button', { name: `静读 · 给文字留一点空白的${label}笔记 ${count}`, exact: true }).click();
    await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toBeVisible();
    await expect(page.getByLabel('笔记分类')).toHaveValue(category); await expect(page.getByLabel('笔记范围')).toHaveValue('book');
    await expect(page.locator('.annotation-card')).toHaveCount(count); await expect(page.locator('.reader-viewport iframe')).toHaveCount(0);
    await page.getByRole('button', { name: '返回书架', exact: true }).click();
  }
  await page.getByRole('button', { name: '我的笔记', exact: true }).click();
  await expect(page.getByLabel('笔记范围')).toHaveValue('all'); await expect(page.locator('.annotation-card')).toHaveCount(3);
});

test('标签与导出同排、配色分组，筛选控件更紧凑；窄屏和长笔记页面不溢出', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page); await select(page); await mark(page, '波浪线'); await mark(page, '蓝色高亮');
  await openNotesPage(page);
  const tags = (await page.locator('.note-counts').boundingBox())!, actions = (await page.locator('.notebook-transfer').boundingBox())!;
  expect(Math.abs(tags.y - actions.y)).toBeLessThan(3); expect(actions.x).toBeGreaterThan(tags.x + tags.width);
  const sizes = await page.locator('.notebook-filters input,.notebook-filters select').evaluateAll(controls => controls.map(el => ({ h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width, padding: parseFloat(getComputedStyle(el).paddingTop) })));
  expect(sizes.every(s => s.h <= 32 && s.padding <= 4)).toBe(true); expect(new Set(sizes.map(s => s.w)).size).toBe(1);
  const card = page.locator('.annotation-card').first(), top = card.locator('.annotation-card-top');
  const title = (await top.locator('label').boundingBox())!, cardTags = (await top.locator('.annotation-tags').boundingBox())!;
  expect(Math.abs(title.y + title.height / 2 - cardTags.y - cardTags.height / 2)).toBeLessThan(3);
  expect(cardTags.x).toBeGreaterThanOrEqual(title.x + title.width);
  const cardBounds = (await card.boundingBox())!, lastAction = (await card.locator('.card-actions button').last().boundingBox())!;
  expect(cardBounds.x + cardBounds.width - lastAction.x - lastAction.width).toBeLessThan(22);
  const tagBackground = await page.locator('.tag-line').first().evaluate(el => getComputedStyle(el).backgroundColor);
  expect(await page.locator('.notebook-transfer button').first().evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(tagBackground);
  await page.screenshot({ path: 'docs/images/笔记页面-独立页面.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/images/笔记页面-窄屏.png', fullPage: true });
});

test('取消最后一个标注或高亮后摘录消失，重新标记自动恢复；仍有思考的摘录保留', async ({ page }) => {
  await open(page); await select(page); await mark(page, '实线'); await mark(page, '绿色高亮');
  await page.getByRole('button', { name: '实线', exact: true }).click(); await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await openNotesPage(page); await expect(page.locator('.annotation-card')).toHaveCount(1); await expect(page.locator('.note-counts')).toContainText('标注 0');
  await resumeReading(page); await select(page); await page.getByRole('button', { name: '绿色高亮', exact: true }).click();
  await expect(page.getByRole('button', { name: '绿色高亮', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await openNotesPage(page); await expect(page.locator('.annotation-card')).toHaveCount(0); await expect(page.locator('.note-counts')).toContainText('摘录 0');
  await resumeReading(page); await select(page); await mark(page, '虚线');
  await openNotesPage(page); await expect(page.locator('.annotation-card')).toHaveCount(1); await expect(page.locator('.note-counts')).toContainText('标注 1');
  await page.getByRole('button', { name: '追加思考', exact: true }).click(); await page.getByLabel('思考正文').fill('取消标注后这条思考仍需保留'); await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '调整摘录', exact: true }).click(); await page.getByRole('button', { name: '虚线', exact: true }).click(); await page.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '调整已有摘录' })).toHaveCount(0); await openNotesPage(page);
  await expect(page.locator('.annotation-card')).toHaveCount(1); await expect(page.locator('.note-counts')).toContainText('标注 0'); await expect(page.locator('.note-counts')).toContainText('思考 1 条');
  await page.getByText('展开思考（1）', { exact: true }).click(); await expect(page.locator('.thought-entry')).toContainText('取消标注后这条思考仍需保留');
});

test('没有思考时在笔记中取消全部样式后实时从列表与导出选择中移除', async ({ page }) => {
  await open(page); await select(page); await mark(page, '实线'); await mark(page, '蓝色高亮'); await openNotesPage(page);
  await page.locator('.annotation-card input[type=checkbox]').check(); await expect(page.getByRole('button', { name: '导出选中 1 段' })).toBeEnabled();
  await page.getByRole('button', { name: '调整摘录', exact: true }).click();
  await page.getByRole('button', { name: '实线', exact: true }).click(); await page.getByRole('button', { name: '蓝色高亮', exact: true }).click(); await page.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '调整已有摘录' })).toHaveCount(0); await openNotesPage(page);
  await expect(page.locator('.annotation-card')).toHaveCount(0); await expect(page.getByRole('button', { name: '导出选中 0 段' })).toBeDisabled();
  await expect(page.locator('.note-counts')).toContainText('摘录 0');
});
