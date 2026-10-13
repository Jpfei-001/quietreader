import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForBook, openNotesPage } from './helpers';
import type { NotesSnapshot } from '../src/platform/annotationTypes';

async function open(page: Page) {
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page);
}
async function select(page: Page, index = 0) {
  await page.frameLocator('.reader-viewport iframe').first().locator('p').nth(index).evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
}
async function snapshot(page: Page): Promise<NotesSnapshot> {
  return page.evaluate(() => new Promise<NotesSnapshot>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['annotations', 'thoughts', 'annotationDrafts']);
      const a = tx.objectStore('annotations').getAll(), t = tx.objectStore('thoughts').getAll(), d = tx.objectStore('annotationDrafts').getAll();
      tx.oncomplete = () => { db.close(); resolve({ annotations: a.result, thoughts: t.result, drafts: d.result }); }; tx.onerror = () => reject(tx.error);
    };
  }));
}

test('书架三个分类等宽铺满，每个仍能直接进入对应笔记', async ({ page }) => {
  await open(page); await page.getByRole('button', { name: '静读，返回首页' }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const row = page.locator('.book-card .card-note-tags').first(), bounds = (await row.boundingBox())!;
    const buttons = await row.locator('button').evaluateAll(items => items.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, width: el.getBoundingClientRect().width })));
    expect(new Set(buttons.map(b => b.y)).size).toBe(1);
    expect(Math.max(...buttons.map(b => b.width)) - Math.min(...buttons.map(b => b.width))).toBeLessThan(1);
    expect(buttons[0].x).toBeCloseTo(bounds.x, 1); expect(buttons[2].x + buttons[2].width).toBeCloseTo(bounds.x + bounds.width, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'docs/images/阅读优化-书架分类.png', fullPage: true });
  await page.locator('.book-card .card-note-tags button').last().click(); await expect(page.getByLabel('笔记分类')).toHaveValue('thought');
});

test('调整摘录自动打开原书，非模态窗口允许真实鼠标重新选文，保存保留思考和草稿', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page); await select(page);
  await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByLabel('思考正文').fill('重新选择不能丢失的思考'); await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await select(page); await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByLabel('思考正文').fill('重新选择不能丢失的草稿'); await page.getByRole('button', { name: '关闭思考', exact: true }).click();
  await expect(page.getByLabel('思考正文')).toHaveCount(0);
  await openNotesPage(page); const before = await snapshot(page);
  const filter = (await page.getByLabel('搜索笔记').boundingBox())!;
  await page.getByRole('button', { name: '调整摘录', exact: true }).click();
  await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toHaveCount(0); await waitForBook(page);
  const dialog = page.getByRole('dialog', { name: '调整已有摘录', exact: true }); await expect(dialog).toHaveAttribute('aria-modal', 'false'); await expect(page.locator('.notes-modal-backdrop')).toHaveCount(0);
  expect((await page.getByLabel('摘录标题').boundingBox())!.height).toBe(filter.height);
  expect(await dialog.locator('.adjust-styles button').count()).toBe(7);
  const actionY = await dialog.locator('.adjust-actions button').evaluateAll(items => items.map(el => el.getBoundingClientRect().y)); expect(new Set(actionY).size).toBe(1);
  await page.getByLabel('摘录标题').fill('重新选文的标题');
  const paragraph = page.frameLocator('.reader-viewport iframe').first().locator('p').nth(1), box = (await paragraph.boundingBox())!;
  // Native CDP input avoids Playwright's injected HTML-drag timer, blocked by EPUB sandbox/CSP.
  const input = await page.context().newCDPSession(page), start = box.x + 3, end = box.x + Math.min(340, box.width - 5), y = box.y + 8;
  await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start, y });
  await input.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start, y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 12; i++) await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start + (end - start) * i / 12, y, button: 'left', buttons: 1 });
  await input.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end, y, button: 'left', buttons: 0, clickCount: 1 }); await input.detach();
  const selectedText = await paragraph.evaluate(p => p.ownerDocument.defaultView!.getSelection()!.toString()); expect(selectedText.trim().length).toBeGreaterThan(5);
  await expect(dialog.getByText('已重新选文 · 查看摘录')).toBeVisible(); await expect(page.getByRole('dialog', { name: '有未保存修改' })).toHaveCount(0);
  await dialog.getByText('已重新选文 · 查看摘录', { exact: true }).click();
  await expect(dialog.locator('.adjust-preview blockquote')).toHaveText(selectedText);
  await expect(dialog.locator('.adjust-preview')).toHaveCSS('overflow-y', 'visible');
  await page.screenshot({ path: 'docs/images/阅读优化-调整摘录.png', fullPage: true });
  await page.getByRole('button', { name: '保存调整', exact: true }).click(); await expect(dialog).toHaveCount(0);
  const after = await snapshot(page); expect(after.annotations).toHaveLength(1); expect(after.annotations[0].id).toBe(before.annotations[0].id);
  expect(after.annotations[0].quote.exact).toBe(selectedText); expect(after.annotations[0].title).toBe('重新选文的标题'); expect(after.annotations[0].locator.rangeCfi).not.toBe(before.annotations[0].locator.rangeCfi);
  expect(after.thoughts).toEqual(before.thoughts); expect(after.drafts[0].text).toBe(before.drafts[0].text); expect(after.drafts[0].seed.quote.exact).toBe(selectedText);
  await openNotesPage(page); await expect(page.locator('.annotation-quote')).toHaveText(selectedText);
});

