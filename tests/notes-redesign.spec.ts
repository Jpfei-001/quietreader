import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { waitForBook, savedCfi, openNotesPage } from './helpers';

async function open(page: Page) {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub'));
  await waitForBook(page);
}
async function select(page: Page, index = 0, trimEnd = 0) {
  const toolbar = page.getByRole('region', { name: '选文工具条' });
  if (await toolbar.isVisible()) { await page.getByRole('button', { name: '关闭选文工具条' }).click(); await expect(toolbar).toHaveCount(0); }
  await page.frameLocator('.reader-viewport iframe').first().locator('p').nth(index).evaluate((p, trimEnd) => {
    const range = p.ownerDocument.createRange();
    range.setStart(p.firstChild!, 0); range.setEnd(p.lastChild!, p.lastChild!.textContent!.length - trimEnd);
    const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  }, trimEnd);
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible();
}

test('专注阅读保留书名作者，隐藏工具入口，不改变阅读位置', async ({ page }) => {
  await open(page); const cfi = await savedCfi(page);
  await page.getByRole('button', { name: '进入专注模式' }).click();
  await expect(page.locator('.book-title')).toBeVisible(); await expect(page.locator('.book-author')).toBeVisible();
  await expect(page.locator('.book-author')).toHaveText('静读工作室');
  await expect(page.getByRole('button', { name: '笔记', exact: true })).toHaveCount(0);
  expect(await savedCfi(page)).toBe(cfi);
  await page.screenshot({ path: 'docs/images/笔记改版-专注阅读.png', fullPage: true });
  await page.getByRole('button', { name: '显示工具栏' }).click();
  await expect(page.getByRole('button', { name: '笔记', exact: true })).toBeVisible();
});

test('近似同段选文自动复用，悬浮显示合并标签，不再出现重叠选择、书签或更多入口', async ({ page }) => {
  await open(page); await select(page);
  await page.getByRole('button', { name: '实线', exact: true }).click();
  await select(page, 0, 1); await page.getByRole('button', { name: '绿色高亮', exact: true }).click();
  await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '书签', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '更多操作' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭选文工具条' }).click();
  await page.getByRole('button', { name: '打开摘录，思考 0 条' }).click();
  const hover = page.getByRole('region', { name: '思考预览' });
  await expect(hover.locator('.annotation-tags')).toContainText('标注 · 实线');
  await expect(hover.locator('.annotation-tags')).toContainText('高亮 · 绿色');
  const buttons = await hover.locator('.hover-toolbar .note-tag,.hover-toolbar button').evaluateAll(items => items.map(el => ({ y: el.getBoundingClientRect().y, h: el.getBoundingClientRect().height })));
  expect(new Set(buttons.map(b => b.y)).size).toBe(1); expect(new Set(buttons.map(b => b.h)).size).toBe(1);
  const tagsBox = (await hover.locator('.annotation-tags').boundingBox())!, actionsBox = (await hover.locator('.note-actions').boundingBox())!;
  expect(actionsBox.x).toBeGreaterThanOrEqual(tagsBox.x + tagsBox.width);
  const hoverBox = (await hover.boundingBox())!;
  expect(hoverBox.x + hoverBox.width - actionsBox.x - actionsBox.width).toBeLessThan(16);
  await page.screenshot({ path: 'docs/images/布局微调-摘录预览.png', fullPage: true });
  await expect(page.getByRole('dialog', { name: '选择重叠摘录' })).toHaveCount(0);
  await page.keyboard.press('Escape'); await openNotesPage(page);
  await expect(page.locator('.annotation-card')).toHaveCount(1);
  await expect(page.locator('.note-counts')).toContainText('摘录 1');
});

