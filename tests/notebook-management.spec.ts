import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import type { NotesSnapshot } from '../src/platform/annotationTypes';
import { waitForBook, openNotesPage } from './helpers';

async function open(page: Page) {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub'));
  await waitForBook(page);
}
async function select(page: Page, index = 0) {
  const toolbar = page.getByRole('region', { name: '选文工具条' });
  if (await toolbar.isVisible()) await page.getByRole('button', { name: '关闭选文工具条' }).click();
  await page.frameLocator('.reader-viewport iframe').first().locator('p').nth(index).evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await expect(toolbar).toBeVisible();
}
async function snapshot(page: Page) {
  return page.evaluate(() => new Promise<NotesSnapshot>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['annotations', 'thoughts', 'annotationDrafts'], 'readonly');
      const annotations = tx.objectStore('annotations').getAll(), thoughts = tx.objectStore('thoughts').getAll(), drafts = tx.objectStore('annotationDrafts').getAll();
      tx.oncomplete = () => { db.close(); resolve({ annotations: annotations.result, thoughts: thoughts.result, drafts: drafts.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}
async function oneNote(page: Page) {
  await open(page); await select(page);
  await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('删除后应该可以恢复的思考');
  await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await openNotesPage(page); await expect(page.locator('.annotation-card')).toHaveCount(1);
}
const cardIds = (page: Page) => page.locator('.annotation-card').evaluateAll(cards => cards.map(card => (card as HTMLElement).dataset.annotationId));

test('笔记默认创建时间倒序，追加思考不改变创建顺序，重置与重进页面恢复默认', async ({ page }) => {
  await open(page);
  // 故意不按原书顺序创建，避免排序断言被原书位置碰巧满足。
  for (const index of [2, 0, 1]) {
    await select(page, index); await page.getByRole('button', { name: '实线', exact: true }).click();
    await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  const data = await snapshot(page), newest = [...data.annotations].sort((a, b) => b.createdAt - a.createdAt).map(a => a.id);
  expect(new Set(data.annotations.map(a => a.createdAt)).size).toBe(3);
  await openNotesPage(page);
  await expect(page.getByLabel('笔记排序')).toHaveValue('created');
  await expect.poll(() => cardIds(page)).toEqual(newest);
  const oldest = newest.at(-1)!;
  await page.locator(`.annotation-card[data-annotation-id="${oldest}"]`).getByRole('button', { name: '追加思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('修改旧摘录不能改变创建时间排序');
  await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await expect.poll(() => cardIds(page)).toEqual(newest);
  await page.getByLabel('笔记排序').selectOption('updated');
  await expect.poll(async () => (await cardIds(page))[0]).toBe(oldest);
  await page.getByLabel('笔记排序').selectOption('position');
  await expect(page.locator('.annotation-card').first().locator('.annotation-quote')).toContainText('第 1 段');
  await page.getByRole('button', { name: '重置筛选', exact: true }).click();
  await expect(page.getByLabel('笔记排序')).toHaveValue('created');
  await expect.poll(() => cardIds(page)).toEqual(newest);
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: '我的笔记', exact: true }).click();
  await expect(page.getByLabel('笔记排序')).toHaveValue('created');
  await expect.poll(() => cardIds(page)).toEqual(newest);
});

test('删除确认按钮靠右有间距，取消零副作用，右下角撤销完整恢复摘录思考草稿', async ({ page }) => {
  await oneNote(page);
  await page.getByRole('button', { name: '追加思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('必须一并恢复的本机草稿');
  await page.getByRole('button', { name: '关闭思考', exact: true }).click();
  await expect(page.getByLabel('思考正文')).toHaveCount(0);
  const before = await snapshot(page);
  await page.getByRole('button', { name: '删除整条摘录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除整条摘录', exact: true });
  await expect(dialog).toContainText('1 条思考'); await expect(dialog).toContainText('1 份关联草稿');
  await expect(dialog).toContainText('页面右下角的“撤销”');
  const actions = dialog.locator('.delete-actions');
  await expect(actions).toHaveCSS('justify-content', 'flex-end'); await expect(actions).toHaveCSS('gap', '10px');
  await expect(actions).toHaveCSS('margin-top', '16px');
  await expect(actions.locator('button').first()).toHaveCSS('padding', '6px 14px');
  const bounds = (await dialog.boundingBox())!, last = (await actions.locator('button').last().boundingBox())!;
  expect(Math.abs(bounds.x + bounds.width - last.x - last.width - 25)).toBeLessThan(2);
  await page.screenshot({ path: 'docs/images/笔记优化-删除确认.png', fullPage: true });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  await page.getByRole('button', { name: '删除整条摘录', exact: true }).click();
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.annotation-card')).toHaveCount(0);
  const undo = page.locator('.note-undo'); await expect(undo).toBeVisible();
  await expect(undo.getByRole('button', { name: '撤销', exact: true })).toBeInViewport();
  const toast = (await undo.boundingBox())!, viewport = page.viewportSize()!;
  expect(Math.abs(viewport.width - toast.x - toast.width - 12)).toBeLessThan(1);
  expect(Math.abs(viewport.height - toast.y - toast.height - 20)).toBeLessThan(1);
  await page.screenshot({ path: 'docs/images/笔记优化-删除撤销入口.png', fullPage: true });
  await undo.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.annotation-card')).toHaveCount(1); await expect(undo).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});

for (const boundary of ['超时', '刷新']) test(`撤销在${boundary}后失效，不自动恢复已删除记录`, async ({ page }) => {
  await oneNote(page);
  if (boundary === '超时') await page.clock.install();
  await page.getByRole('button', { name: '删除整条摘录', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.note-undo')).toBeVisible();
  if (boundary === '超时') await page.clock.fastForward(10_001);
  else { await page.reload(); await page.getByRole('button', { name: '我的笔记', exact: true }).click(); }
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toHaveCount(0);
  await expect(page.locator('.annotation-card')).toHaveCount(0);
  expect((await snapshot(page)).annotations).toHaveLength(0);
});

test('单条思考删除与撤销仅影响该条，保留其他思考', async ({ page }) => {
  await oneNote(page);
  await page.getByRole('button', { name: '追加思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('不能被删除的第二条思考');
  await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await page.getByText('展开思考（2）', { exact: true }).click();
  const before = await snapshot(page);
  await page.locator('.thought-entry').first().getByRole('button', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '删除单条思考', exact: true });
  await expect(dialog.locator('.delete-actions')).toHaveCSS('justify-content', 'flex-end');
  await dialog.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.thought-entry')).toHaveCount(1);
  await expect(page.locator('.thought-entry')).toContainText('不能被删除的第二条思考');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.thought-entry')).toHaveCount(2);
  expect((await snapshot(page)).thoughts).toEqual(before.thoughts);
});

for (const width of [1440, 320]) test(`卡片操作栏内外间距缩小，保持靠右且窄屏不溢出（${width}px）`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await oneNote(page);
  const actions = page.locator('.annotation-card .card-actions');
  await expect(actions).toHaveCSS('margin-top', '8px'); await expect(actions).toHaveCSS('padding-top', '6px');
  await expect(actions).toHaveCSS('gap', '4px'); await expect(actions).toHaveCSS('justify-content', 'flex-end');
  await expect(actions.locator('button').first()).toHaveCSS('padding', '4px 6px');
  await expect(actions.locator('button').first()).toHaveCSS('min-height', '28px');
  const card = (await page.locator('.annotation-card').boundingBox())!, buttons = await actions.locator('button').evaluateAll(items => items.map(item => { const r = item.getBoundingClientRect(); return { x: r.x, right: r.right, bottom: r.bottom }; }));
  expect(buttons.every(button => button.x >= card.x && button.right <= card.x + card.width)).toBe(true);
  expect(card.y + card.height - Math.max(...buttons.map(button => button.bottom))).toBeLessThanOrEqual(10);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `docs/images/笔记优化-紧凑操作栏-${width}.png`, fullPage: true });
});
