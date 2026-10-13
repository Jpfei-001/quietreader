import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { waitForBook, savedCfi } from './helpers';

for (const width of [1440, 800, 390]) test(`阅读页底部更紧凑，正文充分利用高度且最后一行不裁切（${width}px）`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const zip = await JSZip.loadAsync(await readFile(path.resolve('public/demo/minimal.epub')));
  zip.file('OEBPS/chapter0.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>页底间距</title><style>body { margin:0; } p { margin:0; orphans:3; widows:3; }</style></head><body><p>${'充足的正文用于验证页底可显示更多文本，翻页不能跳字或裁掉最后一行。 '.repeat(200)}</p></body></html>`);
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'reader-spacing.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await waitForBook(page);
  const footer = page.locator('.reader-footer'), toggle = page.locator('.focus-toggle'), reader = page.locator('.reading-space');
  await expect(footer).toHaveCSS('height', '44px');
  await expect(toggle).toHaveCSS('height', '22px');
  const readerBox = (await reader.boundingBox())!, footerBox = (await footer.boundingBox())!, toggleBox = (await toggle.boundingBox())!;
  expect(Math.abs(footerBox.y - readerBox.y - readerBox.height)).toBeLessThan(1);
  expect(Math.abs(toggleBox.y - footerBox.y - footerBox.height)).toBeLessThan(1);
  expect(Math.abs(toggleBox.y + toggleBox.height - 900)).toBeLessThan(1);
  expect(readerBox.height).toBe(900 - (width <= 680 ? 130 : 96) - 44 - 22);

  const metrics = () => page.frameLocator('.reader-viewport iframe').first().locator('body').evaluate(body => {
    const range = body.ownerDocument.createRange(); range.selectNodeContents(body.querySelector('p')!);
    const style = getComputedStyle(body), paragraphStyle = getComputedStyle(body.querySelector('p')!);
    const height = parseFloat(style.height), inset = parseFloat(style.paddingBottom);
    // 当前第一页的第一栏；其余片段在后续 CSS 栏中，不应该出现在此页。
    const firstColumn = Array.from(range.getClientRects()).filter(rect => rect.x < parseFloat(style.columnWidth) && rect.y >= 0);
    const bottom = Math.max(...firstColumn.map(rect => rect.bottom));
    return { bottom, height, inset, gap: height - bottom, lineHeight: parseFloat(style.lineHeight), top: style.paddingTop, orphans: paragraphStyle.orphans, widows: paragraphStyle.widows };
  });
  // 切换模式/尺寸会重建 iframe，重试整个断言而不是把短暂卸载当成产品失败。
  await expect(async () => { expect((await metrics()).inset).toBe(4); }).toPass({ timeout: 5000 });
  const normal = await metrics();
  expect(normal.bottom).toBeLessThanOrEqual(normal.height - normal.inset);
  expect(normal.gap).toBeLessThan(normal.lineHeight + 16);
  expect(normal.orphans).toBe('2'); expect(normal.widows).toBe('1');
  const initialCfi = await savedCfi(page);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => savedCfi(page)).not.toBe(initialCfi);
  await page.getByRole('button', { name: '上一页', exact: true }).click();
  await expect.poll(() => savedCfi(page)).toBe(initialCfi);
  await page.getByRole('button', { name: '进入专注模式' }).click();
  await expect(async () => { expect((await metrics()).inset).toBe(2); }).toPass({ timeout: 5000 });
  await expect.poll(async () => (await reader.boundingBox())!.height).toBe(readerBox.height + 34);
  await page.getByRole('button', { name: '显示工具栏' }).click();
  await expect(async () => { expect((await metrics()).inset).toBe(4); }).toPass({ timeout: 5000 });
  await expect.poll(async () => (await reader.boundingBox())!.height).toBe(readerBox.height);
  await expect(footer).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});
