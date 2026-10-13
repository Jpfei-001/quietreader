import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { savedCfi, waitForBook } from './helpers';

async function open(page: Page) {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub'));
  await waitForBook(page);
}

async function keyboardTurn(page: Page, key: string) {
  const before = await savedCfi(page), scroll = await page.evaluate(() => window.scrollY);
  await page.keyboard.press(key);
  await expect.poll(() => savedCfi(page)).not.toBe(before);
  await expect(page.locator('.reader-viewport')).toBeFocused();
  await expect(page.locator('.reader-viewport')).toHaveCSS('outline-style', 'none');
  await expect(page.locator('button:focus-visible')).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
}

for (const [name, key] of [['下一页', 'ArrowDown'], ['下一页', 'ArrowRight'], ['上一页', 'ArrowUp'], ['上一页', 'ArrowLeft']]) {
  test(`鼠标点击${name}后按 ${key} 翻页，不留下按钮外框`, async ({ page }) => {
    await open(page);
    if (name === '上一页') {
      // 留出两页，确保按钮和方向键都能实际向前翻页。
      for (let i = 0; i < 2; i++) {
        const before = await savedCfi(page);
        await page.getByRole('button', { name: '下一页', exact: true }).click();
        await expect.poll(() => savedCfi(page)).not.toBe(before);
      }
    }
    const button = page.getByRole('button', { name, exact: true }), before = await savedCfi(page);
    await button.click(); await expect.poll(() => savedCfi(page)).not.toBe(before);
    await expect(button).toBeFocused();
    await keyboardTurn(page, key);
    await page.screenshot({ path: test.info().outputPath('鼠标后方向键-无残留焦点框.png'), fullPage: true });
  });
}

test('专注模式切换按钮点击后，方向键同样将焦点移回正文', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '进入专注模式' }).click();
  await expect(page.getByRole('button', { name: '显示工具栏', exact: true })).toBeFocused();
  await keyboardTurn(page, 'ArrowDown');
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await expect(page.getByRole('button', { name: '进入专注模式' })).toBeFocused();
  await keyboardTurn(page, 'ArrowUp');
});

test('目录、设置、主题和关闭按钮不会在返回阅读后残留焦点框', async ({ page }) => {
  await open(page);
  for (const name of ['目录', '设置']) {
    await page.getByRole('button', { name, exact: true }).click();
    if (name === '设置') {
      const theme = page.getByRole('button', { name: '护眼', exact: true });
      await theme.click(); await expect(theme).toBeFocused();
      const before = await savedCfi(page);
      await page.keyboard.press('ArrowDown');
      // 设置打开时不能抢走焦点或翻动正文；选中主题的外框仍需保留。
      await expect(theme).toBeFocused(); expect(await savedCfi(page)).toBe(before);
      await expect(theme).toHaveAttribute('aria-pressed', 'true');
    }
    await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await keyboardTurn(page, name === '目录' ? 'ArrowDown' : 'ArrowUp');
  }
});

test('选文标注按钮点击后再用方向键翻页，也没有残留焦点框', async ({ page }) => {
  await open(page);
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  const toolbar = page.getByRole('region', { name: '选文工具条' });
  await expect(toolbar).toBeVisible();
  const button = toolbar.getByRole('button', { name: '波浪线', exact: true });
  await button.click(); await expect(button).toBeFocused();
  await keyboardTurn(page, 'ArrowDown');
});

test('Tab 键访问按钮时仍显示焦点提示，Enter 和空格仍可正常使用', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: '静读，返回首页' }).focus();
  await page.keyboard.press('Tab');
  const notes = page.getByRole('button', { name: '笔记', exact: true });
  await expect(notes).toBeFocused(); await expect(notes).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  const contents = page.getByRole('button', { name: '目录', exact: true });
  await expect(contents).toBeFocused(); await expect(contents).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter'); await expect(page.getByLabel('章节目录', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('.side-panel')).toHaveCount(0);
  await page.keyboard.press('Tab');
  const settings = page.getByRole('button', { name: '设置', exact: true });
  await expect(settings).toBeFocused(); await expect(settings).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Space'); await expect(page.getByLabel('设置面板', { exact: true })).toBeVisible();
});
