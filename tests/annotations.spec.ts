import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForBook, savedCfi, openNotesPage, resumeReading } from './helpers';
async function selectParagraph(page: Page, count = 1) {
  if (await page.getByRole('main', { name: '我的笔记', exact: true }).isVisible()) await resumeReading(page);
  await page.frameLocator('.reader-viewport iframe').first().locator('body').evaluate((body, count) => {
    const paragraphs = body.querySelectorAll('p'); const range = body.ownerDocument.createRange();
    range.setStart(paragraphs[0].firstChild!, 0); range.setEnd(paragraphs[count-1].lastChild!, paragraphs[count-1].lastChild!.textContent!.length);
    const selection = body.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  }, count);
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible();
}
async function openSample(page: Page) { await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page); }
async function append(page: Page, text: string) { await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByLabel('思考正文').fill(text); await page.getByRole('button', { name: '保存并收起', exact: true }).click(); await expect(page.getByRole('dialog', { name: '写思考', exact: true })).toHaveCount(0); }

test('真实 iframe 选文、独立 toggle、三次思考、第二次编辑删除与第四次、定位和导出恢复', async ({ page }) => {
  await openSample(page); const cfi = await savedCfi(page);
  await selectParagraph(page,2);
  await page.getByRole('button', { name: '波浪线', exact: true }).click();
  await expect(page.getByRole('button', { name: '波浪线', exact: true })).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button', { name: '粉色高亮', exact: true }).click();
  await expect(page.getByRole('button', { name: '书签', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '粉色高亮', exact: true })).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button', { name: '波浪线', exact: true }).click();
  await expect(page.getByRole('button', { name: '波浪线', exact: true })).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('button', { name: '粉色高亮', exact: true })).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button', { name: '虚线', exact: true }).click();
  await append(page,'第一次 <script>不是 HTML</script> `反引号`');
  await selectParagraph(page,2); await append(page,'第二次');
  await selectParagraph(page,2); await append(page,'第三次');
  expect(await savedCfi(page)).toBe(cfi);
  await openNotesPage(page);
  await expect(page.locator('.note-counts')).toContainText('摘录 1');
  await expect(page.locator('.note-counts')).toContainText('思考 3 条');
  await page.getByText('展开思考（3）',{exact:true}).click();
  await page.locator('.thought-entry').nth(1).getByRole('button', { name: '编辑', exact:true }).click();
  await page.getByLabel('思考正文').fill('只修改第二次');
  await page.getByRole('button', { name: '保存并收起', exact:true }).click();
  await openNotesPage(page);
  await page.getByText('展开思考（3）',{exact:true}).click();
  await expect(page.locator('.thought-entry').nth(0)).toContainText('第一次');
  await expect(page.locator('.thought-entry').nth(1)).toContainText('只修改第二次');
  await page.locator('.thought-entry').nth(1).getByRole('button', { name: '删除', exact:true }).click();
  await page.getByRole('button', { name: '确认删除', exact:true }).click();
  await expect(page.locator('.note-counts')).toContainText('思考 2 条');
  await page.getByRole('button', { name: '追加思考', exact:true }).click();
  await page.getByLabel('思考正文').fill('第四次');
  await page.getByRole('button', { name: '保存并收起', exact:true }).click();
  await openNotesPage(page);
  await page.getByText('展开思考（3）',{exact:true}).click();
  await expect(page.locator('.thought-entry').last()).toContainText('第 4 次思考');
  await page.getByRole('button', { name: '导出此段', exact:true }).click();
  await page.getByLabel('导出格式').selectOption('json');
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 JSON', exact:true }).click();
  const download = await downloadEvent; const backupPath = test.info().outputPath('notes.json'); await download.saveAs(backupPath);
  await page.getByRole('button', { name: '关闭导出笔记' }).click();
  await page.getByRole('button', { name: '导入 JSON 备份' }).click();
  await page.getByLabel('选择笔记 JSON 备份').setInputFiles(backupPath);
  await expect(page.getByRole('dialog', { name: '恢复 JSON 备份' })).toContainText('重复 1');
  await page.getByRole('button', { name: '确认恢复' }).click();
  await expect(page.locator('.note-counts')).toContainText('思考 3 条');
  await page.getByRole('button', { name: '回到原文', exact:true }).click();
  await expect(page.getByRole('main', { name:'我的笔记',exact:true })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('草稿保护恢复、长弹框窄屏与独立页面、自动线取消不补回、归档笔记', async ({ page }) => {
  await page.setViewportSize({width:390,height:844}); await openSample(page);
  await selectParagraph(page); await page.getByRole('button',{name:'思考',exact:true}).click();
  const editor = page.getByRole('dialog',{name:'写思考',exact:true});
  await expect(editor.locator('blockquote')).toHaveCount(0);
  await page.getByLabel('思考正文').fill('长思考\n'.repeat(30));
  await expect(editor).toContainText('草稿已保存');
  expect(await editor.locator('textarea').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.keyboard.press('Escape'); await expect(editor).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'有未保存修改'})).toHaveCount(0);
  await page.reload(); await page.getByRole('button',{name:'阅读 静读 · 给文字留一点空白',exact:true}).click(); await waitForBook(page);
  await page.getByRole('button',{name:/有 1 份本机草稿/}).click();
  await page.getByText('本机草稿（不计入正式思考）',{exact:true}).click();
  await page.getByRole('button',{name:'恢复草稿',exact:true}).click();
  await expect(page.getByLabel('思考正文')).toHaveValue('长思考\n'.repeat(30));
  await page.getByRole('button',{name:'保存并收起',exact:true}).click();
  await selectParagraph(page);
  await expect(page.getByRole('button',{name:'实线',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'实线',exact:true}).click();
  await append(page,'再次追加不补线'); await selectParagraph(page);
  await expect(page.getByRole('button',{name:'实线',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('button',{name:'更多操作'})).toHaveCount(0);
  await openNotesPage(page);
  await page.getByRole('button',{name:'调整摘录',exact:true}).click();
  await page.getByLabel('摘录标题').fill('自拟标题'); await page.getByRole('button',{name:'保存调整'}).click();
  await openNotesPage(page); await expect(page.locator('.annotation-card h3')).toHaveText('自拟标题');
  await resumeReading(page);
  await page.screenshot({path:'docs/images/标注成品-窄屏.png',fullPage:true});
  await page.getByRole('button',{name:'静读，返回首页'}).click();
  await page.getByRole('button',{name:'删除 静读 · 给文字留一点空白',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:/一并清理笔记/})).not.toBeChecked();
  await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await page.getByRole('button',{name:'我的笔记',exact:true}).click();
  await expect(page.locator('.annotation-card')).toContainText('原书未载入');
  await expect(page.getByRole('button',{name:'回到原文',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'追加思考',exact:true}).click(); await page.getByLabel('思考正文').fill('归档也可追加'); await page.getByRole('button',{name:'保存并收起',exact:true}).click();
  await openNotesPage(page); await expect(page.locator('.note-counts')).toContainText('思考 3 条');
});

test('hover 原文、卡内停留、键盘角标与三主题单双栏 320px，不改变正文结构或 CFI', async ({ page }) => {
  await page.setViewportSize({width:1440,height:900}); await openSample(page);
  const initial = await savedCfi(page);
  const body = page.frameLocator('.reader-viewport iframe').first().locator('body');
  const original = await body.innerHTML();
  await selectParagraph(page); await append(page,'悬浮回看');
  // A real click clears native selection; the transparent drawing does not intercept drag/click.
  const paragraph = page.frameLocator('.reader-viewport iframe').first().locator('p').first();
  await paragraph.click({position:{x:40,y:8}});
  await paragraph.hover({position:{x:60,y:8}});
  await expect(page.getByRole('region',{name:'思考预览'})).toBeVisible();
  await page.getByRole('region',{name:'思考预览'}).hover();
  await page.waitForTimeout(350); await expect(page.getByRole('region',{name:'思考预览'})).toBeVisible();
  await page.getByRole('button',{name:'关闭思考预览'}).click();
  const marker = page.getByRole('button',{name:'打开摘录，思考 1 条',exact:true});
  await marker.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('region',{name:'思考预览'})).toContainText('悬浮回看');
  await page.keyboard.press('Escape');
  expect(await body.innerHTML()).toBe(original);
  for (const theme of ['深色','护眼','明亮']) {
    await page.getByRole('button',{name:'设置',exact:true}).click(); await page.getByRole('button',{name:theme,exact:true}).click(); await page.keyboard.press('Escape');
    await expect(page.locator('.annotation-drawing line')).toHaveCount(2);
    await marker.click(); await expect(page.getByRole('region',{name:'思考预览'})).toContainText('悬浮回看'); await page.screenshot({path:`docs/images/标注成品-${theme}.png`,fullPage:true}); await page.keyboard.press('Escape');
  }
  await selectParagraph(page); await page.getByRole('button',{name:'思考',exact:true}).click();
  await page.getByLabel('思考正文').fill('长内容\n'.repeat(9));
  await page.screenshot({path:'docs/images/标注成品-思考编辑.png',fullPage:true});
  expect(await savedCfi(page)).toBe(initial);
  await page.getByRole('button',{name:'关闭思考',exact:true}).click();
  await expect(page.getByLabel('思考正文')).toHaveCount(0);
  await page.setViewportSize({width:320,height:720});
  await expect(page.locator('.reading-space')).toHaveAttribute('data-columns','1');
  await selectParagraph(page);
  const toolbar = page.getByRole('region',{name:'选文工具条'});
  const box = await toolbar.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x+box!.width).toBeLessThanOrEqual(320);
  await page.screenshot({path:'docs/images/标注成品-320px.png',fullPage:true});
  await page.getByRole('button',{name:'关闭选文工具条'}).click();
  await openNotesPage(page);
  await page.screenshot({path:'docs/images/标注成品-笔记.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('思考保存失败保留输入、离开自动保留草稿、整段删除撤销', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    (window as unknown as { failThought: boolean }).failThought = true;
    IDBObjectStore.prototype.put = function(value,key) {
      if (this.name==='thoughts' && (window as unknown as {failThought:boolean}).failThought) throw new DOMException('空间不足','QuotaExceededError');
      return key === undefined ? put.call(this,value) : put.call(this,value,key);
    };
  });
  await openSample(page); await selectParagraph(page); await page.getByRole('button',{name:'思考',exact:true}).click();
  await page.getByLabel('思考正文').fill('存储失败也保留输入'); await page.getByRole('button',{name:'保存并收起',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'写思考',exact:true})).toBeVisible(); await expect(page.getByLabel('思考正文')).toHaveValue('存储失败也保留输入');
  await expect(page.getByRole('dialog',{name:'写思考',exact:true}).getByRole('alert')).toContainText('QuotaExceededError');
  await expect(page.getByRole('button',{name:'保存并收起',exact:true})).toBeEnabled();
  await page.evaluate(()=>{(window as unknown as {failThought:boolean}).failThought=false;});
  await page.getByRole('button',{name:'目录',exact:true}).click();
  await expect(page.getByLabel('思考正文')).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'有未保存修改'})).toHaveCount(0);
  await page.getByRole('button',{name:'关闭面板'}).click();
  await page.getByRole('button',{name:/有 1 份本机草稿/}).click();
  await page.getByText('本机草稿（不计入正式思考）',{exact:true}).click();
  await page.getByRole('button',{name:'恢复草稿',exact:true}).click();
  await expect(page.getByLabel('思考正文')).toHaveValue('存储失败也保留输入');
  await page.getByRole('button',{name:'保存并收起',exact:true}).click();
  await openNotesPage(page); await page.getByRole('button',{name:'删除整条摘录',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'删除整条摘录',exact:true})).toContainText('1 条思考');
  await page.getByRole('button',{name:'确认删除',exact:true}).click(); await expect(page.locator('.note-counts')).toContainText('摘录 0');
  await page.getByRole('button',{name:'撤销',exact:true}).click(); await expect(page.locator('.note-counts')).toContainText('摘录 1'); await expect(page.locator('.note-counts')).toContainText('思考 1 条');
  await page.getByRole('button',{name:'追加思考',exact:true}).click(); await page.getByLabel('思考正文').fill('外点保护');
  await page.getByRole('heading', { name: '我的笔记', exact: true }).click();
  await expect(page.getByRole('dialog',{name:'写思考',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'有未保存修改'})).toHaveCount(0);
  await page.getByText('本机草稿（不计入正式思考）',{exact:true}).click();
  await expect(page.locator('.draft-list')).toContainText('外点保护');
});

