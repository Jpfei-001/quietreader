import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { waitForBook, openNotesPage, resumeReading } from './helpers';
async function open(page: Page) { await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page); }
async function select(page: Page, index = 0) {
  if (await page.getByRole('main', { name: '我的笔记', exact: true }).isVisible()) await resumeReading(page);
  await page.frameLocator('.reader-viewport iframe').first().locator('p').nth(index).evaluate(p => { const r = p.ownerDocument.createRange(); r.selectNodeContents(p); const s = p.ownerDocument.defaultView!.getSelection()!; s.removeAllRanges(); s.addRange(r); });
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible();
}
test('leaving the reader keeps the draft and allows opening the notes page without a confirmation', async ({ page }) => {
  await open(page); await select(page); await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByLabel('思考正文').fill('未保存的思考');
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await expect(page.getByLabel('思考正文')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '有未保存修改' })).toHaveCount(0);
  await openNotesPage(page);
  await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toBeVisible();
  await expect(page.getByLabel('思考正文')).toHaveCount(0);
});
test('recover, keep, reload, recover again and save clears all source drafts', async ({ page }) => {
  await open(page); await select(page); await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByLabel('思考正文').fill('原始草稿'); await page.getByRole('button', { name: '关闭思考', exact: true }).click();
  await expect(page.getByLabel('思考正文')).toHaveCount(0);
  for (let i = 0; i < 2; i++) {
    await select(page); await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByRole('button', { name: '恢复这份草稿', exact: true }).click();
    await page.getByLabel('思考正文').fill(`第${i + 1}次恢复`);
    await page.getByRole('button', { name: i ? '保存并收起' : '关闭思考', exact: true }).click();
    await expect(page.getByLabel('思考正文')).toHaveCount(0);
    if (!i) { await page.reload(); await page.getByRole('button', { name: '阅读 静读 · 给文字留一点空白', exact: true }).click(); await waitForBook(page); }
  }
  await page.getByRole('button', { name: '保存并收起', exact: true }).waitFor({ state: 'detached' });
  await expect(page.getByRole('button', { name: /份本机草稿/ })).toHaveCount(0);
  await openNotesPage(page); await expect(page.locator('.note-counts')).toContainText('思考 1 条');
});
test('adjust dialog freezes original revision and rejects another-window replacement', async ({ page, context }) => {
  await open(page); await select(page); await page.getByRole('button', { name: '实线', exact: true }).click(); await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openNotesPage(page);
  await page.getByRole('button', { name: '调整摘录', exact: true }).click();
  await page.getByLabel('摘录标题').fill('原记录备注');
  const other = await context.newPage(); await other.goto('/');
  await other.evaluate(() => new Promise<void>((resolve, reject) => { const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('annotations', 'readwrite'); const store = tx.objectStore('annotations'); const get = store.getAll(); get.onsuccess = () => { const a = get.result[0]; store.delete(a.id); store.add({ ...a, id: 'replacement-from-other-window' }); }; tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); }; }));
  await page.getByRole('button', { name: '保存调整', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('另一窗口'); await expect(page.getByRole('dialog', { name: '调整已有摘录' })).toBeVisible();
  await expect(page.getByLabel('摘录标题')).toHaveValue('原记录备注');
});
test('adjust thought link focuses and expands the chosen excerpt rather than a generic list', async ({ page }) => {
  await open(page);
  for (let i = 0; i < 2; i++) { await select(page, i); await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByLabel('思考正文').fill(`第${i}段的思考`); await page.getByRole('button', { name: '保存并收起', exact: true }).click(); }
  await openNotesPage(page);
  await page.locator('.annotation-card').filter({ hasText: '第1段的思考' }).getByRole('button', { name: '调整摘录', exact: true }).click(); await page.getByRole('button', { name: '查看 / 逐条编辑思考', exact: true }).click();
  const card = page.locator('.annotation-card').filter({ has: page.getByText('第1段的思考', { exact: true }) });
  await expect(card).toBeFocused(); await expect(card.locator('details')).toHaveAttribute('open', '');
});
test('real EPUB hard line breaks and long headings survive snapshot and JSON roundtrip', async ({ page }) => {
  const zip = await JSZip.loadAsync(await readFile(path.resolve('public/demo/minimal.epub')));
  const heading = '长标题'.repeat(400);
  zip.file('OEBPS/chapter0.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>换行</title></head><body><h1>${heading}</h1><p>首行<br/>次行<br/>第三行</p></body></html>`);
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'hard-break.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) }); await waitForBook(page);
  // Navigate to the text after the long heading rather than assuming it fits the first page.
  await page.frameLocator('.reader-viewport iframe').first().locator('p').evaluate(p => { p.scrollIntoView(); });
  await select(page); await page.getByRole('button', { name: '实线', exact: true }).click(); await openNotesPage(page);
  await expect(page.locator('.annotation-card blockquote')).toHaveText('首行\n次行\n第三行');
  await page.getByRole('button', { name: '导出此段', exact: true }).click(); await page.getByLabel('导出格式').selectOption('json'); const event = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 JSON', exact: true }).click(); const file = test.info().outputPath('hard-break.json'); await (await event).saveAs(file);
  const backup = JSON.parse(await readFile(file, 'utf8')); expect(backup.annotations[0].source.headingPath).toEqual([heading]);
  await page.getByRole('button', { name: '关闭导出笔记' }).click(); await page.getByRole('button', { name: '导入 JSON 备份' }).click(); await page.getByLabel('选择笔记 JSON 备份').setInputFiles(file); await expect(page.getByRole('button', { name: '确认恢复' })).toBeEnabled(); await page.getByRole('button', { name: '确认恢复' }).click();
  await page.getByRole('button', { name: '回到原文', exact: true }).click(); await expect(page.getByRole('alert')).toHaveCount(0);
});
for (const whole of [false, true]) test(`delete ${whole ? 'excerpt' : 'thought'} refreshes changed draft count and requires reconfirmation`, async ({ page, context }) => {
  await open(page); await select(page); await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByLabel('思考正文').fill('正式内容'); await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await openNotesPage(page);
  if (!whole) await page.getByText('展开思考（1）', { exact: true }).click();
  await page.getByRole('button', { name: whole ? '删除整条摘录' : '删除', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: whole ? '删除整条摘录' : '删除单条思考', exact: true }); await expect(dialog).toContainText('0 份关联草稿');
  const other = await context.newPage(); await other.goto('/');
  await other.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error); request.onsuccess = () => {
      const db = request.result; const tx = db.transaction(['annotations', 'thoughts', 'annotationDrafts'], 'readwrite');
      const ar = tx.objectStore('annotations').getAll(), tr = tx.objectStore('thoughts').getAll();
      tr.onsuccess = () => { const a = ar.result[0], t = tr.result[0]; tx.objectStore('annotationDrafts').add({ version: 1, id: 'concurrent-draft', revision: 1, sessionId: 'other-window', seed: a, annotationId: a.id, thoughtId: t.id, baseRevision: t.revision, mode: 'edit', text: '另一窗口的新草稿', updatedAt: Date.now() }); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  }));
  await page.getByRole('button', { name: '确认删除', exact: true }).click(); await expect(dialog).toBeVisible(); await expect(dialog).toContainText('1 份关联草稿'); await expect(page.getByRole('alert')).toContainText('数量已变化');
  await page.getByRole('button', { name: '确认删除', exact: true }).click(); await expect(dialog).toHaveCount(0); await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('.note-counts')).toContainText('思考 1 条');
});
test('floating toolbar and editor fit the actual zoomed visual viewport', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); const page = await context.newPage();
  try {
    await open(page); await select(page); const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
    await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBe(2);
    const fits = (selector: string) => page.locator(selector).evaluate(el => { const b = el.getBoundingClientRect(), v = window.visualViewport!; return { width: b.width, available: v.width - 24, left: b.left, right: b.right, min: v.offsetLeft, max: v.offsetLeft + v.width }; });
    await expect.poll(async () => { const b = await fits('.selection-toolbar'); return b.width <= b.available + 1 && b.left >= b.min && b.right <= b.max + 1; }).toBe(true);
    // Pinch/zoom changes visible bounds, not the layout viewport or selection snapshot.
    await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByLabel('思考正文').fill('缩放后的内容');
    await expect.poll(async () => { const b = await fits('.thought-editor'); return b.width <= b.available + 1 && b.left >= b.min && b.right <= b.max + 1; }).toBe(true);
    await page.getByRole('button', { name: '关闭思考', exact: true }).click(); await expect(page.getByLabel('思考正文')).toHaveCount(0); await cdp.detach();
  } finally { await context.close(); }
});
