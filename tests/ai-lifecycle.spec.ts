import { expect, test } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';
test('浏览器主动悬浮；新选文沿用对话；关闭后清空且密钥仍配置', async ({ page }) => {
  await page.addInitScript(() => { if (!location.search.includes('ai-assistant')) localStorage.setItem('quiet-reader:ai-preferences:v1', JSON.stringify({ version: 1, model: 'deepseek-chat', preferredMode: 'floating' })); });
  let requests = 0;
  await page.route('https://api.deepseek.com/chat/completions', async route => {
    requests++; expect(route.request().postDataJSON().thinking.type).toBe('disabled');
    await route.fulfill({ contentType: 'text/event-stream', headers: { 'access-control-allow-origin': '*' }, body: 'data: {"choices":[{"delta":{"content":"示例回答"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' });
  });
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page);
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('checkbox', { name: /记住 API Key/ }).uncheck(); await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('sk-lifecycle-mock'); await page.getByRole('button', { name: '保存配置', exact: true }).click(); await expect(page.locator('.ai-setting-status')).toContainText('仅本次'); await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  const width = await page.evaluate(() => innerWidth), box = await page.locator('.reading-space').boundingBox();
  for (const index of [0, 1, 2]) {
    await page.frameLocator('.reader-viewport iframe').first().locator('p').nth(index).evaluate(p => { const r = p.ownerDocument.createRange(); r.selectNodeContents(p); const s = p.ownerDocument.defaultView!.getSelection()!; s.removeAllRanges(); s.addRange(r); p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    await page.getByRole('button', { name: '问 AI', exact: true }).click(); await expect(page.locator('.ai-floating')).toBeVisible(); await expect(page.getByLabel('助手呈现模式')).toHaveValue('floating');
    await expect(page.getByLabel('助手呈现模式').locator('option[value=expanded]')).toHaveJSProperty('disabled', true);
    if (index === 0) { await expect(page.getByRole('button', { name: /我已了解/ })).toHaveCount(0); await page.getByRole('button', { name: '解释术语', exact: true }).click(); await expect(page.locator('.ai-answer-actions small')).toContainText('已完成'); await expect(page.locator('.ai-answer-actions small')).toHaveAttribute('title', /首字等待.*总耗时/); }
    if (index === 1) { await expect(page.getByRole('group', { name: '引用 1', exact: true })).toContainText('第 1 段。'); await expect(page.getByRole('group', { name: '引用 2', exact: true })).toContainText('第 2 段。'); await expect(page.locator('.ai-reference-group').first().locator('.ai-turn')).toHaveCount(1); await expect(page.locator('.ai-turn')).toHaveCount(1); await expect(page.getByRole('button', { name: '新建提问' })).toHaveCount(0); await page.locator('.ai-messages').evaluate(el => { el.scrollTop = 0; }); await page.locator('.ai-floating').screenshot({ path: '.tools/ai-multiple-references.png' }); await page.getByLabel('向 AI 提问').fill('关闭后不恢复此草稿'); await page.getByRole('button', { name: '关闭 AI 助手' }).click(); await expect(page.locator('.ai-floating')).toHaveCount(0); }
    if (index === 2) { await expect(page.locator('.ai-turn')).toHaveCount(0); await expect(page.getByLabel('向 AI 提问')).toHaveValue(''); await expect(page.getByRole('button', { name: /我已了解/ })).toHaveCount(0); await expect(page.getByRole('button', { name: '解释术语', exact: true })).toBeEnabled(); await expect(page.locator('.ai-reference-group')).toHaveCount(1); }
  }
  expect(requests).toBe(1); expect(await page.evaluate(() => innerWidth)).toBe(width); expect(await page.locator('.reading-space').boundingBox()).toEqual(box); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('quiet-reader:ai-preferences:v1')!).preferredMode)).toBe('floating');
});

test('桌面已配置密钥可直接启用系统记住，不要求前端重新读取或填写密钥（公开 API 模拟）', async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    let remembered = false; const calls: string[] = []; Object.assign(window, { aiCredentialTest: { calls } });
    window.__TAURI__ = {
      core: { invoke: async (command: string, args?: { remember?: boolean }) => {
        calls.push(command);
        if (command === 'ai_key_status') return true;
        if (command === 'ai_key_info') return { configured: true, remembered };
        if (command === 'ai_set_persistence') { remembered = !!args?.remember; return; }
        throw new Error('未模拟的命令');
      } },
      event: { listen: async () => () => {}, emitTo: async () => {} },
      window: { getCurrentWindow: () => ({ isMaximized: async () => false, setBackgroundColor: async () => {}, onResized: async () => () => {}, onCloseRequested: async () => () => {} }) },
    } as never;
  });
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page); await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('checkbox', { name: /安全记住/ }).check(); await page.getByRole('button', { name: '保存配置', exact: true }).click(); await expect(page.locator('.ai-setting-status')).toContainText('重启仍可用');
  const calls = await page.evaluate(() => (window as unknown as { aiCredentialTest: { calls: string[] } }).aiCredentialTest.calls); expect(calls).toContain('ai_set_persistence'); expect(calls).not.toContain('ai_set_key');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click(); await page.getByRole('button', { name: '设置', exact: true }).click(); await expect(page.getByRole('checkbox', { name: /安全记住/ })).toBeChecked(); await expect(page.locator('.ai-key-row input')).toHaveValue('');
});
