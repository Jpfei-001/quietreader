import { expect, test } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';

for (const outcome of ['browser', 'native', 'failed'] as const) test(`获取密钥指向 API Keys，桌面交给固定目标命令（${outcome}）`, async ({ page }) => {
  if (outcome !== 'browser') await page.addInitScript(({ outcome }) => {
    const calls: string[] = []; Object.assign(window, { keyLinkCalls: calls, __TAURI__: {
      core: { invoke: async (command: string) => { calls.push(command); if (command === 'ai_key_info') return { configured: false, remembered: false }; if (command === 'ai_open_key_page') { if (outcome === 'failed') throw new Error('无法打开系统浏览器，请复制密钥页面链接后打开。'); return; } throw new Error('Unexpected command'); } },
      event: { listen: async () => () => {}, emitTo: async () => {} },
    } });
  }, { outcome });
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const link = page.getByRole('link', { name: '获取密钥 ↗' }); await expect(link).toHaveAttribute('href', 'https://platform.deepseek.com/api_keys');
  if (outcome === 'browser') return;
  const popups: string[] = []; page.on('popup', popup => popups.push(popup.url())); await link.click();
  await expect.poll(() => page.evaluate(() => (window as any).keyLinkCalls.filter((c: string) => c === 'ai_open_key_page').length)).toBe(1);
  expect(popups).toEqual([]);
  if (outcome === 'failed') await expect(page.locator('.ai-setting-status')).toContainText('无法打开系统浏览器');
});
