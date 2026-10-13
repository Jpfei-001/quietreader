import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { waitForBook } from './helpers';

const firstChapter = '五、趋势五：房地产开发企业的负债率与经营方式将发生深刻变化并影响市场供求关系与中长期发展趋势';
const secondChapter = '六、趋势六：中国房地产业经营的售租模式会发生变化以及未来发展的新方向';

async function openLongTitleBook(page: Page) {
  const zip = await JSZip.loadAsync(await readFile(path.resolve('public/demo/minimal.epub')));
  let opf = await zip.file('OEBPS/content.opf')!.async('string');
  opf = opf.replace(/<dc:title>.*?<\/dc:title>/, '<dc:title>结构性改革</dc:title>')
    .replace(/<dc:creator[^>]*>.*?<\/dc:creator>/, '<dc:creator>黄奇帆</dc:creator>');
  zip.file('OEBPS/content.opf', opf);
  zip.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="chapter0.xhtml">${firstChapter}</a></li><li><a href="chapter1.xhtml">${secondChapter}</a></li><li><a href="chapter2.xhtml">第三章</a></li></ol></nav></body></html>`);
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'narrow-long-title.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await waitForBook(page, '结构性改革');
  await expect(page.locator('.book-author')).toHaveText('黄奇帆');
  await expect(page.locator('.reading-chapter')).toHaveText(firstChapter);
}

async function headingGeometry(page: Page) {
  return page.locator('.book-title,.book-author,.reading-chapter').evaluateAll(items => items.map(el => {
    const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, size: getComputedStyle(el).fontSize };
  }));
}

async function expectFocusedEdges(page: Page) {
  await expect(page.locator('.reading-topbar .brand')).toHaveCSS('display', 'none');
  await expect(page.locator('.reading-topbar .toolbar')).toHaveCSS('display', 'none');
  const header = await page.locator('.reading-topbar').evaluate(el => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return { left: rect.left + parseFloat(style.paddingLeft), right: rect.right - parseFloat(style.paddingRight) };
  });
  const [title, author, chapter] = await headingGeometry(page);
  expect(Math.abs(title.x - header.left)).toBeLessThan(1);
  expect(Math.abs(author.x - header.left)).toBeLessThan(1);
  expect(Math.abs(chapter.x + chapter.width - header.right)).toBeLessThan(1);
  expect(title.x + title.width).toBeLessThan(chapter.x);
  await expect(page.locator('.reading-chapter')).toHaveCSS('text-align', 'right');
  await expect(page.locator('.reading-chapter')).toHaveCSS('text-overflow', 'ellipsis');
  await expect(page.locator('.reading-chapter')).toHaveCSS('overflow-x', 'hidden');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => page.locator('.reading-topbar').evaluate(el =>
    Math.abs(parseFloat(getComputedStyle(el.parentElement!).getPropertyValue('--reader-header-height')) - el.getBoundingClientRect().height)
  )).toBeLessThan(1);
}

for (const width of [320, 390, 680, 800, 1000, 1099, 1100, 1440, 2400]) {
  test(`实际 EPUB 长标题无滚动条，所有屏宽专注模式左右对齐且退出恢复（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await openLongTitleBook(page);
    for (const theme of ['明亮', '护眼', '深色']) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('button', { name: theme, exact: true }).click();
      await page.getByRole('button', { name: '关闭面板', exact: true }).click();
      const before = await headingGeometry(page), chapter = page.locator('.reading-chapter');
      await expect(chapter).toHaveAttribute('title', firstChapter);
      await expect(chapter).toHaveCSS('overflow', 'hidden');
      const metrics = await chapter.evaluate(el => ({ clipped: el.scrollWidth > el.clientWidth, height: el.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(el).lineHeight), scrollbar: (el as HTMLElement).offsetHeight - el.clientHeight }));
      // 超宽屏能完整放下章节标题，不应强制截断；其它宽度仍验证省略显示。
      expect(metrics.clipped).toBe(width < 2400); expect(metrics.scrollbar).toBe(0);
      expect(Math.abs(metrics.height - metrics.lineHeight)).toBeLessThan(1);
      await page.getByRole('button', { name: '进入专注模式' }).click();
      await expectFocusedEdges(page);
      expect((await headingGeometry(page)).map(item => item.size)).toEqual(before.map(item => item.size));
      await page.locator('.reading-topbar').screenshot({ path: test.info().outputPath(`专注顶栏-${theme}-${width}.png`) });
      // Escape 和底部按钮两种退出方式都恢复原位。
      if (theme === '护眼') await page.keyboard.press('Escape');
      else await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
      await expect(page.locator('.reading-topbar .brand')).toBeVisible();
      await expect(page.getByRole('button', { name: '目录', exact: true })).toBeVisible();
      expect(await headingGeometry(page)).toEqual(before);
      await page.locator('.reading-topbar').screenshot({ path: test.info().outputPath(`普通顶栏-${theme}-${width}.png`) });
    }
    // 切换到另一个实际长章节，仍省略显示且完整标题可通过悬停查看。
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await page.getByRole('button', { name: secondChapter, exact: true }).click();
    await expect(page.locator('.reading-chapter')).toHaveText(secondChapter);
    await expect(page.locator('.reading-chapter')).toHaveAttribute('title', secondChapter);
    await page.getByRole('button', { name: '进入专注模式' }).click();
    await expectFocusedEdges(page);
  });
}

test('专注模式中跨宽窄屏缩放后始终左右对齐，退出恢复原布局', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 }); await openLongTitleBook(page);
  const before = await headingGeometry(page);
  await page.getByRole('button', { name: '进入专注模式' }).click();
  await expectFocusedEdges(page);
  for (const width of [1100, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectFocusedEdges(page);
  }
  for (const width of [1099, 390, 800]) {
    await page.setViewportSize({ width, height: 900 }); await expectFocusedEdges(page);
  }
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  expect(await headingGeometry(page)).toEqual(before);
});

for (const side of ['左侧', '右侧']) test(`固定目录时宽屏专注顶栏也在剩余区域内左右对齐（${side}）`, async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await openLongTitleBook(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('radio', { name: side, exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '固定目录', exact: true }).click();
  const before = await headingGeometry(page);
  await page.getByRole('button', { name: '进入专注模式', exact: true }).click();
  await expectFocusedEdges(page);
  await expect(page.locator('.contents-dock')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`固定目录-专注顶栏-${side}.png`), fullPage: true });
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  expect(await headingGeometry(page)).toEqual(before);
});
