import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForBook, savedCfi, openNotesPage, resumeReading } from './helpers';

async function open(page: Page) {
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub'));
  await waitForBook(page);
}
async function select(page: Page, index = 0) {
  const toolbar = page.getByRole('region', { name: '选文工具条' });
  if (await toolbar.isVisible()) await page.getByRole('button', { name: '关闭选文工具条' }).click();
  await page.frameLocator('.reader-viewport iframe').first().locator('p').nth(index).evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const s = p.ownerDocument.defaultView!.getSelection()!; s.removeAllRanges(); s.addRange(range);
  });
  await expect(toolbar).toBeVisible();
}
async function makeThought(page: Page, index: number, text: string) {
  await select(page, index); await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.getByLabel('思考正文').fill(text); await page.getByRole('button', { name: '保存并收起', exact: true }).click();
}

for (const width of [1440, 2400]) test(`章节在按钮左侧且右对齐、目录设置同排，专注模式左右对齐且退出恢复（${width}px）`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await open(page);
  const chapter = page.locator('.reading-chapter');
  await expect(chapter).toHaveCSS('font-size', '18px');
  const heading = () => page.locator('.book-title,.book-author').evaluateAll(items => items.map(el => ({ x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y })));
  const before = await heading();
  for (const focus of [false, true]) {
    if (focus) await page.getByRole('button', { name: '进入专注模式' }).click();
    await expect(chapter).toHaveCSS('text-align', 'right');
    if (!focus) {
      const title = (await chapter.boundingBox())!, actions = (await page.locator('.topbar .toolbar').boundingBox())!;
      expect(Math.abs(actions.y + actions.height / 2 - title.y - title.height / 2)).toBeLessThan(1);
      expect(title.x + title.width).toBeLessThanOrEqual(actions.x);
      expect(Math.abs(actions.x + actions.width - width * 0.95)).toBeLessThan(1);
    }
    if (focus) {
      const focused = await heading();
      expect(focused[0].x).toBeCloseTo(width * 0.05, 1);
      expect(focused[1].x).toBeCloseTo(width * 0.05, 1);
      const chapterBounds = (await chapter.boundingBox())!;
      expect(chapterBounds.x + chapterBounds.width).toBeCloseTo(width * 0.95, 1);
    } else expect(await heading()).toEqual(before);
    await page.screenshot({ path: test.info().outputPath(`章节布局-${focus ? '专注' : '普通'}.png`), fullPage: true });
    if (width === 1440 && !focus) await page.screenshot({ path: 'docs/images/阅读交互-章节与按钮同排.png', fullPage: true });
  }
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  expect(await heading()).toEqual(before);
});

for (const width of [800, 390]) test(`非宽屏章节使用流式布局，不强行对齐正文边界（${width}px）`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await open(page);
  await expect(page.locator('.reading-chapter')).toHaveCSS('position', 'static');
  await expect(page.locator('.reading-chapter')).toHaveCSS('font-size', width <= 480 ? '12px' : width <= 680 ? '14px' : '16px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('长章节标题单行省略且无滚动条，不挤压书名、按钮或正文', async ({ page }) => {
  await open(page);
  const title = '很长的章节标题：供给侧改革、宏观经济与阅读记录'.repeat(4), chapter = page.locator('.reading-chapter');
  const neighbours = () => page.locator('.book-heading h1,.topbar .toolbar,.reading-space').evaluateAll(items => items.map(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
  }));
  for (const width of [2400, 1440, 1099, 1000, 800, 680, 600, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(chapter).toHaveCSS('font-size', width <= 480 ? '12px' : width <= 680 ? '14px' : width >= 1100 ? '18px' : '16px');
    await expect.poll(() => page.locator('.reading-topbar').evaluate(el =>
      Math.abs(parseFloat(getComputedStyle(el.parentElement!).getPropertyValue('--reader-header-height')) - el.getBoundingClientRect().height)
    )).toBeLessThan(1);
    await chapter.evaluate(el => { el.textContent = '第一章'; });
    const before = await neighbours();
    await chapter.evaluate((el, text) => { el.textContent = text; el.setAttribute('title', text); }, title);
    await expect(chapter).toHaveText(title); await expect(chapter).toHaveAttribute('title', title);
    await expect(chapter).toHaveCSS('text-align', 'right');
    await expect(chapter).toHaveCSS('white-space', 'nowrap');
    await expect(chapter).toHaveCSS('overflow-x', 'hidden');
    await expect(chapter).toHaveCSS('overflow-y', 'hidden');
    await expect(chapter).toHaveCSS('text-overflow', 'ellipsis');
    const metrics = await chapter.evaluate(el => ({ height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight), overflowing: el.scrollWidth > el.clientWidth, scrollbar: (el as HTMLElement).offsetHeight - el.clientHeight }));
    expect(Math.abs(metrics.height - metrics.lineHeight)).toBeLessThan(1);
    expect(metrics.overflowing).toBe(true); expect(metrics.scrollbar).toBe(0);
    expect(await neighbours()).toEqual(before);
    const titleBox = (await chapter.boundingBox())!, actions = (await page.locator('.topbar .toolbar').boundingBox())!;
    expect(titleBox.x + titleBox.width <= actions.x + 1 || titleBox.y + titleBox.height <= actions.y + 1).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`单行省略章节-${width}.png`), fullPage: true });
  }
});

