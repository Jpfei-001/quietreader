import { expect, test } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';

for (const width of [801, 943]) test(`固定目录时第二本书及保存位置重开可见，不卡正在定位（${width}px）`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page);
  await page.getByRole('button', { name: '目录', exact: true }).click(); await page.getByRole('button', { name: '固定目录', exact: true }).click();
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/epub2.epub')); await waitForBook(page, '静读 · EPUB 2 样书');
  await expect(page.locator('.reading-progress')).not.toContainText('正在定位');
  await expect(page.frameLocator('.reader-viewport iframe').first().locator('body')).toBeVisible();
  for (let round = 0; round < 3; round++) {
    await page.getByRole('button', { name: '静读，返回首页', exact: true }).click();
    await page.getByRole('button', { name: '阅读 静读 · 给文字留一点空白', exact: true }).click(); await waitForBook(page);
    await expect(page.locator('.reading-progress')).not.toContainText('正在定位'); await expect(page.frameLocator('.reader-viewport iframe').first().locator('p').first()).toBeVisible();
    await page.getByRole('button', { name: '静读，返回首页', exact: true }).click();
    await page.getByRole('button', { name: '阅读 静读 · EPUB 2 样书', exact: true }).click(); await waitForBook(page, '静读 · EPUB 2 样书');
    await expect(page.locator('.reading-progress')).not.toContainText('正在定位'); await expect(page.frameLocator('.reader-viewport iframe').first().locator('body')).toBeVisible(); await expect(page.locator('.contents-dock')).toBeVisible();
  }
});
