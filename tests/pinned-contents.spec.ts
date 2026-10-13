import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { savedCfi, waitForBook } from './helpers';

const sample = path.resolve('public/demo/minimal.epub');
const title = '静读 · 给文字留一点空白';
async function open(page: Page) {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(sample);
  await waitForBook(page);
}
async function pin(page: Page) {
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '固定目录', exact: true }).click();
  await expect(page.locator('.contents-dock')).toBeVisible();
  await expect(page.locator('.panel-backdrop')).toHaveCount(0);
}
async function expectSeparated(page: Page, side: 'left' | 'right') {
  const dock = (await page.locator('.contents-dock').boundingBox())!;
  for (const selector of ['.reading-topbar', '.reading-space', '.reader-footer', '.focus-toggle']) {
    const box = (await page.locator(selector).boundingBox())!;
    if (side === 'right') expect(box.x + box.width).toBeLessThanOrEqual(dock.x + 1);
    else expect(box.x).toBeGreaterThanOrEqual(dock.x + dock.width - 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('顶部笔记在目录前，默认进入本书笔记并显示书名，返回保留会话和位置', async ({ page }) => {
  await open(page);
  expect(await page.locator('.toolbar button').allTextContents()).toEqual(['笔记', '目录', '设置']);
  const cfi = await savedCfi(page);
  const iframe = await page.locator('.reader-viewport iframe').first().elementHandle();
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toBeVisible();
  await expect(page.getByLabel('笔记范围')).toHaveValue('book');
  await expect(page.getByLabel('笔记范围').locator('option:checked')).toHaveText(title);
  await expect(page.locator('.reading-space')).toHaveAttribute('inert', '');
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await waitForBook(page);
  expect(await iframe!.evaluate(el => el.isConnected)).toBe(true);
  expect(await savedCfi(page)).toBe(cfi);
});

for (const side of ['left', 'right'] as const) test(`固定目录不遮挡正文，支持章节跳转、翻页、笔记往返及响应式排版（${side}）`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('radio', { name: side === 'left' ? '左侧' : '右侧', exact: true }).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.reading-space')).toHaveAttribute('data-columns', '2');
  await pin(page);
  await expectSeparated(page, side);
  await expect(page.locator('.reading-space')).toHaveAttribute('data-columns', '2');
  await page.getByRole('button', { name: '第二章 · On a Quiet Morning', exact: true }).click();
  await expect(page.locator('.reading-progress small')).toContainText('第 2 / 3 章');
  await expect(page.locator('.chapter-list [aria-current]')).toHaveText('第二章 · On a Quiet Morning');
  await expect(page.locator('.contents-dock')).toBeVisible();
  const cfi = await savedCfi(page);
  await page.locator('.reader-viewport').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => savedCfi(page)).not.toBe(cfi);
  await expect(page.locator('.contents-dock')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.contents-dock')).toBeVisible();

  const beforeNotes = await savedCfi(page);
  const size = await page.locator('.reader-viewport').boundingBox();
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toBeVisible();
  await expect(page.locator('.contents-dock')).toHaveCount(0);
  expect((await page.locator('.reader-viewport').boundingBox())!.width).toBe(size!.width);
  expect((await page.locator('.reader-viewport').boundingBox())!.height).toBe(size!.height);
  await page.getByRole('button', { name: '返回阅读', exact: true }).click();
  await expect(page.locator('.contents-dock')).toBeVisible();
  expect(await savedCfi(page)).toBe(beforeNotes);
  await page.screenshot({ path: `docs/images/定制版-固定目录-${side}.png`, fullPage: true });

  for (const width of [1280, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expectSeparated(page, side);
    await expect(page.locator('.reading-space')).toHaveAttribute('data-columns', '1');
    // iframe 包含整章横向分页，宽度是多页之和；外层 stage 才是当前可见页宽。
    await expect.poll(async () => Math.round((await page.locator('.reader-viewport .epub-container').boundingBox())!.width))
      .toBe(Math.floor((await page.locator('.reader-viewport').boundingBox())!.width));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '进入专注模式', exact: true }).click();
  await expect(page.locator('.contents-dock')).toBeVisible();
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await page.getByRole('button', { name: '取消固定目录', exact: true }).click();
  await expect(page.locator('.contents-dock')).toHaveCount(0);
  await expect(page.locator('.panel-backdrop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.reading-space')).toHaveAttribute('data-columns', '2');
});

test('长目录只滚动列表，章节目录标题一直在最上方', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const zip = await JSZip.loadAsync(await readFile(sample));
  const nav = await zip.file('OEBPS/nav.xhtml')!.async('text');
  zip.file('OEBPS/nav.xhtml', nav.replace('</ol>', `${Array.from({ length: 90 }, (_, i) => `<li><a href="chapter2.xhtml#part-${i}">长目录小节 ${i}</a></li>`).join('')}</ol>`));
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'long-toc.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await waitForBook(page);
  await pin(page);
  const heading = page.locator('.contents-dock .panel-heading');
  const box = await heading.boundingBox();
  const list = page.locator('.contents-dock .chapter-list');
  await list.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByRole('button', { name: '长目录小节 89', exact: true })).toBeInViewport();
  expect(await heading.boundingBox()).toEqual(box);
  await expect(page.getByRole('button', { name: '取消固定目录', exact: true })).toBeInViewport();
  // 在目录内按方向键滚动，不触发正文翻页。
  const cfi = await savedCfi(page);
  await list.focus();
  await page.keyboard.press('ArrowUp');
  expect(await savedCfi(page)).toBe(cfi);
});