test('重新选文的关闭保护按钮区分且靠右，放弃不修改原笔记', async ({ page }) => {
  await open(page); await select(page); await page.getByRole('button', { name: '实线', exact: true }).click();
  await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true'); await openNotesPage(page); const before = await snapshot(page);
  await page.getByRole('button', { name: '调整摘录', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '调整已有摘录' })).toBeVisible(); await select(page, 1);
  await expect(page.getByText('已重新选文 · 查看摘录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭调整已有摘录', exact: true }).click();
  const pending = page.getByRole('dialog', { name: '有未保存修改', exact: true }); await expect(pending).toBeVisible();
  await expect(pending.locator('.pending-actions')).toHaveCSS('justify-content', 'flex-end'); await expect(pending.locator('.pending-actions')).toHaveCSS('gap', '10px');
  const backgrounds = await pending.locator('.pending-actions button').evaluateAll(items => items.map(el => getComputedStyle(el).backgroundColor)); expect(new Set(backgrounds).size).toBe(3);
  await page.screenshot({ path: 'docs/images/阅读优化-未保存保护.png', fullPage: true });
  await pending.getByRole('button', { name: '继续编辑', exact: true }).click(); await expect(page.getByRole('dialog', { name: '调整已有摘录' })).toBeVisible();
  await page.getByRole('button', { name: '关闭调整已有摘录', exact: true }).click(); await pending.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '调整已有摘录' })).toHaveCount(0); expect(await snapshot(page)).toEqual(before);
});

test('所有屏宽专注模式左右对齐且字号不变，正文增高且退出可恢复', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page);
  const headingStyle = () => page.locator('.book-title,.book-author').evaluateAll(items => items.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, size: getComputedStyle(el).fontSize })));
  const padding = () => page.frameLocator('.reader-viewport iframe').first().locator('body').evaluate(el => ({ top: getComputedStyle(el).paddingTop, side: getComputedStyle(el).paddingLeft, font: getComputedStyle(el).fontSize }));
  const before = await headingStyle(), reading = (await page.locator('.reading-space').boundingBox())!, normalPadding = await padding();
  await expect(page.locator('.reading-chapter')).toHaveCSS('text-align', 'right'); await expect(page.locator('.reading-chapter')).toContainText('第一章');
  expect(parseFloat(await page.locator('.reading-chapter').evaluate(el => getComputedStyle(el).fontSize))).toBeLessThan(parseFloat(before[0].size));
  await page.getByRole('button', { name: '进入专注模式' }).click();
  const focusedWide = await headingStyle();
  expect(focusedWide[0].x).toBe(1440 * 0.05); expect(focusedWide[1].x).toBe(1440 * 0.05);
  expect(focusedWide.map(item => item.size)).toEqual(before.map(item => item.size));
  const chapterWide = (await page.locator('.reading-chapter').boundingBox())!;
  expect(chapterWide.x + chapterWide.width).toBeCloseTo(1440 * 0.95, 1);
  await expect.poll(async () => (await page.locator('.reading-space').boundingBox())!.height).toBe(reading.height + 34);
  await expect.poll(async () => (await padding()).top).toBe('6px'); expect((await padding()).font).toBe(normalPadding.font);
  await page.screenshot({ path: 'docs/images/阅读优化-专注模式.png', fullPage: true });
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click(); expect(await headingStyle()).toEqual(before);
  await expect.poll(padding).toEqual(normalPadding); expect((await page.locator('.reading-space').boundingBox())!.height).toBe(reading.height);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 720 }); const narrow = await headingStyle();
    await page.getByRole('button', { name: '进入专注模式' }).click();
    const focused = await headingStyle();
    expect(focused[0].x).toBe(20); expect(focused[1].x).toBe(20);
    expect(focused.map(item => item.size)).toEqual(narrow.map(item => item.size));
    const chapter = (await page.locator('.reading-chapter').boundingBox())!;
    expect(chapter.x + chapter.width).toBeCloseTo(width - 20, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
    expect(await headingStyle()).toEqual(narrow);
  }
});