test('Markdown/ZIP 真下载、冲突恢复选择、恶意 JSON 拒绝、未知书不按同名绑定', async ({ page }) => {
  const { readFile } = await import('node:fs/promises'); const { default: JSZip } = await import('jszip');
  await openSample(page); await selectParagraph(page); await append(page,'HTML <b>纯文本</b> 和 `反引号`');
  await openNotesPage(page); await page.getByRole('button',{name:'导出此段',exact:true}).click();
  await page.getByLabel('导出格式').selectOption('zip');
  const zipEvent = page.waitForEvent('download'); await page.getByRole('button',{name:'下载 ZIP',exact:true}).click(); const zipPath=test.info().outputPath('notes.zip'); await (await zipEvent).saveAs(zipPath);
  const zip=await JSZip.loadAsync(await readFile(zipPath)); expect(Object.keys(zip.files)).toEqual(['静读笔记.md','静读笔记.json']);
  const markdown=await zip.file('静读笔记.md')!.async('string'); expect(markdown).toContain('&lt;b&gt;'); expect(markdown).toContain('\\`反引号\\`');
  const text=await zip.file('静读笔记.json')!.async('string'); const backup=JSON.parse(text);
  await page.getByRole('button',{name:'关闭导出笔记'}).click();
  const restore = async (value:unknown) => { await page.getByRole('button',{name:'导入 JSON 备份'}).click(); await page.getByLabel('选择笔记 JSON 备份').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))}); };
  backup.thoughts[0].text='恢复冲突的新文本'; await restore(backup);
  await expect(page.getByRole('button',{name:'确认恢复'})).toBeDisabled(); await page.getByRole('radio',{name:'使用恢复版本',exact:true}).check(); await page.getByRole('button',{name:'确认恢复'}).click();
  await page.getByText('展开思考（1）',{exact:true}).click(); await expect(page.locator('.thought-entry')).toContainText('恢复冲突的新文本');
  const malicious=structuredClone(backup); malicious.annotations[0].line.color='url(javascript:alert(1))'; await restore(malicious);
  await expect(page.getByRole('dialog',{name:'恢复 JSON 备份'}).getByRole('alert')).toContainText('颜色'); await page.getByRole('button',{name:'关闭恢复 JSON 备份'}).click();
  const unknown=structuredClone(backup); unknown.annotations[0].bookId='b'.repeat(64); unknown.annotations[0].anchorKey=unknown.annotations[0].bookId+'|'+unknown.annotations[0].locator.rangeCfi; unknown.annotations[0].id='unknown-book-annotation'; unknown.thoughts[0].annotationId='unknown-book-annotation'; unknown.thoughts[0].id='unknown-book-thought'; unknown.thoughts[0].bookId='b'.repeat(64);
  await restore(unknown); await expect(page.getByRole('dialog',{name:'恢复 JSON 备份'})).toContainText('新增 1'); await page.getByRole('button',{name:'确认恢复'}).click();
  await page.getByLabel('笔记范围').selectOption('all'); await expect(page.locator('.annotation-card')).toHaveCount(2); await expect(page.locator('.archive-label')).toHaveCount(1);
  await expect(page.locator('.annotation-card').filter({has:page.locator('.archive-label')}).getByRole('button',{name:'回到原文',exact:true})).toBeDisabled();
});

