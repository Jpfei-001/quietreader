import { expect, test } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';
test('输入边框内只有编辑区，快捷键提示在外；生成时停止入口在输入框外且可用', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('quiet-reader:ai-preferences:v1', JSON.stringify({ version: 1, model: 'deepseek-chat', preferredMode: 'floating' })));
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://api.deepseek.com/chat/completions', async route => { await gate; try { await route.fulfill({ contentType: 'text/event-stream', body: 'data: [DONE]\n\n' }); } catch { /* Stop may already have aborted the request. */ } });
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page);
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.locator('#ai-key').fill('sk-composer-layout-fixture'); await page.getByRole('button', { name: '保存配置', exact: true }).click(); await expect(page.locator('.ai-setting-status')).toContainText('AI 配置已保存'); await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => { const range = p.ownerDocument.createRange(); range.selectNodeContents(p); const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range); p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  await page.getByRole('button', { name: '问 AI', exact: true }).click();
  await expect(page.getByRole('button', { name: '发送问题', exact: true })).toHaveCount(0); await expect(page.locator('.ai-input-box > *')).toHaveCount(1); await expect(page.locator('.ai-composer-footer')).toContainText('Enter 发送 · Shift + Enter 换行');
  await page.getByLabel('向 AI 提问').fill('解释这个观点'); await page.getByLabel('向 AI 提问').press('Enter');
  try { await expect(page.locator('.ai-composer-tools').getByRole('button', { name: '停止生成', exact: true })).toBeVisible(); await expect(page.locator('.ai-input-box').getByRole('button')).toHaveCount(0); await page.getByRole('button', { name: '停止生成', exact: true }).click(); await expect(page.getByRole('button', { name: '重试此问题（可能再次计费）', exact: true })).toBeVisible(); } finally { release(); }
});
