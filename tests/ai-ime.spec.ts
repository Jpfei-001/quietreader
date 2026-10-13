import { expect, test } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';
test('独立窗口中文输入不被延迟快照覆盖，输入法 Enter 不发送，焦点框与多行高度正常', async ({ page, context }) => {
  await page.addInitScript(() => { if (!location.search.includes('ai-assistant')) localStorage.setItem('quiet-reader:ai-preferences:v1', JSON.stringify({ version: 1, model: 'deepseek-chat', preferredMode: 'detached' })); });
  const questions: string[] = [];
  await context.route('https://api.deepseek.com/chat/completions', async route => {
    const body = route.request().postDataJSON();
    if (body.stream) questions.push(body.messages.at(-1).content);
    await route.fulfill({ contentType: body.stream ? 'text/event-stream' : 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body.stream ? 'data: {"choices":[{"delta":{"content":"收到中文问题。"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' : '{"choices":[{"message":{"content":"连接成功"}}]}' });
  });
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page);
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('sk-ime-mock-only'); await page.getByRole('button', { name: '保存配置', exact: true }).click(); await expect(page.locator('.ai-setting-status')).toContainText('AI 配置已保存'); await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => { const r = p.ownerDocument.createRange(); r.selectNodeContents(p); const s = p.ownerDocument.defaultView!.getSelection()!; s.removeAllRanges(); s.addRange(r); p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: '问 AI', exact: true }).click(); const popup = await opening;
  await expect(popup.getByRole('button', { name: /我已了解/ })).toHaveCount(0);
  await page.evaluate(() => {
    const post = BroadcastChannel.prototype.postMessage;
    Object.assign(window, { imeEcho: { count: 0, input: '' } });
    BroadcastChannel.prototype.postMessage = function (value) {
      if (value?.type !== 'state') { post.call(this, value); return; }
      setTimeout(() => { const echo = (window as unknown as { imeEcho: { count: number; input: string } }).imeEcho; echo.count++; echo.input = value.state.conversation?.input ?? ''; post.call(this, value); }, 120);
    };
  });
  const input = popup.getByLabel('向 AI 提问'); await input.focus();
  await input.evaluate(el => {
    const area = el as HTMLTextAreaElement, set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    for (const text of ['s', 'sh', 'shi']) { set.call(area, text); area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: text, isComposing: true })); }
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { imeEcho: { count: number } }).imeEcho.count)).toBeGreaterThanOrEqual(3);
  await expect(input).toHaveValue('shi'); await input.press('Enter'); expect(questions).toEqual([]);
  await input.evaluate(el => {
    const area = el as HTMLTextAreaElement; Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, '是');
    area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '是' })); area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '是' }));
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { imeEcho: { input: string } }).imeEcho.input)).toBe('是'); await expect(input).toHaveValue('是');
  await expect(popup.getByRole('button', { name: '发送问题', exact: true })).toHaveCount(0); await input.press('Enter'); await expect(popup.locator('.ai-answer-actions small')).toContainText('已完成'); expect(questions).toEqual(['是']); await expect(input).toHaveValue('');
  await input.fill('中文输入正常\n第二行也可以继续输入\n第三行');
  await expect(input).toHaveCSS('resize', 'none'); await expect(input).toHaveCSS('outline-style', 'none'); expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(64); await expect(popup.locator('.ai-input-box').locator(':scope > *')).toHaveCount(1); await expect(popup.locator('.ai-composer-footer')).toContainText('Enter 发送 · Shift + Enter 换行'); await expect(popup.locator('.ai-answer-actions .ai-icon svg').first()).toHaveCSS('width', '16px'); await expect(popup.locator('.ai-input-box')).toHaveCSS('border-top-color', 'rgb(82, 115, 92)');
  await popup.locator('.ai-composer').screenshot({ path: '.tools/ai-input-fixed.png' });
  await popup.locator('.ai-question').screenshot({ path: '.tools/ai-panel-updated.png' });
});