test('跨书笔记定位真实切书、搜索分类计数及显式连书清理', async ({ page }) => {
  await openSample(page); await selectParagraph(page); await page.getByRole('button',{name:'粉色高亮',exact:true}).click(); await append(page,'第一本书的思考');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/epub2.epub')); await waitForBook(page,'静读 · EPUB 2 样书'); await selectParagraph(page); await append(page,'第二本书的思考');
  await openNotesPage(page); await page.getByLabel('笔记范围').selectOption('all'); await expect(page.locator('.note-counts')).toContainText('摘录 2');
  await page.getByLabel('笔记分类').selectOption('highlight'); await expect(page.locator('.annotation-card')).toHaveCount(1);
  await page.getByLabel('搜索笔记').fill('第一本'); await expect(page.locator('.note-counts')).toContainText('思考 1 条'); await page.getByRole('button',{name:'回到原文',exact:true}).click(); await waitForBook(page);
  await expect(page.getByRole('alert')).toHaveCount(0); await page.getByRole('button',{name:'静读，返回首页'}).click(); await page.getByRole('button',{name:'删除 静读 · 给文字留一点空白',exact:true}).click();
  await page.getByRole('checkbox',{name:/一并清理笔记/}).check(); await page.getByRole('button',{name:'确认删除',exact:true}).click(); await page.getByRole('button',{name:'我的笔记',exact:true}).click(); await expect(page.locator('.note-counts')).toContainText('摘录 1'); await expect(page.locator('.archive-label')).toHaveCount(0);
});

