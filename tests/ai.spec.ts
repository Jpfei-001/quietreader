import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForBook, savedCfi, openNotesPage } from './helpers';
async function open(page: Page) { await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page); }
async function select(page: Page, index = 0) {
  await page.frameLocator('.reader-viewport iframe').first().locator('p').nth(index).evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p); const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible();
}
async function configure(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('sk-ai-test-not-a-real-key');
  await page.getByRole('button', { name: '测试连接', exact: true }).click(); await expect(page.locator('.ai-setting-status')).toContainText('连接成功');
  await page.getByRole('button', { name: '保存配置', exact: true }).click(); await expect(page.locator('.ai-setting-status')).toContainText('AI 配置已保存');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
}
test('真实选文、连接测试、问答、悬浮／独立模式和思考确认；阅读正文与 CFI 不变', async ({ page, context }) => {
  await page.addInitScript(() => { if (!location.search.includes('ai-assistant')) localStorage.setItem('quiet-reader:ai-preferences:v1', JSON.stringify({ version: 1, model: 'deepseek-chat', preferredMode: 'detached' })); });
  const sent: { model: string; stream: boolean; thinking: { type: string }; messages: { role: string; content: string }[] }[] = [];
  await context.route('https://api.deepseek.com/**', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }); return; }
    const body = route.request().postDataJSON(); sent.push(body);
    await route.fulfill({ status: 200, contentType: body.stream ? 'text/event-stream' : 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body.stream ? `data: ${JSON.stringify({ choices: [{ delta: { content: '这是用于测试的解释。\n\n**关键点**：认知与行为不一致。\n![远程图片](https://tracking.invalid/pixel)' }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` : JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }) });
  });
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page); await configure(page);
  const initial = await savedCfi(page), reader = await page.locator('.reading-space').boundingBox(), body = page.frameLocator('.reader-viewport iframe').first().locator('body'); const original = await body.innerHTML();
  await select(page); const popupEvent = page.waitForEvent('popup'); await page.getByRole('button', { name: '问 AI', exact: true }).click(); let popup = await popupEvent;
  await expect(popup.getByRole('region', { name: 'AI 阅读助手', exact: true })).toBeVisible(); await expect(page.locator('.reading-space')).toHaveCount(1); expect(await page.locator('.reading-space').boundingBox()).toEqual(reader);
  await popup.getByLabel('助手呈现模式').selectOption('floating'); await expect(page.locator('.ai-floating')).toBeVisible();
  await expect(page.getByRole('button', { name: /我已了解/ })).toHaveCount(0); await expect(page.getByRole('button', { name: '解释术语', exact: true })).toBeEnabled(); expect(sent.filter(b => b.stream)).toHaveLength(0);
  await page.getByRole('button', { name: '解释术语', exact: true }).click();
  await expect(page.locator('.ai-answer-actions small')).toContainText('deepseek-chat · 已完成'); expect(sent.filter(b => b.stream)).toHaveLength(1); expect(sent[1].messages).toHaveLength(3); expect(sent[1].thinking.type).toBe('disabled'); await expect(page.locator('.ai-answer img')).toHaveCount(0); await expect(page.getByLabel('默认模型')).toHaveCount(0);
  await page.getByLabel('向 AI 提问').fill('待发送的问题'); const floating = page.locator('.ai-floating'), before = (await floating.boundingBox())!;
  await floating.locator('.ai-heading h2').hover(); await page.mouse.down(); await page.mouse.move(before.x - 90, before.y + 80); await page.mouse.up(); expect((await floating.boundingBox())!.x).not.toBe(before.x);
  await page.getByRole('button', { name: '收起悬浮窗', exact: true }).click(); await expect(page.getByRole('button', { name: '展开' })).toBeVisible(); await page.getByRole('button', { name: '展开' }).click(); await expect(page.getByLabel('向 AI 提问')).toHaveValue('待发送的问题');
  const reopened = page.waitForEvent('popup'); await page.getByLabel('助手呈现模式').selectOption('detached'); popup = await reopened; await expect(popup.getByLabel('向 AI 提问')).toHaveValue('待发送的问题'); await expect(popup.locator('.ai-answer-actions small')).toContainText('deepseek-chat'); expect(sent.filter(b => b.stream)).toHaveLength(1);
  const oldQuote = await popup.locator('.ai-quote p').innerText(); await select(page, 1); await page.getByRole('button', { name: '问 AI', exact: true }).click(); await expect(popup.getByRole('group', { name: '引用 1', exact: true })).toContainText(oldQuote); await expect(popup.getByRole('group', { name: '引用 2', exact: true })).toContainText('第 2 段。'); await expect(popup.locator('.ai-reference-group')).toHaveCount(2); await expect(popup.locator('.ai-reference-group').first().locator('.ai-turn')).toHaveCount(1); await expect(popup.getByRole('button', { name: '新建提问' })).toHaveCount(0);
  await popup.getByRole('button', { name: '保存为思考', exact: true }).click(); await expect(page.getByLabel('思考正文')).toHaveValue(/AI 辅助生成/);
  await page.getByRole('button', { name: '保存并收起', exact: true }).click(); await expect(popup.getByRole('button', { name: '已保存为思考', exact: true })).toBeDisabled(); expect(await savedCfi(page)).toBe(initial); expect(await body.innerHTML()).toBe(original); expect(await page.locator('.reading-space').boundingBox()).toEqual(reader);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })); expect(storage).not.toContain('sk-ai-test');
  await popup.getByRole('button', { name: '关闭 AI 助手', exact: true }).click(); await openNotesPage(page); await expect(page.locator('.note-counts')).toContainText('思考 1 条'); await page.getByText('展开思考（1）', { exact: true }).click(); await expect(page.locator('.thought-entry')).toContainText('来源：DeepSeek · deepseek-chat'); await expect(page.locator('.annotation-card')).toContainText('第 1 段。');
});