test('固定状态跨刷新和跨书保留，关闭和恢复默认解除固定', async ({ page }) => {
  await open(page);
  await pin(page);
  await page.reload();
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page);
  await expect(page.locator('.contents-dock')).toBeVisible();
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/epub2.epub'));
  await waitForBook(page, '静读 · EPUB 2 样书');
  await expect(page.locator('.contents-dock')).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('radio', { name: '右侧', exact: true }).check();
  await page.keyboard.press('Escape');
  await expectSeparated(page, 'right');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await expect(page.locator('.contents-dock')).toHaveCount(0);
  await pin(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认设置', exact: true }).click();
  await expect(page.locator('.contents-dock')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page);
  await expect(page.locator('.contents-dock')).toHaveCount(0);
});

test('从思考编辑器进入顶部笔记，先保存草稿再切换', async ({ page }) => {
  await open(page);
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('进入笔记前保留这份草稿');
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toBeVisible();
  const drafts = await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const open = indexedDB.open('quiet-reader-library');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('annotationDrafts');
      const request = tx.objectStore('annotationDrafts').getAll();
      tx.oncomplete = () => { db.close(); resolve(request.result.map(d => d.text)); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  expect(drafts).toContain('进入笔记前保留这份草稿');
});

test('固定和左右移动目录后，高亮坐标仍贴合正文', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const paragraph = page.frameLocator('.reader-viewport iframe').first().locator('p').first();
  await paragraph.evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await page.getByRole('button', { name: '黄色高亮', exact: true }).click();
  await expect(page.getByRole('button', { name: '黄色高亮', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '关闭选文工具条', exact: true }).click();
  await pin(page);
  for (const side of ['left', 'right'] as const) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('radio', { name: side === 'left' ? '左侧' : '右侧', exact: true }).check();
    await page.keyboard.press('Escape');
    await expect.poll(async () => {
      const frame = (await page.locator('.reader-viewport iframe').first().boundingBox())!;
      const text = await paragraph.evaluate(p => {
        const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
        const box = range.getClientRects()[0];
        return { x: box.x, y: box.y };
      });
      const highlight = await page.locator('.annotation-drawing rect').first().boundingBox();
      return !!highlight && Math.abs(highlight.x - frame.x - text.x) < 1 && Math.abs(highlight.y - frame.y - text.y) < 1;
    }).toBe(true);
  }
});