test('截图中的章节在宽屏使用剩余空间完整单行显示', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page);
  await page.locator('.book-title').evaluate(el => { el.textContent = '结构性改革'; });
  await page.locator('.book-author').evaluate(el => { el.textContent = '黄奇帆'; });
  const title = '“数字化”背景下经济社会发展的新特征、新趋势', chapter = page.locator('.reading-chapter');
  await chapter.evaluate((el, text) => { el.textContent = text; }, title);
  expect(await chapter.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const metrics = await chapter.evaluate(el => ({ height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight) }));
  expect(Math.abs(metrics.height - metrics.lineHeight)).toBeLessThan(1);
  await page.screenshot({ path: test.info().outputPath('截图章节-单行完整显示.png'), fullPage: true });
});

test('点击省略章节后方向键仍正常翻页，不再进入标题滚动模式', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 }); await open(page);
  const chapter = page.locator('.reading-chapter'), before = await savedCfi(page);
  await chapter.evaluate(el => { el.textContent = '供给侧改革、宏观经济与阅读记录'.repeat(10); });
  await expect(chapter).not.toHaveAttribute('tabindex');
  await chapter.click(); await page.keyboard.press('ArrowRight');
  await expect.poll(() => savedCfi(page)).not.toBe(before);
  await expect(page.locator('.reader-viewport')).toBeFocused();
  expect(await chapter.evaluate(el => el.scrollLeft)).toBe(0);
});

test('上下方向键在正文 iframe 与外层都能翻页，输入框与合成输入不误触', async ({ page }) => {
  await open(page); const first = await savedCfi(page);
  await page.frameLocator('.reader-viewport iframe').first().locator('body').evaluate(body => { body.tabIndex = -1; body.focus(); });
  await page.keyboard.press('ArrowDown'); await expect.poll(() => savedCfi(page)).not.toBe(first);
  await page.keyboard.press('ArrowUp'); await expect.poll(() => savedCfi(page)).toBe(first);
  await page.locator('.book-title').click(); await page.keyboard.press('ArrowDown');
  await expect.poll(() => savedCfi(page)).not.toBe(first);
  await page.keyboard.press('ArrowUp'); await expect.poll(() => savedCfi(page)).toBe(first);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true, bubbles: true })));
  expect(await savedCfi(page)).toBe(first);
  await select(page); await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('这是用于输入保护的笔记');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  expect(await savedCfi(page)).toBe(first);
  await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await openNotesPage(page);
  await page.getByLabel('搜索笔记').fill('搜索'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  await resumeReading(page); await expect.poll(() => savedCfi(page)).toBe(first);
});