test('历史重复摘录合并为一张卡，统计标签筛选、控件等宽高、内容层级与简洁导出', async ({ page }) => {
  await open(page); await select(page); await page.getByRole('button', { name: '实线', exact: true }).click();
  await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await select(page, 1); await page.getByRole('button', { name: '蓝色高亮', exact: true }).click();
  await expect(page.getByRole('button', { name: '蓝色高亮', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '关闭选文工具条' }).click();
  const internalId = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['annotations', 'thoughts'], 'readwrite'), store = tx.objectStore('annotations');
      const records = store.getAll(); let id = '';
      records.onsuccess = () => {
        const a = records.result.find(a => a.line); id = a.id;
        const rangeCfi = a.locator.rangeCfi.replace(/:(\d+)\)$/, (_: string, end: string) => `:${Number(end) - 1})`);
        const b = { ...a, id: 'legacy-highlight-test', anchorKey: `${a.bookId}|${rangeCfi}`, locator: { ...a.locator, rangeCfi }, quote: { ...a.quote, exact: a.quote.exact.slice(0, -1) }, line: null, highlightColor: 'green', nextThoughtOrdinal: 2 };
        store.put({ ...a, title: '我的备注' }); store.add(b);
        tx.objectStore('thoughts').add({ version: 1, id: 'legacy-thought-test', annotationId: b.id, bookId: b.bookId, ordinal: 1, text: '这是我的思考与备注', createdAt: Date.now(), updatedAt: Date.now(), revision: 1 });
      };
      tx.oncomplete = () => { db.close(); resolve(id); }; tx.onabort = () => reject(tx.error);
    };
  }));
  // Load a persisted historical fixture; native IDB writes do not emit Dexie's live-query notifications.
  await page.reload(); await page.getByRole('button', { name: '阅读 静读 · 给文字留一点空白', exact: true }).click(); await waitForBook(page);
  await expect(page.locator('.annotation-marker')).toHaveCount(2);
  await page.getByRole('button', { name: '打开摘录，思考 1 条' }).click();
  await expect(page.getByRole('region', { name: '思考预览' })).toContainText('这是我的思考与备注');
  await page.getByRole('button', { name: '在笔记中查看', exact: true }).click();
  await expect(page.locator('.annotation-card')).toHaveCount(2);
  const tagged = page.locator('.annotation-card').filter({ hasText: '我的备注' });
  await expect(tagged.locator('.annotation-tags')).toContainText('标注 · 实线');
  await expect(tagged.locator('.annotation-tags')).toContainText('高亮 · 绿色');
  expect(await tagged.evaluate(card => {
    const quote = card.querySelector('.annotation-quote')!, source = card.querySelector('.annotation-source')!;
    return !!(quote.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING) && parseFloat(getComputedStyle(quote).fontSize) > parseFloat(getComputedStyle(source).fontSize);
  })).toBe(true);
  const sizes = await page.locator('.notebook-filters input,.notebook-filters select').evaluateAll(items => items.map(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height })));
  expect(new Set(sizes.map(s => s.w)).size).toBe(1); expect(new Set(sizes.map(s => s.h)).size).toBe(1);
  await expect(page.locator('.note-counts')).not.toContainText('书签');
  await page.locator('.note-counts').getByRole('button', { name: '标注 1', exact: true }).click();
  await expect(page.locator('.annotation-card')).toHaveCount(1);
  await expect(page.getByLabel('笔记分类')).toHaveValue('line');
  await page.locator('.note-counts').getByRole('button', { name: '高亮 2', exact: true }).click();
  await expect(page.locator('.annotation-card')).toHaveCount(2);
  await page.locator('.note-counts').getByRole('button', { name: '思考 1 条', exact: true }).click();
  await expect(page.locator('.annotation-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '删除', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/images/笔记改版-笔记抽屉.png', fullPage: true });
  await page.getByRole('button', { name: '导出此段', exact: true }).click();
  await expect(page.getByLabel('导出格式')).toHaveValue('md');
  await page.getByText('预览笔记内容', { exact: true }).click();
  const preview = page.locator('.export-preview');
  await expect(preview).toContainText('这是我的思考与备注'); await expect(preview).toContainText('我的备注');
  await expect(preview).not.toContainText(internalId); await expect(preview).not.toContainText('epubcfi'); await expect(preview).not.toContainText('legacy-highlight-test');
  await page.screenshot({ path: 'docs/images/笔记改版-导出.png', fullPage: true });
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 MD', exact: true }).click();
  const file = test.info().outputPath('readable-notes.md'); await (await event).saveAs(file); const content = await readFile(file, 'utf8');
  expect(content.match(/^## 静读/gm)).toHaveLength(1); expect(content).toContain('这是我的思考与备注'); expect(content).not.toContain(internalId);
  await page.getByRole('button', { name: '关闭导出笔记' }).click();
  await page.getByRole('button', { name: '删除整条摘录', exact: true }).click(); await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.annotation-card')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('.annotation-card')).toHaveCount(1);
});

test('思考窗口支持拖动和键盘微调，内容和草稿不丢失，窄屏不溢出', async ({ page }) => {
  await open(page); await select(page); await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('拖动时保留的思考内容');
  const editor = page.getByRole('dialog', { name: '写思考', exact: true }), handle = page.getByLabel('移动思考窗口');
  const before = (await editor.boundingBox())!, box = (await editor.locator('.thought-source').boundingBox())!;
  const cdp = await page.context().newCDPSession(page); const x = box.x + 20, y = box.y + 10;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 70, y: y + 90, button: 'left', buttons: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 70, y: y + 90, button: 'left', buttons: 0 }); await cdp.detach();
  await expect.poll(async () => (await editor.boundingBox())!.y).toBeGreaterThan(before.y + 50);
  await expect(page.getByLabel('思考正文')).toHaveValue('拖动时保留的思考内容');
  await handle.focus(); const moved = (await editor.boundingBox())!; await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await editor.boundingBox())!.y).toBeGreaterThan(moved.y);
  await expect(editor.locator('h2')).toHaveCSS('font-size', '16px');
  const stable = (await editor.boundingBox())!;
  await page.getByLabel('思考正文').fill('拖动时保留的思考内容，移动后继续输入也不会跳回原位');
  await expect.poll(async () => Math.abs((await editor.boundingBox())!.y - stable.y)).toBeLessThan(2);
  await page.screenshot({ path: 'docs/images/笔记改版-思考窗口.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  await expect.poll(async () => { const b = (await editor.boundingBox())!; return b.x >= 0 && b.x + b.width <= 320 && b.y >= 0 && b.y + b.height <= 720; }).toBe(true);
  await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await openNotesPage(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
