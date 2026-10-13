import { expect, test, type Page } from '@playwright/test';
import { savedCfi, waitForBook } from './helpers';
import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';

const title = '静读操作指南';

async function openGuide(page: Page) {
  await page.getByRole('button', { name: '使用指南', exact: true }).click();
  await waitForBook(page, title);
}

async function selectFirstParagraph(page: Page) {
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible();
}

test('使用指南和我的笔记入口在窄屏也可见，不挤出书架', async ({ page }) => {
  await page.goto('/');
  for (const width of [320, 390, 480, 680]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('button', { name: '使用指南', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '我的笔记', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await openGuide(page);
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('内置指南像普通书籍一样进入书架、保存进度，重复打开不增加副本', async ({ page }) => {
  await page.goto('/'); await openGuide(page);
  await expect(page.locator('.book-author')).toHaveText('静读');
  await expect(page.locator('.reading-progress')).toContainText('/ 17 章');
  const before = await savedCfi(page);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => savedCfi(page)).not.toBe(before);
  const position = await savedCfi(page);
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: `阅读 ${title}`, exact: true })).toBeVisible();
  await expect(page.locator('.book-cover img')).toBeVisible();
  await openGuide(page);
  await expect.poll(() => savedCfi(page)).toBe(position);
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: `阅读 ${title}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page, title);
  await expect.poll(() => savedCfi(page)).toBe(position);
});

test('操作指南的目录、每张截图均可读取，已保存的指南可断网打开和翻页', async ({ page, context }) => {
  test.setTimeout(90000);
  await page.goto('/'); await openGuide(page);
  const chapters = [
    '二、添加书籍与认识书架', '三、阅读与翻页', '四、使用章节目录',
    '五、调整外观与进入专注阅读', '六、给文字做标注与高亮',
    '七、写思考、保存与恢复草稿', '八、查看、搜索与管理笔记',
    '九、调整已有摘录', '十、导出笔记与恢复备份', '十一、删除与误操作保护',
    '十二、配置 AI 阅读助手', '十三、选文提问与追加引用', '十四、助手模式、保存回答与会话保护',
  ];
  const seen = new Set<string>();
  for (const chapter of chapters) {
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await page.getByRole('button', { name: chapter, exact: true }).click();
    await expect(page.locator('.reading-chapter')).toHaveText(chapter);
    const images = page.frameLocator('.reader-viewport iframe').first().locator('figure img');
    await expect.poll(() => images.evaluateAll(items => items.length > 0 && items.every(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0))).toBe(true);
    for (const alt of await images.evaluateAll(items => items.map(el => el.getAttribute('alt')!))) seen.add(alt);
  }
  expect(seen.size).toBe(15);
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: `阅读 ${title}`, exact: true }).click();
  await waitForBook(page, title);
  const previous = await savedCfi(page);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => savedCfi(page)).not.toBe(previous);
  await expect(page.locator('.error-banner')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('内置指南-离线阅读.png'), fullPage: true });
});

test('指南可划线、写思考和删除；删除后可从内置入口重新添加', async ({ page }) => {
  await page.goto('/'); await openGuide(page);
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.getByRole('button', { name: '一、从这里开始', exact: true }).click();
  await selectFirstParagraph(page);
  const toolbar = page.getByRole('region', { name: '选文工具条' });
  await toolbar.getByRole('button', { name: '波浪线', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: '波浪线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await toolbar.getByRole('button', { name: '思考', exact: true }).click();
  await page.getByLabel('思考正文').fill('已经了解指南入口，以后遇到问题可以直接回来查阅。');
  await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '写思考', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await page.getByRole('button', { name: `${title}的思考笔记 1`, exact: true }).click();
  await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toBeVisible();
  await expect(page.locator('.annotation-card')).toHaveCount(1);
  await page.locator('.annotation-card summary').click();
  await expect(page.locator('.thought-entry')).toContainText('已经了解指南入口');
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: `删除 ${title}`, exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.book-card')).toHaveCount(0);
  await page.reload();
  // 不强制恢复用户已删除的书架条目；从指南入口主动重新打开。
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  await expect(page.locator('.book-card')).toHaveCount(0);
  await openGuide(page);
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: `${title}的思考笔记 1`, exact: true })).toBeVisible();
});

test('新版指南入口不覆盖同名旧副本、阅读位置或思考，反复打开新版不重复', async ({ page }) => {
  // Self-owned fixture represents a previously imported same-title guide, not user data.
  const zip = await JSZip.loadAsync(await readFile('public/demo/minimal.epub'));
  const opf = (await zip.file('OEBPS/content.opf')!.async('string')).replace(/<dc:title>.*?<\/dc:title>/, '<dc:title>静读操作指南</dc:title>');
  zip.file('OEBPS/content.opf', opf); const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: '静读操作指南.epub', mimeType: 'application/epub+zip', buffer }); await waitForBook(page, title);
  const oldId = await page.locator('.reading-space').getAttribute('data-book-id');
  await selectFirstParagraph(page); await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByLabel('思考正文').fill('旧指南笔记仍须保留'); await page.getByRole('button', { name: '保存并收起', exact: true }).click();
  const oldPosition = await savedCfi(page); await page.getByRole('button', { name: '静读，返回首页' }).click();
  await openGuide(page); const newId = await page.locator('.reading-space').getAttribute('data-book-id'); expect(newId).not.toBe(oldId); await expect(page.locator('.reading-progress')).toContainText('/ 17 章');
  await page.getByRole('button', { name: '静读，返回首页' }).click(); await expect(page.locator('.book-card')).toHaveCount(2);
  await openGuide(page); expect(await page.locator('.reading-space').getAttribute('data-book-id')).toBe(newId); await page.getByRole('button', { name: '静读，返回首页' }).click(); await expect(page.locator('.book-card')).toHaveCount(2);
  const old = page.locator(`.book-card[data-book-id="${oldId}"]`); await expect(old.getByRole('button', { name: `${title}的思考笔记 1`, exact: true })).toBeVisible();
  await old.locator('.book-open').click(); await waitForBook(page, title); await expect.poll(() => savedCfi(page)).toBe(oldPosition);
});
test('指南文件无法读取时给出日常提示，不产生空书籍或卡住界面', async ({ page }) => {
  await page.route('**/books/user-guide.epub', route => route.fulfill({ status: 503, body: 'temporarily unavailable' }));
  await page.goto('/');
  await page.getByRole('button', { name: '使用指南', exact: true }).click();
  await expect(page.locator('.error-banner')).toContainText('无法打开内置使用指南');
  await expect(page.locator('.error-banner')).not.toContainText('npm');
  await expect(page.getByRole('button', { name: '使用指南', exact: true })).toBeEnabled();
  await expect(page.locator('.book-card')).toHaveCount(0);
  await page.unroute('**/books/user-guide.epub');
  await openGuide(page);
  await expect(page.locator('.error-banner')).toHaveCount(0);
});
