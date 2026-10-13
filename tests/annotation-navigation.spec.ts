import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { waitForBook, savedCfi } from './helpers';

async function openMarkedBook(page: Page) {
  const zip = await JSZip.loadAsync(await readFile(path.resolve('public/demo/minimal.epub')));
  zip.file('OEBPS/chapter0.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>标记时序</title></head><body><h1>标记时序</h1><p>这是第一页的标记，翻页后不应残留。</p><p><a href="chapter1.xhtml">跳到下一章</a></p>${Array.from({ length: 100 }, (_, i) => `<p>第 ${i + 1} 段未标记的正文。${'翻页时只显示当前页面的标记。'.repeat(8)}</p>`).join('')}</body></html>`);
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'annotation-timing.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await waitForBook(page);
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible();
  for (const name of ['波浪线', '黄色高亮']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: '关闭选文工具条' }).click();
  await expect(page.locator('.annotation-drawing path')).not.toHaveCount(0);
  await expect(page.locator('.annotation-drawing rect')).not.toHaveCount(0);
  await expect(page.locator('.annotation-marker')).toHaveCount(1);
  return savedCfi(page);
}

async function assertEmptyOverlay(page: Page) {
  await expect(page.locator('.annotation-drawing svg > g')).toHaveCount(0);
  await expect(page.locator('.annotation-marker')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '思考预览' })).toHaveCount(0);
}

for (const entry of ['button', 'keyboard'] as const) test(`同章节翻页开始就清除旧标记，逐帧无残留，返回后恢复（${entry}）`, async ({ page }) => {
  const originalCfi = await openMarkedBook(page);
  // 先打开预览，验证翻页同时清理浮层及其延迟定时器。
  await page.getByRole('button', { name: '打开摘录，思考 0 条' }).click();
  await expect(page.getByRole('region', { name: '思考预览' })).toBeVisible();
  await page.getByRole('button', { name: '关闭思考预览' }).click();
  const result = await page.evaluate(entry => {
    const frames: { moved: boolean; drawings: number; markers: number }[] = [];
    const scroller = document.querySelector<HTMLElement>('.epub-container')!;
    const start = scroller.scrollLeft;
    const sample = () => ({ moved: scroller.scrollLeft !== start, drawings: document.querySelectorAll('.annotation-drawing svg > g').length, markers: document.querySelectorAll('.annotation-marker').length });
    if (entry === 'button') document.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')!.click();
    else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const immediate = sample();
    return new Promise<{ immediate: ReturnType<typeof sample>; frames: typeof frames }>(resolve => {
      const tick = () => { frames.push(sample()); if (frames.length < 12) requestAnimationFrame(tick); else resolve({ immediate, frames }); };
      requestAnimationFrame(tick);
    });
  }, entry);
  expect(result.immediate.drawings).toBe(0);
  expect(result.immediate.markers).toBe(0);
  expect(result.frames.some(frame => frame.moved)).toBe(true);
  expect(result.frames.filter(frame => frame.moved).every(frame => frame.drawings === 0 && frame.markers === 0)).toBe(true);
  await assertEmptyOverlay(page);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect(page.locator('.annotation-drawing path')).not.toHaveCount(0);
  await expect(page.locator('.annotation-drawing rect')).not.toHaveCount(0);
  await expect(page.locator('.annotation-marker')).toHaveCount(1);
  await expect.poll(() => savedCfi(page)).toBe(originalCfi);
  // 连续往返不会丢失标记，也不会把旧坐标绘制到新页。
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: '下一页', exact: true }).click(); await assertEmptyOverlay(page);
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await expect(page.locator('.annotation-marker')).toHaveCount(1);
  }
});

test('章节链接跳转前清除旧标记，目录返回后恢复', async ({ page }) => {
  await openMarkedBook(page);
  const immediateDrawings = await page.frameLocator('.reader-viewport iframe').first().getByRole('link', { name: '跳到下一章' }).evaluate(link => {
    (link as HTMLElement).click();
    return link.ownerDocument.defaultView!.parent.document.querySelectorAll('.annotation-drawing svg > g').length;
  });
  expect(immediateDrawings).toBe(0);
  await expect(page.locator('.reading-progress small')).toContainText('2 /');
  await assertEmptyOverlay(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.locator('.contents-panel button').filter({ hasText: '第一章' }).click();
  await expect(page.locator('.annotation-marker')).toHaveCount(1);
  await expect(page.locator('.annotation-drawing path')).not.toHaveCount(0);
});
