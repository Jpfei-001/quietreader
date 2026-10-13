import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { waitForBook, openNotesPage } from './helpers';

test('长目录打开后定位当前章，间距紧凑，左右侧与重新打开都保持定位', async ({ page }) => {
  const zip = await JSZip.loadAsync(await readFile(path.resolve('public/demo/minimal.epub')));
  const count = 40;
  let opf = await zip.file('OEBPS/content.opf')!.async('string');
  opf = opf.replace(/<dc:title>.*?<\/dc:title>/, '<dc:title>目录定位样书</dc:title>')
    .replace(/<manifest>/, '<manifest>' + Array.from({ length: count }, (_, i) => `<item id="long${i}" href="long${i}.xhtml" media-type="application/xhtml+xml"/>`).join(''))
    .replace(/<spine>.*?<\/spine>/, '<spine>' + Array.from({ length: count }, (_, i) => `<itemref idref="long${i}"/>`).join('') + '</spine>');
  zip.file('OEBPS/content.opf', opf);
  for (let i = 0; i < count; i++) zip.file(`OEBPS/long${i}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第 ${i + 1} 章</title></head><body><h1>第 ${i + 1} 章</h1><p>这是第 ${i + 1} 章，用于验证长目录定位。</p></body></html>`);
  zip.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${Array.from({ length: count }, (_, i) => `<li><a href="long${i}.xhtml">第 ${i + 1} 章</a></li>`).join('')}</ol></nav></body></html>`);
  await page.setViewportSize({ width: 1100, height: 600 }); await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'long-contents.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await waitForBook(page, '目录定位样书');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '第 36 章', exact: true }).click();
  await expect(page.locator('.reading-progress small')).toContainText('第 36 / 40 章');
  const cfi = await page.locator('.reading-progress').innerText();
  for (const side of ['left', 'right']) {
    if (side === 'right') {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('radio', { name: '右侧', exact: true }).check(); await page.keyboard.press('Escape');
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: '目录', exact: true }).click();
      const current = page.locator('.chapter-list [aria-current="location"]');
      await expect(current).toHaveCount(1); await expect(current).toHaveText('第 36 章');
      await expect.poll(() => current.evaluate(el => {
        const panel = el.closest('.chapter-list')!, box = el.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
        return panel.scrollTop > 0 && box.top >= panelBox.top && box.bottom <= panelBox.bottom;
      })).toBe(true);
      await expect(current).toHaveCSS('padding-left', '8px'); await expect(current).toHaveCSS('padding-top', '6px');
      if (attempt === 0) await page.locator('.chapter-list').evaluate(el => { el.scrollTop = 0; });
      else await page.screenshot({ path: `docs/images/布局微调-目录-${side}.png`, fullPage: true });
      await page.keyboard.press('Escape'); expect(await page.locator('.reading-progress').innerText()).toBe(cfi);
    }
  }
});

test('同一资源的嵌套目录只标记当前位置，不同时选中所有小节', async ({ page }) => {
  const zip = await JSZip.loadAsync(await readFile(path.resolve('public/demo/minimal.epub')));
  zip.file('OEBPS/chapter0.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>嵌套章节</title><style>h2 { break-before:column; }</style></head><body><h1>父章节</h1><h2 id="first">第一节</h2><p>第一节正文。</p><h2 id="second">第二节</h2><p>第二节正文。</p></body></html>');
  zip.file('OEBPS/nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="chapter0.xhtml">父章节</a><ol><li><a href="chapter0.xhtml#first">第一节</a></li><li><a href="chapter0.xhtml#second">第二节</a></li></ol></li></ol></nav></body></html>');
  await page.setViewportSize({ width: 800, height: 600 }); await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'nested.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await waitForBook(page);
  await page.getByRole('button', { name: '目录', exact: true }).click(); await page.getByRole('button', { name: '第二节', exact: true }).click();
  await expect(page.locator('.reading-chapter')).toHaveText('第二节');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await expect(page.locator('.chapter-list [aria-current]')).toHaveCount(1);
  await expect(page.locator('.chapter-list [aria-current]')).toHaveText('第二节');
  await expect(page.locator('.chapter-list [aria-current]')).toHaveCSS('padding-left', '20px');
});

test('多个思考用留白分隔，不再出现横线，编辑删除入口仍可用', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page);
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await page.getByRole('button', { name: '思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('第一次思考'); await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await openNotesPage(page);
  await page.getByRole('button', { name: '追加思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('第二次思考'); await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await page.getByText('展开思考（2）', { exact: true }).click();
  await expect(page.locator('.thought-entry')).toHaveCount(2);
  for (const entry of await page.locator('.thought-entry').all()) {
    await expect(entry).toHaveCSS('border-bottom-width', '0px');
    await expect(entry.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
    await expect(entry.getByRole('button', { name: '删除', exact: true })).toBeVisible();
  }
  await page.screenshot({ path: 'docs/images/布局微调-多个思考.png', fullPage: true });
});
