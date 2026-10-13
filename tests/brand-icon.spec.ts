import { expect, test } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';

for (const width of [1440, 390]) {
  test(`松针绿印章图标在书架、阅读页和三种主题下正常显示（${width}px）`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const brand = page.getByRole('button', { name: '静读，返回首页', exact: true });
    // 专注模式下所有屏宽都隐藏品牌且不保留占位，用 DOM 定位器检查。
    const icon = page.locator('.brand img.brand-mark');
    await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
    await expect(icon).toHaveAttribute('src', /brand-pine-seal/);
    await expect(icon).toHaveAttribute('alt', '');
    await expect(icon).toHaveAttribute('draggable', 'false');
    await expect.poll(() => icon.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(512);
    await expect(icon).toHaveCSS('width', width <= 680 ? '34px' : '42px');
    await expect(icon).toHaveCSS('height', width <= 680 ? '34px' : '42px');
    await expect(icon).toHaveCSS('border-top-width', '0px');
    const source = await icon.getAttribute('src');
    await brand.hover();
    await expect(brand).toHaveCSS('border-top-width', '0px');
    await expect(brand).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub'));
    await waitForBook(page);
    for (const [name, theme] of [['明亮', 'light'], ['护眼', 'sepia'], ['深色', 'dark']]) {
      await page.getByRole('button', { name: '设置', exact: true }).click();
      await page.getByRole('button', { name, exact: true }).click();
      await expect(page.locator('.app')).toHaveClass(new RegExp(`theme-${theme}`));
      await page.getByRole('button', { name: '关闭面板', exact: true }).click();
      await expect(icon).toBeVisible();
      await expect(icon).toHaveAttribute('src', source!);
      await expect(icon).toHaveCSS('width', width <= 680 ? '34px' : '42px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator('.topbar').screenshot({ path: test.info().outputPath(`松针绿印章-${theme}-${width}.png`) });
    }
    const geometry = () => icon.evaluate(el => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const bounds = await geometry();
    await page.getByRole('button', { name: '进入专注模式' }).click();
    await expect(icon).not.toBeVisible();
    await expect(page.locator('.brand')).toHaveCSS('display', 'none');
    await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
    await expect(icon).toBeVisible();
    expect(await geometry()).toEqual(bounds);
    // 新图标仍是原返回首页按钮的一部分，点击图片可正常返回书架。
    await icon.click();
    await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
    await expect(icon).toBeVisible();
  });
}