test('同章节跨 CSS 栏完整快照、重分页重新画与窄屏当前色点取消独立于展开色板', async ({ page }) => {
  await page.setViewportSize({width:1440,height:900}); await openSample(page);
  await selectParagraph(page,8); await page.getByRole('button',{name:'波浪线',exact:true}).click(); await page.getByRole('button',{name:'蓝色高亮',exact:true}).click();
  await expect(page.getByRole('button',{name:'蓝色高亮',exact:true})).toHaveAttribute('aria-pressed','true'); await page.screenshot({path:'docs/images/标注成品-双栏.png',fullPage:true});
  await openNotesPage(page); await expect(page.locator('.annotation-card blockquote')).toContainText('第 8 段');
  const text=await page.locator('.annotation-card blockquote').innerText(); expect(text.split('\n')).toHaveLength(8);
  await resumeReading(page); await page.setViewportSize({width:320,height:720});
  await expect(page.locator('.reading-space')).toHaveAttribute('data-columns','1');
  await expect(page.locator('.annotation-drawing path').first()).toBeVisible();
  await selectParagraph(page,8);
  const current=page.getByRole('button',{name:'蓝色高亮',exact:true}); await expect(current).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'展开高亮色板'}).click(); await expect(current).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'粉色高亮选项',exact:true}).click(); await expect(page.getByRole('button',{name:'粉色高亮',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'粉色高亮',exact:true}).click(); await expect(page.getByRole('button',{name:'选择高亮颜色',exact:true})).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('button',{name:'波浪线',exact:true})).toHaveAttribute('aria-pressed','true');
  await openNotesPage(page); await page.getByRole('button',{name:'导出此段',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'导出笔记'})).toContainText('当前 1 段摘录');
});

test('鼠标真实拖选保存与键盘浮条动作、iframe 安全边界保持', async ({ page }) => {
  await openSample(page);
  const paragraph=page.frameLocator('.reader-viewport iframe').first().locator('p').first();
  const box=await paragraph.boundingBox();
  // Playwright's HTML drag detector injects a timer into every frame; sandboxed EPUBs forbid that timer.
  // CDP delivers the same native mouse input without injecting script or changing the sandbox.
  const input=await page.context().newCDPSession(page);
  await input.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:box!.x+3,y:box!.y+8});
  await input.send('Input.dispatchMouseEvent',{type:'mousePressed',x:box!.x+3,y:box!.y+8,button:'left',buttons:1,clickCount:1});
  for (let i=1;i<=10;i++) await input.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:box!.x+3+227*i/10,y:box!.y+8,button:'left',buttons:1});
  await page.waitForTimeout(350);
  await expect(page.getByRole('region',{name:'选文工具条'})).toHaveCount(0);
  await input.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:box!.x+230,y:box!.y+8,button:'left',buttons:0,clickCount:1});
  await input.detach();
  const line=page.getByRole('button',{name:'实线',exact:true}); await expect(line).toBeVisible(); await line.focus(); await page.keyboard.press('Enter'); await expect(line).toHaveAttribute('aria-pressed','true');
  await expect(line).toBeFocused(); await page.keyboard.press('Space'); await expect(line).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'关闭选文工具条'}).click();
  const frame=page.locator('.reader-viewport iframe').first(); const sandbox=await frame.getAttribute('sandbox'); expect(sandbox).not.toContain('allow-scripts'); expect(sandbox).not.toContain('allow-popups');
  const policy=await page.frameLocator('.reader-viewport iframe').first().locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'); expect(policy).toContain("script-src 'none'"); expect(policy).toContain("connect-src 'none'");
  await openNotesPage(page); await expect(page.locator('.note-counts')).toContainText('摘录 0'); await expect(page.locator('.note-counts')).toContainText('标注 0');
});

test('触屏角标与 44px 按钮、同段草稿恢复入口、刷新 beforeunload 保护', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true}); const page=await context.newPage();
  try {
    await openSample(page); await selectParagraph(page); await page.getByRole('button',{name:'思考',exact:true}).click();
    await page.getByLabel('思考正文').fill('触屏草稿'); await expect(page.getByRole('dialog',{name:'写思考',exact:true})).toContainText('草稿已保存');
    const heights=await page.locator('.thought-editor header button').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().height)); expect(heights).toHaveLength(4); expect(heights.every(h=>h>=44)).toBe(true);
    await page.getByRole('button',{name:'关闭思考',exact:true}).click(); await expect(page.getByLabel('思考正文')).toHaveCount(0); await selectParagraph(page); await page.getByRole('button',{name:'思考',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'已有本机草稿',exact:true})).toBeVisible(); await page.getByRole('button',{name:'恢复这份草稿',exact:true}).click(); await expect(page.getByLabel('思考正文')).toHaveValue('触屏草稿');
    await page.getByRole('button',{name:'保存并收起',exact:true}).click();
    const marker=page.getByRole('button',{name:'打开摘录，思考 1 条',exact:true}); const box=await marker.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.touchscreen.tap(box!.x+box!.width/2,box!.y+box!.height/2); await expect(page.getByRole('region',{name:'思考预览'})).toContainText('触屏草稿');
    await page.getByRole('button',{name:'追加思考',exact:true}).click(); await page.getByLabel('思考正文').fill('刷新前的草稿'); await expect(page.getByRole('dialog',{name:'写思考',exact:true})).toContainText('草稿已保存');
    let type=''; page.once('dialog',async dialog=>{type=dialog.type();await dialog.accept();}); await page.reload(); expect(type).toBe('beforeunload');
    await expect(page.getByRole('button',{name:/有 1 份本机草稿/})).toBeVisible();
  } finally { await context.close(); }
});

