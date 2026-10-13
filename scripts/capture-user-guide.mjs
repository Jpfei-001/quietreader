import { chromium, expect } from '@playwright/test';
import JSZip from 'jszip';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 操作正式构建的界面；示例书自有，所有笔记通过界面创建，不读取真实用户资料。
const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.join(root, 'docs/使用指南/images');
const port = Number(process.env.GUIDE_CAPTURE_PORT ?? 1457);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('无效截图端口。');
await mkdir(folder, { recursive: true });
const zip = await JSZip.loadAsync(await readFile(path.join(root, 'public/demo/minimal.epub')));
const bookTitle = '把时间留给好书';
const labels = ['第一章 · 慢下来，读一页', '第二章 · 记录此刻的想法', '第三章 · 再读一次，发现不同'];
const paragraphs = [
  '一本书不必匆匆读完。让自己停在一页文字前，给阅读留出一段安静的时间，也给生活留一点空白。',
  '清晨的光落在书桌上，窗外的树影轻轻摇晃。合上手机，打开一本书，我们便拥有了一段属于自己的时光。',
  '读到一句打动自己的话，可以把它标记下来。下次重读时，也许会发现新的问题，或者为同一段文字写下不同的思考。',
  '好的阅读不是一场比赛。与其追赶页数，不如看清文字之间的联系，把自己真正理解的部分带回日常生活。',
  '有时，我们需要的不只是答案，还有提问的勇气。一份简单的读书笔记，能够提醒自己：曾经为什么停在这里，又想从这里走向哪里。',
];
let opf = await zip.file('OEBPS/content.opf').async('string');
opf = opf.replace(/<dc:title>.*?<\/dc:title>/, `<dc:title>${bookTitle}</dc:title>`).replace(/<dc:creator[^>]*>.*?<\/dc:creator>/, '<dc:creator>静读</dc:creator>');
zip.file('OEBPS/content.opf', opf);
zip.file('OEBPS/cover.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900"><rect width="600" height="900" fill="#e7eddf"/><path d="M36 0V900" stroke="#b5c4ab"/><text x="90" y="220" font-size="62" font-family="serif" fill="#42654e">把时间</text><text x="90" y="320" font-size="62" font-family="serif" fill="#42654e">留给好书</text><path d="M90 570L190 410L285 540L365 450L510 570Z" fill="#8fa486"/><text x="90" y="770" font-size="26" font-family="serif" fill="#52735c">静读 · 阅读示例</text></svg>');
for (let i = 0; i < labels.length; i++) zip.file(`OEBPS/chapter${i}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN"><head><title>${labels[i]}</title><link rel="stylesheet" href="style.css"/></head><body><h1>${labels[i]}</h1>${Array.from({ length: 25 }, (_, j) => `<p>${paragraphs[(i + j) % paragraphs.length]}</p>`).join('')}</body></html>`);
zip.file('OEBPS/nav.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol>${labels.map((label, i) => `<li><a href="chapter${i}.xhtml">${label}</a></li>`).join('')}</ol></nav></body></html>`);
const sample = await zip.generateAsync({ type: 'nodebuffer' });

const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, env: { ...process.env, QUIET_READER_DIAGNOSTICS_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; server.stdout.on('data', chunk => { logs += chunk; }); server.stderr.on('data', chunk => { logs += chunk; });
let browser;
try {
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`截图预览启动失败：${logs}`);
    try { const response = await fetch(origin); if (response.ok) break; } catch { /* 等待自己的预览服务。 */ }
    if (attempt === 99) throw new Error(`截图预览启动超时：${logs}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1, locale: 'zh-CN', acceptDownloads: true });
  let aiRequests = 0;
  // No credentials or paid API calls: these are explicit guide demonstrations.
  await context.route('https://api.deepseek.com/**', async route => {
    if (route.request().method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } }); return; }
    aiRequests++;
    const body = route.request().postDataJSON();
    const answer = '【操作示例回答】\n\n**这段话的意思**：阅读不必追赶页数，更重要的是理解文字并记录自己的思考。\n\n**可以这样做**：读到触动自己的句子，先写下问题，再回到原文核实理解。这是截图演示内容，不是实际服务请求。';
    await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: body.stream ? 'text/event-stream' : 'application/json', body: body.stream ? `data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n` : JSON.stringify({ choices: [{ message: { content: '连接成功' } }] }) });
  });
  await context.addInitScript(() => { if (!location.search.includes('ai-assistant')) localStorage.setItem('quiet-reader:ai-preferences:v1', JSON.stringify({ version: 1, model: 'deepseek-chat', preferredMode: 'floating' })); });
  const page = await context.newPage();
  const brand = (await readFile(path.join(root, 'src/assets/brand-pine-seal.png'))).toString('base64');
  const coverPage = await context.newPage();
  await coverPage.setViewportSize({ width: 900, height: 1350 });
  await coverPage.setContent(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><style>*{box-sizing:border-box}html,body{margin:0;width:900px;height:1350px;background:#eef1e6;font-family:"Noto Serif CJK SC",SimSun,serif}.cover{height:100%;position:relative;padding:100px 100px 80px;border-left:26px solid #47664f}.brand{display:flex;align-items:center;gap:20px;color:#47664f;font-size:36px}.brand img{width:80px;height:80px}.brand small{font-family:sans-serif;font-size:12px;letter-spacing:6px;display:block;margin-top:8px}.line{width:54px;height:3px;background:#b79b67;margin:82px 0 30px}.title{font-size:92px;line-height:1.5;letter-spacing:5px;color:#35513e}.subtitle{font-family:sans-serif;font-size:24px;letter-spacing:4px;color:#77886e;margin-top:26px}.book{margin-top:105px}.footer{position:absolute;bottom:80px;left:100px;font-size:22px;letter-spacing:3px;color:#62785c}.tag{font-size:16px;letter-spacing:4px;color:#85967c;margin-bottom:24px}</style></head><body><div class="cover"><div class="brand"><img src="data:image/png;base64,${brand}"/><div>静读<small>QUIET READER</small></div></div><div class="line"></div><div class="tag">随书使用 · 图文指南</div><div class="title">静读<br/>操作指南</div><div class="subtitle">阅读 · 标注 · AI 助手 · 备份</div><svg class="book" width="520" height="220" viewBox="0 0 520 220"><path d="M260 45C202 14 129 12 65 29V161C137 143 199 149 260 188C321 149 383 143 455 161V29C391 12 318 14 260 45Z" fill="#e1e8d8" stroke="#7d9874" stroke-width="5" stroke-linejoin="round"/><path d="M260 47V186" stroke="#7d9874" stroke-width="5"/><path d="M100 60C145 56 189 66 226 85M100 95C145 91 189 101 226 120M294 85C331 66 375 56 420 60M294 120C331 101 375 91 420 95" fill="none" stroke="#a7b69a" stroke-width="4" stroke-linecap="round"/></svg><div class="footer">给文字留一点空白。</div></div></body></html>`);
  await coverPage.evaluate(() => document.fonts.ready); await coverPage.screenshot({ path: path.join(folder, '00-cover.png') }); await coverPage.close();

  async function capture(name, locator, clip) {
    await page.mouse.move(2, 2);
    await page.waitForTimeout(260);
    await page.evaluate(() => document.fonts.ready);
    for (const frame of page.frames().slice(1)) await frame.evaluate(() => document.fonts.ready.then(() => {}));
    await expect(page.locator('.error-banner,.note-error')).toHaveCount(0);
    await (locator ?? page).screenshot({ path: path.join(folder, name), animations: 'disabled', ...(locator ? {} : clip ? { clip } : { fullPage: true }) });
    console.log(`已拍摄 ${name}`);
  }
  async function selectParagraph(index = 0) {
    const toolbar = page.getByRole('region', { name: '选文工具条' });
    if (await toolbar.isVisible()) await page.getByRole('button', { name: '关闭选文工具条' }).click();
    await page.frameLocator('.reader-viewport iframe').first().locator('p').nth(index).evaluate(p => {
      const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
      const selection = p.ownerDocument.defaultView.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await expect(toolbar).toBeVisible(); return toolbar;
  }
  await page.goto(origin);
  await expect(page.getByRole('button', { name: '使用指南', exact: true })).toBeEnabled();
  await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: '把时间留给好书.epub', mimeType: 'application/epub+zip', buffer: sample });
  await expect(page.locator('.book-title')).toHaveText(bookTitle);
  await expect(page.locator('.reading-progress')).toContainText('章');
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await expect(page.getByRole('heading', { name: '我的书架', exact: true })).toBeVisible();
  await capture('01-bookshelf.png');
  await page.getByRole('button', { name: `阅读 ${bookTitle}`, exact: true }).click();
  await expect(page.locator('.reader-viewport iframe')).toHaveCount(1);
  await expect(page.frameLocator('.reader-viewport iframe').first().locator('h1')).toBeVisible();
  await capture('02-reading.png');
  await page.getByRole('button', { name: '目录', exact: true }).click();
  const panelBox = await page.locator('.contents-panel').boundingBox();
  const navBox = await page.locator('.chapter-list').boundingBox();
  await capture('03-contents.png', undefined, { x: panelBox.x, y: panelBox.y, width: panelBox.width, height: navBox.y + navBox.height - panelBox.y + 24 });
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click(); await capture('04-settings.png');
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole('button', { name: '进入专注模式' }).click(); await capture('05-focus.png');
  await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 820 });
  await expect(page.frameLocator('.reader-viewport iframe').first().locator('p').first()).toBeVisible();
  const toolbar = await selectParagraph();
  await toolbar.getByRole('button', { name: '波浪线', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: '波浪线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await toolbar.getByRole('button', { name: '绿色高亮', exact: true }).click();
  await expect(toolbar.getByRole('button', { name: '绿色高亮', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await capture('06-selection.png', toolbar);
  await toolbar.getByRole('button', { name: '思考', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '写思考', exact: true });
  await editor.getByLabel('思考正文').fill('阅读不是追赶页数，而是在文字里找到自己的节奏。下次重读这一段时，我想看看自己是否仍有同样的感受。');
  await expect(editor.getByRole('status')).toHaveText('草稿已保存');
  await capture('07-thought.png', editor);
  await editor.getByRole('button', { name: '保存并收起', exact: true }).click(); await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await page.getByRole('button', { name: '我的笔记', exact: true }).click();
  await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toBeVisible();
  await expect(page.locator('.annotation-card')).toHaveCount(1);
  await page.locator('.annotation-card summary').click(); await capture('08-notebook.png');
  await page.getByRole('button', { name: '调整摘录', exact: true }).click();
  const adjust = page.getByRole('dialog', { name: '调整已有摘录', exact: true });
  await expect(adjust).toBeVisible(); await adjust.getByLabel('摘录标题').fill('把阅读留给自己');
  await capture('09-adjust.png', adjust);
  await adjust.getByRole('button', { name: '保存调整', exact: true }).click(); await expect(adjust).toHaveCount(0);
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await page.getByRole('button', { name: '我的笔记', exact: true }).click();
  await page.getByRole('button', { name: '导出全部', exact: true }).click();
  const exporting = page.getByRole('dialog', { name: '导出笔记', exact: true });
  await exporting.getByLabel('导出格式').selectOption('json');
  await expect(exporting.getByRole('button', { name: '下载 JSON', exact: true })).toBeEnabled();
  await capture('10-export.png', exporting);
  const downloadPromise = page.waitForEvent('download'); await exporting.getByRole('button', { name: '下载 JSON', exact: true }).click();
  const download = await downloadPromise; const backupFile = await download.path();
  await exporting.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '导入 JSON 备份', exact: true }).click();
  const restore = page.getByRole('dialog', { name: '恢复 JSON 备份', exact: true });
  await restore.getByLabel('选择笔记 JSON 备份').setInputFiles(backupFile);
  await expect(restore.getByRole('button', { name: '确认恢复', exact: true })).toBeEnabled();
  await capture('11-restore.png', restore);
  await restore.getByRole('button', { name: '关闭恢复 JSON 备份', exact: true }).click();
  await page.getByRole('button', { name: '返回书架', exact: true }).click();
  await page.getByRole('button', { name: `删除 ${bookTitle}`, exact: true }).click();
  const deleting = page.getByRole('alertdialog'); await capture('12-delete.png', deleting);
  await deleting.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: `阅读 ${bookTitle}`, exact: true }).click();
  await expect(page.frameLocator('.reader-viewport iframe').first().locator('p').first()).toBeVisible();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('textbox', { name: 'API Key', exact: true }).fill('sk-guide-example-not-a-real-key');
  await page.getByRole('button', { name: '测试连接', exact: true }).click(); await expect(page.locator('.ai-setting-status')).toContainText('连接成功');
  await page.getByRole('button', { name: '保存配置', exact: true }).click(); await expect(page.locator('.ai-setting-status')).toContainText('AI 配置已保存');
  await expect(page.locator('#ai-key')).toHaveValue('');
  await page.locator('.ai-settings').scrollIntoViewIfNeeded(); await capture('13-ai-settings.png', page.locator('.ai-settings'));
  await page.getByRole('button', { name: '关闭面板', exact: true }).click();
  await selectParagraph(); await page.getByRole('button', { name: '问 AI', exact: true }).click(); await expect(page.locator('.ai-floating')).toBeVisible();
  await page.getByRole('button', { name: '通俗解读', exact: true }).click(); await expect(page.locator('.ai-answer-actions small')).toContainText('已完成');
  await selectParagraph(1); await page.getByRole('button', { name: '问 AI', exact: true }).click(); await expect(page.getByRole('group', { name: '引用 2', exact: true })).toBeVisible();
  await page.locator('.ai-messages').evaluate(el => { el.scrollTop = 0; });
  await capture('14-ai-question.png', page.locator('.ai-floating'));
  await page.getByRole('button', { name: '保存为思考', exact: true }).click(); await expect(editor).toBeVisible(); await expect(editor.getByLabel('思考正文')).toHaveValue(/操作示例回答/);
  await expect(editor.getByRole('status')).toHaveText('草稿已保存'); await capture('15-ai-save-thought.png', editor);
  await editor.getByRole('button', { name: '保存并收起', exact: true }).click(); await expect(page.getByRole('button', { name: '已保存为思考', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '关闭 AI 助手', exact: true }).click();
  await writeFile(path.join(root, '.tools/user-guide-capture.json'), JSON.stringify({ source: 'production-preview', screenshots: 15, sample: '自有阅读示例，笔记经界面创建', aiResponses: '明确标注的模拟回答，虚拟密钥，未发真实服务请求', mockedAiRequests: aiRequests, realPaidApiRequests: 0, origin, capturedAt: new Date().toISOString() }, null, 2));
  console.log('正式界面的 15 张操作截图和指南封面已生成；AI 为模拟回答，无真实付费请求。');
} finally {
  await browser?.close();
  if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
}