test('选文浮条边距收紧，保持完整功能与屏幕内可点击范围', async ({ page }) => {
  await open(page); await select(page);
  const toolbar = page.getByRole('region', { name: '选文工具条' });
  await expect(toolbar).toHaveCSS('padding', '6px 8px'); await expect(toolbar).toHaveCSS('margin', '0px');
  await expect(toolbar.locator('.selection-actions')).toHaveCSS('gap', '3px');
  await expect(toolbar.locator('.style-group').first()).toHaveCSS('padding-right', '6px');
  await expect(toolbar.getByRole('button', { name: '波浪线', exact: true })).toHaveCSS('min-height', '30px');
  await toolbar.getByRole('button', { name: '波浪线', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: '波浪线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.setViewportSize({ width: 320, height: 720 }); await select(page);
  const box = (await toolbar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
  await expect(toolbar.getByRole('button', { name: '思考', exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/images/阅读交互-紧凑选文工具条-320.png', fullPage: true });
});

test('笔记模糊搜索高亮原文、思考和章节，自动展开命中思考，清除恢复列表且不写回数据', async ({ page }) => {
  await open(page);
  await makeThought(page, 0, '宏观经济改革记录：<img src=x onerror=alert(1)> Café');
  await makeThought(page, 1, '另一条无关的阅读感受');
  await makeThought(page, 2, '第三条记录');
  await openNotesPage(page);
  const persisted = () => page.evaluate(() => new Promise<string>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['annotations', 'thoughts'], 'readonly');
      const a = tx.objectStore('annotations').getAll(), t = tx.objectStore('thoughts').getAll();
      tx.oncomplete = () => { db.close(); resolve(JSON.stringify([a.result, t.result])); };
    };
  }));
  const before = await persisted(), search = page.getByLabel('搜索笔记');
  await search.fill('宏观 经济'); await expect(page.locator('.annotation-card')).toHaveCount(1);
  await expect(page.locator('.annotation-card details')).toHaveAttribute('open', '');
  await expect(page.locator('.thought-entry mark')).toHaveText('宏观经济');
  await search.fill('宏观经齐改革'); await expect(page.locator('.annotation-card')).toHaveCount(1);
  await expect(page.locator('.thought-entry mark')).toHaveText('宏观经济改革');
  await search.fill('窗外 树影'); await expect(page.locator('.annotation-card')).toHaveCount(1);
  await expect(page.locator('.annotation-quote mark')).toContainText(['窗外', '树影']);
  await page.screenshot({ path: 'docs/images/阅读交互-模糊搜索高亮.png', fullPage: true });
  await search.fill('第一章'); await expect(page.locator('.annotation-card')).toHaveCount(3);
  await expect(page.locator('.annotation-source mark')).toHaveCount(3);
  await search.fill('ＣＡＦＥ'); await expect(page.locator('.thought-entry mark')).toHaveText('Café');
  await search.fill('<img'); await expect(page.locator('.thought-entry mark')).toHaveText('<img');
  await expect(page.locator('.thought-entry img,.thought-entry script')).toHaveCount(0);
  await search.fill('完全不存在的关键词'); await expect(page.locator('.annotation-card')).toHaveCount(0);
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await expect(page.locator('.annotation-card')).toHaveCount(3); await expect(page.locator('mark.search-hit')).toHaveCount(0);
  expect(await persisted()).toBe(before);
});

test('第 50 条之后的命中思考也自动可见，高亮只影响展示', async ({ page }) => {
  await open(page); await makeThought(page, 0, '第一条思考');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['annotations', 'thoughts'], 'readwrite');
      const get = tx.objectStore('annotations').getAll();
      get.onsuccess = () => {
        const a = get.result[0];
        for (let i = 2; i <= 61; i++) tx.objectStore('thoughts').add({ version: 1, id: `many-thought-${i}`, annotationId: a.id, bookId: a.bookId, ordinal: i, text: i === 61 ? '隐藏末尾搜索词' : `第 ${i} 条普通内容`, createdAt: Date.now(), updatedAt: Date.now(), revision: 1 });
        tx.objectStore('annotations').put({ ...a, nextThoughtOrdinal: 62, revision: a.revision + 1 });
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    };
  }));
  await page.reload(); await page.getByRole('button', { name: '我的笔记', exact: true }).click();
  await page.getByLabel('搜索笔记').fill('隐藏末尾搜索词');
  await expect(page.locator('.thought-entry mark')).toHaveText('隐藏末尾搜索词');
  await expect(page.locator('.thought-entry mark')).toBeVisible();
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await expect(page.locator('.annotation-card details')).not.toHaveAttribute('open', '');
  await page.getByText('展开思考（61）', { exact: true }).click();
  await expect(page.locator('.thought-entry')).toHaveCount(50);
});

test('触屏选文工具条保留 44px 命中面积，窄屏不越界', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  try {
    const page = await context.newPage(); await open(page); await select(page);
    expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)).toBe(true);
    const toolbar = page.getByRole('region', { name: '选文工具条' });
    const sizes = await toolbar.getByRole('button').evaluateAll(buttons => buttons.map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
    for (const size of sizes) { expect(size.width).toBeGreaterThanOrEqual(44); expect(size.height).toBeGreaterThanOrEqual(44); }
    const box = (await toolbar.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  } finally { await context.close(); }
});

test('三个主题下搜索高亮可见，未修改正式思考文本', async ({ page }) => {
  await open(page); await makeThought(page, 0, '供给侧改革');
  const backgrounds: string[] = [];
  for (const theme of ['明亮', '护眼', '深色']) {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByRole('button', { name: theme, exact: true }).click();
    await page.getByRole('button', { name: '关闭面板' }).click();
    await openNotesPage(page); await page.getByLabel('搜索笔记').fill('供给测改革');
    const mark = page.locator('.thought-entry mark'); await expect(mark).toHaveText('供给侧改革'); await expect(mark).toBeVisible();
    await expect(page.locator('.thought-entry p')).toHaveText('供给侧改革');
    const colors = await mark.evaluate(el => ({ foreground: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
    expect(colors.background).not.toBe('rgba(0, 0, 0, 0)'); expect(colors.foreground).not.toBe(colors.background); backgrounds.push(colors.background);
    await resumeReading(page);
  }
  expect(new Set(backgrounds).size).toBe(3);
});