test('真实划线/高亮失败展示异常类别及旧连接 schema 安全诊断，不泄露正文且原子回滚', async ({ page }) => {
  await page.addInitScript(() => {
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key) {
      if (this.name==='annotations') throw new DOMException('PRIVATE_USER_QUOTE_DO_NOT_LOG','DataCloneError');
      return key===undefined?put.call(this,value):put.call(this,value,key);
    };
  });
  await openSample(page); await selectParagraph(page);
  await page.getByRole('button',{name:'实线',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('DataCloneError'); await expect(page.getByRole('alert')).toContainText('annotations.line');
  await page.getByText('不含正文的存储诊断（可复制）',{exact:true}).click();
  const diagnostics=page.locator('.note-error pre'); await expect(diagnostics).toContainText('"declaredVersion": 3'); await expect(diagnostics).toContainText('"nativeVersion": 30'); await expect(diagnostics).toContainText('annotations'); await expect(diagnostics).toContainText('anchorKey (unique)'); await expect(diagnostics).toContainText('"nativeIndexes"'); await expect(diagnostics).toContainText('[annotationId+ordinal] (unique)');
  const content=await page.getByRole('alert').innerText(); expect(content).not.toContain('PRIVATE_USER_QUOTE'); expect(content).not.toContain('第 1 段。'); expect(content).not.toContain('9111ad6');
  await expect(page.getByRole('button',{name:'实线',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'粉色高亮',exact:true}).click(); await expect(page.getByRole('alert')).toContainText('annotations.highlight');
  await expect(page.getByRole('button',{name:'粉色高亮',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'关闭笔记错误'}).click(); await openNotesPage(page); await expect(page.locator('.note-counts')).toContainText('摘录 0');
});

test('native v2 upgrade preserves original EPUB/cover/progress/settings and permits first highlight plus line toggles', async ({ page }) => {
  const { readFile } = await import('node:fs/promises'); const { createHash } = await import('node:crypto');
  const bytes = await readFile(path.resolve('public/demo/minimal.epub')); const id = createHash('sha256').update(bytes).digest('hex');
  await page.addInitScript(({ bytes, id }) => {
    const request = indexedDB.open('quiet-reader-library', 20);
    request.onupgradeneeded = () => {
      const db = request.result;
      const books = db.createObjectStore('books', { keyPath: 'id' }); books.createIndex('lastReadAt', 'lastReadAt'); books.createIndex('addedAt', 'addedAt');
      for (const table of ['files', 'covers', 'progress']) db.createObjectStore(table, { keyPath: 'bookId' });
      db.createObjectStore('settings', { keyPath: 'id' });
      const tx = request.transaction!;
      books.put({ version: 1, id, title: '静读 · 给文字留一点空白', author: '原作者', fileName: 'legacy.epub', size: bytes.length, addedAt: 1, lastReadAt: 2 });
      tx.objectStore('files').put({ bookId: id, data: new Uint8Array(bytes).buffer });
      tx.objectStore('covers').put({ bookId: id, blob: new Blob(['original-cover'], { type: 'image/png' }) });
      tx.objectStore('progress').put({ version: 1, bookId: id, cfi: 'epubcfi(/6/2!/4/2:0)', updatedAt: 2 });
      tx.objectStore('settings').put({ id: 'reader', value: { version: 1, theme: 'dark', fontSize: 22, contentsSide: 'right' } });
    };
    request.onsuccess = () => request.result.close();
  }, { bytes: Array.from(bytes), id });
  await page.goto('/'); await page.getByRole('button', { name: '阅读 静读 · 给文字留一点空白', exact: true }).click(); await waitForBook(page);
  await expect(page.locator('.app')).toHaveClass(/theme-dark/); await selectParagraph(page);
  await page.getByRole('button', { name: '蓝色高亮', exact: true }).click(); await expect(page.getByRole('button', { name: '蓝色高亮', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '实线', exact: true }).click(); await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '实线', exact: true }).click(); await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const preserved = await page.evaluate(id => new Promise<{ version: number; bytes: number[]; cover: string; author: string; settings: unknown; indexes: string[] }>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error);
    request.onsuccess = async () => {
      const db = request.result; const tx = db.transaction(['books', 'files', 'covers', 'settings', 'thoughts']);
      const get = (table: string, key: string) => new Promise<any>((resolve, reject) => { const r = tx.objectStore(table).get(key); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const values = await Promise.all([get('books', id), get('files', id), get('covers', id), get('settings', 'reader')]);
      const indexes = Array.from(tx.objectStore('thoughts').indexNames);
      tx.oncomplete = async () => { db.close(); resolve({ version: db.version, bytes: Array.from(new Uint8Array(values[1].data)), cover: await values[2].blob.text(), author: values[0].author, settings: values[3].value, indexes }); };
    };
  }), id);
  expect(preserved.version).toBe(30); expect(preserved.bytes).toEqual(Array.from(bytes)); expect(preserved.cover).toBe('original-cover'); expect(preserved.author).toBe('原作者');
  expect(preserved.settings).toEqual({ version: 1, theme: 'dark', fontSize: 22, contentsSide: 'right' }); expect(preserved.indexes).toContain('[annotationId+ordinal]');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('continuous draft CAS saves, reverting and editing again, refresh recovery keeps the latest full text', async ({ page }) => {
  await openSample(page); await selectParagraph(page); await page.getByRole('button', { name: '思考', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '写思考', exact: true });
  await page.getByLabel('思考正文').fill('草稿版本一'); await expect(editor).toContainText('草稿已保存');
  await page.getByLabel('思考正文').fill('草稿版本二\n完整第二段'); await expect(editor).toContainText('草稿已保存');
  await page.getByLabel('思考正文').fill(''); await expect(editor).toContainText('没有未保存修改');
  await page.getByLabel('思考正文').fill('清空后仍可保存的最新草稿'); await expect(editor).toContainText('草稿已保存');
  await page.getByRole('button', { name: '关闭思考', exact: true }).click(); await expect(editor).toHaveCount(0); await page.reload();
  await page.getByRole('button', { name: '阅读 静读 · 给文字留一点空白', exact: true }).click(); await waitForBook(page);
  await selectParagraph(page); await page.getByRole('button', { name: '思考', exact: true }).click(); await page.getByRole('button', { name: '恢复这份草稿', exact: true }).click();
  await expect(page.getByLabel('思考正文')).toHaveValue('清空后仍可保存的最新草稿');
  await page.getByLabel('思考正文').fill('恢复后继续修改'); await expect(editor).toContainText('草稿已保存');
  await page.getByRole('button', { name: '保存并收起', exact: true }).click(); await expect(editor).toHaveCount(0);
  await openNotesPage(page); await expect(page.locator('.note-counts')).toContainText('思考 1 条');
});

test('real TOC and H1-H3 provenance, quote fallback with literal newlines, ambiguous quotes never jump to the first match', async ({ page }) => {
  const { readFile } = await import('node:fs/promises'); const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await readFile(path.resolve('public/demo/minimal.epub')));
  zip.file('OEBPS/chapter0.xhtml', '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>真实出处</title></head><body><h1>书内一级</h1><h2 id="sub">书内二级</h2><h3 id="leaf">书内三级</h3><pre>首行\n第二行</pre><p>重复句子</p><p>重复句子</p></body></html>');
  zip.file('OEBPS/nav.xhtml', '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="chapter0.xhtml">真实目录章</a><ol><li><a href="chapter0.xhtml#sub">真实目录小节</a><ol><li><a href="chapter0.xhtml#leaf">真实三级目录</a></li></ol></li></ol></li></ol></nav></body></html>');
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'provenance.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) }); await waitForBook(page);
  await page.frameLocator('.reader-viewport iframe').first().locator('pre').evaluate(p => { const r = p.ownerDocument.createRange(); r.selectNodeContents(p); const s = p.ownerDocument.defaultView!.getSelection()!; s.removeAllRanges(); s.addRange(r); });
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible(); await page.getByRole('button', { name: '实线', exact: true }).click(); await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openNotesPage(page); await page.getByRole('button', { name: '导出此段', exact: true }).click(); await page.getByLabel('导出格式').selectOption('json');
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 JSON', exact: true }).click(); const file = test.info().outputPath('provenance.json'); await (await downloaded).saveAs(file);
  const backup = JSON.parse(await readFile(file, 'utf8')); const a = backup.annotations[0];
  expect(a.quote.exact).toBe('首行\n第二行'); expect(a.source.tocPath).toEqual(['真实目录章', '真实目录小节', '真实三级目录']); expect(a.source.headingPath).toEqual(['书内一级', '书内二级', '书内三级']);
  await page.getByRole('button', { name: '关闭导出笔记' }).click();
  async function restore(value: unknown) { await page.getByRole('button', { name: '导入 JSON 备份' }).click(); await page.getByLabel('选择笔记 JSON 备份').setInputFiles({ name: 'fallback.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) }); await page.getByRole('button', { name: '确认恢复' }).click(); }
  a.id = 'fallback-unique'; a.title = '唯一多行fallback'; a.locator.rangeCfi = 'epubcfi(/6/2!/4,/2/1:99999,/2/1:100000)'; a.anchorKey = a.bookId + '|' + a.locator.rangeCfi; a.quote.prefix = ''; a.quote.suffix = '';
  await restore(backup); await page.locator('.annotation-card').filter({ has: page.getByRole('heading', { name: '唯一多行fallback', exact: true }) }).getByRole('button', { name: '回到原文', exact: true }).click(); await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toHaveCount(0); await expect(page.getByRole('alert')).toHaveCount(0);
  await openNotesPage(page);
  a.id = 'fallback-ambiguous'; a.title = '歧义不可跳转'; a.locator.rangeCfi = 'epubcfi(/6/2!/4,/2/1:100001,/2/1:100002)'; a.anchorKey = a.bookId + '|' + a.locator.rangeCfi; a.quote.exact = '重复句子';
  await restore(backup); await page.locator('.annotation-card').filter({ has: page.getByRole('heading', { name: '歧义不可跳转', exact: true }) }).getByRole('button', { name: '回到原文', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('多个匹配');
});

// Hold native transactions open with queued readonly requests: no app mocks, source imports or sandbox changes.
async function installWriteGate(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { holdNoteWrite: boolean; noteWriteHeld: boolean; abortNoteWrite: boolean };
    for (const method of ['put', 'add'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function(value, key) {
        const result = key === undefined ? original.call(this, value) : original.call(this, value, key);
        if (this.name === 'annotations' && state.holdNoteWrite && !state.noteWriteHeld) {
          state.noteWriteHeld = true; const store = this;
          const keepAlive = () => { const request = store.get('__controlled_test_gate__'); request.onsuccess = () => {
            if (state.holdNoteWrite) keepAlive(); else if (state.abortNoteWrite) store.transaction.abort();
          }; }; keepAlive();
        }
        return result;
      };
    }
  });
}
async function gateWrite(page: Page, hold: boolean, abort = false) {
  await page.evaluate(({ hold, abort }) => { const state = window as unknown as { holdNoteWrite: boolean; noteWriteHeld: boolean; abortNoteWrite: boolean }; state.holdNoteWrite = hold; state.abortNoteWrite = abort; if (hold) state.noteWriteHeld = false; }, { hold, abort });
}
async function exportedBackup(page: Page) {
  const { readFile } = await import('node:fs/promises');
  await page.getByRole('button', { name: '导出此段', exact: true }).click(); await page.getByLabel('导出格式').selectOption('json');
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 JSON', exact: true }).click(); const file = test.info().outputPath(`snapshot-${Date.now()}.json`); await (await event).saveAs(file);
  await page.getByRole('button', { name: '关闭导出笔记' }).click(); return JSON.parse(await readFile(file, 'utf8'));
}
test('调整事务处理中所有输入禁用，不丢失后续输入；入口移入独立笔记页面', async ({ page }) => {
  await installWriteGate(page); await openSample(page); await selectParagraph(page); await page.getByRole('button', { name: '实线', exact: true }).click();
  await expect(page.getByRole('button', { name: '更多操作' })).toHaveCount(0);
  await openNotesPage(page); await page.getByRole('button', { name: '调整摘录', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调整已有摘录' }); await page.getByLabel('摘录标题').fill('事务快照标题'); await page.getByLabel('划线颜色').fill('#123456');
  await gateWrite(page, true); await page.getByRole('button', { name: '保存调整' }).click(); await expect.poll(() => page.evaluate(() => (window as unknown as { noteWriteHeld: boolean }).noteWriteHeld)).toBe(true);
  await expect(page.getByLabel('摘录标题')).toBeDisabled(); await expect(page.getByLabel('划线颜色')).toBeDisabled(); await expect(dialog.getByRole('button', { name: '波浪线', exact: true })).toBeDisabled();
  await page.keyboard.type('保存期间不能输入'); await expect(page.getByLabel('摘录标题')).toHaveValue('事务快照标题');
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); await gateWrite(page, false); await expect(dialog).toHaveCount(0);
  await openNotesPage(page); await expect(page.locator('.annotation-card h3')).toHaveText('事务快照标题'); await expect(page.locator('.annotation-card .annotation-tags')).toContainText('标注 · 实线');
  expect((await exportedBackup(page)).annotations[0].line.color).toBe('#123456');
});
test('恢复特殊ID必须选择，处理中Esc/关闭/离开均保护，失败反馈保留且可重试', async ({ page }) => {
  await installWriteGate(page); await openSample(page); await selectParagraph(page); await append(page, '本机思考'); await openNotesPage(page);
  const backup = await exportedBackup(page); backup.thoughts[0].id = 'constructor';
  const read = async () => { await page.getByRole('button', { name: '导入 JSON 备份' }).click(); await page.getByLabel('选择笔记 JSON 备份').setInputFiles({ name: 'safe.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); };
  await read(); await page.getByRole('button', { name: '确认恢复' }).click(); await expect(page.getByRole('dialog', { name: '恢复 JSON 备份' })).toHaveCount(0);
  backup.thoughts[0].text = '恢复版本'; await read(); const dialog = page.getByRole('dialog', { name: '恢复 JSON 备份' });
  await expect(page.getByRole('button', { name: '确认恢复' })).toBeDisabled(); await page.getByRole('radio', { name: '使用恢复版本', exact: true }).check();
  await gateWrite(page, true); await page.getByRole('button', { name: '确认恢复' }).click(); await expect.poll(() => page.evaluate(() => (window as unknown as { noteWriteHeld: boolean }).noteWriteHeld)).toBe(true);
  await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); await page.getByRole('button', { name: '关闭恢复 JSON 备份' }).click(); await expect(dialog).toBeVisible();
  await page.mouse.click(1, 1); await expect(dialog).toBeVisible();
  await gateWrite(page, false, true); await expect(dialog.getByRole('alert')).toBeVisible(); await expect(page.getByRole('button', { name: '确认恢复' })).toBeEnabled();
  await gateWrite(page, false); await page.getByRole('button', { name: '确认恢复' }).click(); await expect(dialog).toHaveCount(0);
  await page.getByText('展开思考（2）', { exact: true }).click(); await expect(page.locator('.thought-entry').nth(1)).toContainText('恢复版本');
});
test('从书架单本笔记入口默认本书，仍可显式切换全部', async ({ page }) => {
  await openSample(page); await selectParagraph(page); await append(page, '第一本');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/epub2.epub')); await waitForBook(page, '静读 · EPUB 2 样书'); await selectParagraph(page); await append(page, '第二本');
  await page.getByRole('button', { name: '静读，返回首页' }).click();
  await page.locator('.book-card').filter({ has: page.getByRole('heading', { name: '静读 · 给文字留一点空白', exact: true }) }).locator('.card-notes').first().click();
  await expect(page.getByLabel('笔记范围')).toHaveValue('book'); await expect(page.locator('.note-counts')).toContainText('摘录 1'); await expect(page.locator('.annotation-card')).toContainText('静读 · 给文字留一点空白');
  await page.getByLabel('笔记范围').selectOption('all'); await expect(page.locator('.note-counts')).toContainText('摘录 2');
});
test('真实鼠标多段跨CSS栏拖选完整保存，清除原生选区后四色背景与重排覆盖层', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await openSample(page);
  const body = page.frameLocator('.reader-viewport iframe').first().locator('body');
  const points = await body.evaluate(body => {
    const paragraphs = Array.from(body.querySelectorAll('p'));
    const character = (p: Element, last: boolean) => { const text = p.firstChild!; const n = text.textContent!.length; const r = body.ownerDocument.createRange(); r.setStart(text, last ? n - 1 : 0); r.setEnd(text, last ? n : 1); const box = r.getBoundingClientRect(); return { x: last ? box.right - .2 : box.left + .2, y: box.y + box.height / 2, right: box.right, bottom: box.bottom }; };
    const start = character(paragraphs[0], false); const view = body.ownerDocument.defaultView!;
    const index = paragraphs.findIndex((p, i) => i > 0 && character(p, false).x > view.innerWidth / 2 && character(p, true).right < view.innerWidth && character(p, true).bottom < view.innerHeight);
    if (index < 1) throw new Error('fixture has no complete paragraph in the second CSS column');
    return { start, end: character(paragraphs[index], true), exact: paragraphs.slice(0, index + 1).map(p => p.textContent).join('\n'), index };
  });
  const frame = (await page.locator('.reader-viewport iframe').first().boundingBox())!;
  const from = { x: frame.x + points.start.x, y: frame.y + points.start.y }, to = { x: frame.x + points.end.x, y: frame.y + points.end.y };
  expect(to.x).toBeGreaterThan(frame.x + frame.width / 2); expect(points.index).toBeGreaterThan(0);
  const input = await page.context().newCDPSession(page);
  await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from }); await input.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 20; i++) await input.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 20, y: from.y + (to.y - from.y) * i / 20, button: 'left', buttons: 1 });
  await expect(page.getByRole('region', { name: '选文工具条' })).toHaveCount(0);
  await input.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 }); await input.detach();
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible(); await page.getByRole('button', { name: '波浪线', exact: true }).click();
  await body.evaluate(body => body.ownerDocument.defaultView!.getSelection()!.removeAllRanges());
  for (const [name, color, theme] of [['黄色', '#d9bd6a', '明亮'], ['绿色', '#90b89a', '护眼'], ['蓝色', '#9ab7d2', '深色'], ['粉色', '#dba5ad', '明亮']]) {
    await page.getByRole('button', { name: `${name}高亮`, exact: true }).click();
    const background = page.locator(`.annotation-drawing rect[fill="${color}"]`); await expect(background.first()).toBeVisible();
    expect(await body.evaluate(body => body.ownerDocument.defaultView!.getSelection()!.toString())).toBe('');
    const rects = await background.evaluateAll(rects => rects.map(r => r.getBoundingClientRect().x)); expect(rects.some(x => x < 1440 / 2)).toBe(true); expect(rects.some(x => x > 1440 / 2)).toBe(true);
    await page.screenshot({ path: `docs/images/标注成品-无原生选区-${name}.png`, fullPage: true });
    await page.getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('button', { name: theme, exact: true }).click(); await page.keyboard.press('Escape');
    await selectParagraph(page, points.index + 1);
    await body.evaluate(body => body.ownerDocument.defaultView!.getSelection()!.removeAllRanges());
  }
  await openNotesPage(page); await expect(page.locator('.annotation-card blockquote')).toHaveText(points.exact);
  const backup = await exportedBackup(page); expect(backup.annotations).toHaveLength(1); expect(backup.annotations[0].quote.exact).toBe(points.exact); expect(backup.annotations[0].locator.rangeCfi).toMatch(/^epubcfi\(/); expect(backup.annotations[0].quote.prefix.length).toBeGreaterThan(0); expect(backup.annotations[0].quote.suffix.length).toBeGreaterThan(0);
  await resumeReading(page); await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.reading-space')).toHaveAttribute('data-columns', '1'); await expect(page.locator('.annotation-drawing rect[fill="#dba5ad"]').first()).toBeVisible();
  const positions = await page.locator('.annotation-drawing rect').evaluateAll(rects => rects.map(r => { const b = r.getBoundingClientRect(); return b.x >= 0 && b.right <= innerWidth && b.y >= 0 && b.bottom <= innerHeight; })); expect(positions.every(Boolean)).toBe(true);
  await page.screenshot({ path: 'docs/images/标注成品-清除选区重排.png', fullPage: true });
});

test('首尾自然换行 fallback 保留完整 Range，空上下文可定位，重复文本不得乱跳', async ({ page }) => {
  const { readFile } = await import('node:fs/promises'); const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await readFile(path.resolve('public/demo/minimal.epub')));
  zip.file('OEBPS/chapter0.xhtml', '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>换行边界</title></head><body><h1>换行边界</h1><pre>甲\n\n乙\n\n丙</pre><pre>丁\n戊\n己</pre><pre>庚\n戊\n辛</pre><pre>子\n癸</pre><pre>丑癸</pre></body></html>');
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles({ name: 'newline-boundaries.epub', mimeType: 'application/epub+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) }); await waitForBook(page);
  await page.frameLocator('.reader-viewport iframe').first().locator('pre').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible(); await page.getByRole('button', { name: '实线', exact: true }).click();
  await expect(page.getByRole('button', { name: '实线', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openNotesPage(page); const original = await exportedBackup(page);
  const cases = [
    { exact: '\n乙', prefix: '甲\n', suffix: '\n\n丙', ambiguous: false },
    { exact: '乙\n', prefix: '甲\n\n', suffix: '\n丙', ambiguous: false },
    { exact: '\n\n乙\n\n', prefix: '甲', suffix: '丙', ambiguous: false },
    { exact: '\n乙', prefix: '', suffix: '', ambiguous: false },
    { exact: '乙\n', prefix: '', suffix: '', ambiguous: false },
    { exact: '\n\n乙\n\n', prefix: '', suffix: '', ambiguous: false },
    // Normalized text repeats, but only one Range includes the required literal boundary newline.
    { exact: '\n癸', prefix: '', suffix: '', ambiguous: false },
    { exact: '\n戊', prefix: '', suffix: '', ambiguous: true },
    { exact: '戊\n', prefix: '', suffix: '', ambiguous: true },
    { exact: '\n戊', prefix: '丁', suffix: '\n己', ambiguous: false },
    { exact: '戊\n', prefix: '丁\n', suffix: '己', ambiguous: false },
  ];
  let verifiedMarkers = 1;
  for (const [index, value] of cases.entries()) {
    const backup = structuredClone(original), a = backup.annotations[0];
    a.id = `newline-boundary-${index}`; a.title = `换行边界用例 ${index}`;
    a.locator.rangeCfi = `epubcfi(/6/2!/4,/2/1:${200000 + index * 2},/2/1:${200001 + index * 2})`; a.anchorKey = `${a.bookId}|${a.locator.rangeCfi}`;
    a.quote = { exact: value.exact, prefix: value.prefix, suffix: value.suffix };
    await page.getByRole('button', { name: '导入 JSON 备份' }).click(); await page.getByLabel('选择笔记 JSON 备份').setInputFiles({ name: 'boundary.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }); await page.getByRole('button', { name: '确认恢复' }).click();
    // Drawing calls the same verifiedRange: await a positive exact-Range result, not just absence of an async error.
    if (!value.ambiguous) verifiedMarkers++;
    await page.locator('.annotation-card').filter({ has: page.getByRole('heading', { name: a.title, exact: true }) }).getByRole('button', { name: '回到原文', exact: true }).click();
    await expect(page.getByRole('main', { name: '我的笔记', exact: true })).toHaveCount(0);
    await expect(page.locator('.annotation-marker')).toHaveCount(verifiedMarkers);
    if (value.ambiguous) {
      await expect(page.getByRole('alert')).toContainText('多个匹配'); await page.getByRole('alert').getByRole('button', { name: /关闭笔记错误|关闭错误提示/ }).click();
    } else await expect(page.getByRole('alert'), `case ${index}: ${JSON.stringify(a.quote)}`).toHaveCount(0);
    await openNotesPage(page);
  }
  await page.screenshot({ path: 'docs/images/标注成品-换行边界定位.png', fullPage: true });
});