test('桌面扩展仅增加外窗宽度，正文宽度、双栏、目录和分页位置不变（公开 API 模拟）', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.exposeFunction('resizeAiTestWindow', async (width: number) => { await page.setViewportSize({ width, height: 900 }); });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    let expanded = false; const callbacks = new Map<string, Set<(event: { payload: unknown }) => void>>();
    window.__TAURI__ = {
      core: { invoke: async (command: string) => {
        if (command === 'ai_window_expand') { expanded = true; await (window as unknown as { resizeAiTestWindow(width: number): Promise<void> }).resizeAiTestWindow(1320); return { expanded: true, originalWidth: 900, originalHeight: 900 }; }
        if (command === 'ai_window_restore') { expanded = false; await (window as unknown as { resizeAiTestWindow(width: number): Promise<void> }).resizeAiTestWindow(900); return; }
        if (command === 'ai_expansion_fits') return expanded;
        if (command === 'ai_key_status') return false;
        if (command === 'ai_detached_hide') return;
        throw new Error('未模拟的命令');
      } },
      event: { listen: async (name: string, callback: (event: { payload: unknown }) => void) => { const listeners = callbacks.get(name) ?? new Set(); callbacks.set(name, listeners); listeners.add(callback); return () => listeners.delete(callback); }, emitTo: async () => {} },
      window: { getCurrentWindow: () => ({ isMaximized: async () => false, setBackgroundColor: async () => {}, onResized: async () => () => {}, onCloseRequested: async () => () => {}, minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, destroy: async () => {} }) },
    } as never;
  });
  await open(page); await page.getByRole('button', { name: '目录', exact: true }).click(); await page.getByRole('button', { name: '固定目录', exact: true }).click(); await expect(page.locator('.contents-dock')).toBeVisible();
  const cfi = await savedCfi(page), box = await page.locator('.reading-space').boundingBox(), columns = await page.locator('.reading-space').getAttribute('data-columns');
  await select(page); await page.getByRole('button', { name: '问 AI', exact: true }).click(); await expect(page.locator('.ai-expanded-panel')).toBeVisible(); await expect(page.locator('.app')).toHaveCSS('width', '900px');
  expect(await page.locator('.reading-space').boundingBox()).toEqual(box); expect(await page.locator('.reading-space').getAttribute('data-columns')).toBe(columns); expect(await savedCfi(page)).toBe(cfi); await expect(page.getByRole('navigation', { name: '章节导航' })).toBeVisible();
  await page.getByLabel('助手呈现模式').selectOption('floating'); await expect(page.locator('.ai-floating')).toBeVisible(); expect(await page.locator('.reading-space').boundingBox()).toEqual(box); expect(await savedCfi(page)).toBe(cfi); await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  expect(await page.evaluate(() => innerWidth)).toBe(900);
});
