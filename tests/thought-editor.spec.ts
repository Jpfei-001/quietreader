import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForBook, savedCfi, openNotesPage } from './helpers';

async function openEditor(page: Page) {
  await page.goto('/');
  await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub'));
  await waitForBook(page);
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
  });
  await page.getByRole('button', { name: '思考', exact: true }).click();
  await expect(page.getByLabel('思考正文')).toBeFocused();
}
async function snapshot(page: Page) {
  return page.evaluate(() => new Promise<{ drafts: { text: string }[]; thoughts: { text: string; revision: number }[] }>((resolve, reject) => {
    const request = indexedDB.open('quiet-reader-library'); request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['annotationDrafts', 'thoughts'], 'readonly');
      const drafts = tx.objectStore('annotationDrafts').getAll(), thoughts = tx.objectStore('thoughts').getAll();
      tx.oncomplete = () => { db.close(); resolve({ drafts: drafts.result, thoughts: thoughts.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
}

for (const action of ['Escape', '关闭思考', '外点', '返回首页', '下一页']) test(`快速输入后${action}等待草稿写入，不提交正式思考`, async ({ page }) => {
  await openEditor(page);
  const cfi = await savedCfi(page);
  await page.getByLabel('思考正文').fill('快速输入的最终文字\n第二行完整保留');
  if (action === 'Escape') await page.keyboard.press('Escape');
  else if (action === '外点') await page.locator('.app').click({ position: { x: 2, y: 300 } });
  else await page.getByRole('button', { name: action === '返回首页' ? '静读，返回首页' : action, exact: true }).click();
  await expect(page.getByLabel('思考正文')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: '有未保存修改' })).toHaveCount(0);
  const saved = await snapshot(page);
  expect(saved.drafts.map(d => d.text)).toEqual(['快速输入的最终文字\n第二行完整保留']);
  expect(saved.thoughts).toHaveLength(0);
  if (action === '下一页') await expect.poll(() => savedCfi(page)).not.toBe(cfi);
  await page.reload();
  expect((await snapshot(page)).drafts[0].text).toBe('快速输入的最终文字\n第二行完整保留');
});

test('紧凑状态栏、快捷键存草稿与提交，不改变阅读位置，不重复追加', async ({ page }) => {
  await openEditor(page); const cfi = await savedCfi(page);
  const editor = page.locator('.thought-editor');
  await expect(editor.locator('.thought-buttons')).toHaveCount(0);
  await expect(editor.getByRole('button', { name: '保留草稿', exact: true })).toHaveCount(0);
  await expect(editor.locator('.thought-statusbar')).toBeVisible();
  expect((await editor.locator('.thought-statusbar').boundingBox())!.height).toBeLessThan(36);
  await page.getByLabel('思考正文').fill('快捷键保存正文');
  await page.keyboard.press('Control+s');
  await expect(editor.getByRole('status')).toHaveText('草稿已保存');
  expect((await snapshot(page)).drafts[0].text).toBe('快捷键保存正文');
  expect((await snapshot(page)).thoughts).toHaveLength(0);
  await expect(editor).toBeVisible(); await expect(page.getByLabel('思考正文')).toBeFocused();
  await page.keyboard.press('Meta+Enter');
  await expect(editor).toHaveCount(0);
  const saved = await snapshot(page); expect(saved.drafts).toHaveLength(0); expect(saved.thoughts).toHaveLength(1);
  expect(saved.thoughts[0].text).toBe('快捷键保存正文'); expect(await savedCfi(page)).toBe(cfi);
});

test('草稿写入失败保持编辑器与输入，重试成功后才允许关闭', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { failDraft: boolean }; state.failDraft = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'annotationDrafts' && state.failDraft) throw new DOMException('空间不足', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await openEditor(page); await page.getByLabel('思考正文').fill('失败也不能丢失');
  await page.keyboard.press('Escape');
  const editor = page.locator('.thought-editor');
  await expect(editor.getByRole('status')).toHaveText('草稿保存失败');
  await expect(editor.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('思考正文')).toHaveValue('失败也不能丢失');
  expect((await snapshot(page)).thoughts).toHaveLength(0);
  await page.evaluate(() => { (window as unknown as { failDraft: boolean }).failDraft = false; });
  await editor.getByRole('button', { name: '重试', exact: true }).click();
  await expect(editor.getByRole('status')).toHaveText('草稿已保存'); await expect(editor.getByRole('alert')).toHaveCount(0);
  await page.keyboard.press('Escape'); await expect(editor).toHaveCount(0);
  expect((await snapshot(page)).drafts[0].text).toBe('失败也不能丢失');
});

test('自动保存进行中关闭等待事务完成，再保存最终输入', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { holdDraft: boolean; draftHeld: boolean };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      const result = key === undefined ? put.call(this, value) : put.call(this, value, key);
      if (this.name === 'annotationDrafts' && state.holdDraft && !state.draftHeld) {
        state.draftHeld = true; const store = this;
        const keepAlive = () => { const read = store.get('__draft_gate__'); read.onsuccess = () => { if (state.holdDraft) keepAlive(); }; };
        keepAlive();
      }
      return result;
    };
  });
  await openEditor(page);
  await page.evaluate(() => { (window as unknown as { holdDraft: boolean }).holdDraft = true; });
  await page.getByLabel('思考正文').fill('第一版');
  await expect.poll(() => page.evaluate(() => (window as unknown as { draftHeld: boolean }).draftHeld)).toBe(true);
  await page.getByLabel('思考正文').fill('事务中的最后一版'); await page.keyboard.press('Escape');
  await expect(page.getByLabel('思考正文')).toBeVisible(); await expect(page.getByLabel('思考正文')).toBeDisabled();
  await page.evaluate(() => { (window as unknown as { holdDraft: boolean }).holdDraft = false; });
  await expect(page.locator('.thought-editor')).toHaveCount(0);
  expect((await snapshot(page)).drafts.map(d => d.text)).toEqual(['事务中的最后一版']);
});

test('空白新草稿与清空后立即关闭不创建空记录', async ({ page }) => {
  await openEditor(page);
  await expect(page.getByRole('button', { name: '保存并收起', exact: true })).toBeDisabled();
  await page.getByLabel('思考正文').fill('先输入'); await page.keyboard.press('Control+s');
  await expect(page.locator('.thought-statusbar')).toContainText('草稿已保存');
  await page.getByLabel('思考正文').fill('   \n'); await page.keyboard.press('Escape');
  await expect(page.locator('.thought-editor')).toHaveCount(0);
  expect(await snapshot(page)).toEqual({ drafts: [], thoughts: [] });
});

test('更多操作可键盘打开，Esc仅关闭菜单，丢弃确认取消零副作用，确认不删除正式内容', async ({ page }) => {
  await openEditor(page); await page.getByLabel('思考正文').fill('正式内容'); await page.keyboard.press('Control+Enter');
  await expect(page.locator('.thought-editor')).toHaveCount(0); await openNotesPage(page);
  await page.getByText('展开思考（1）', { exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('思考正文').fill('编辑中的草稿'); await page.keyboard.press('Control+s');
  await expect(page.locator('.thought-statusbar')).toContainText('草稿已保存');
  const before = await snapshot(page), more = page.getByRole('button', { name: '更多操作', exact: true });
  await more.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '丢弃本次草稿' })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(more).toBeFocused();
  await expect(page.locator('.thought-editor')).toBeVisible(); await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click(); page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '丢弃本次草稿' }).click();
  expect(await snapshot(page)).toEqual(before); await expect(page.getByLabel('思考正文')).toHaveValue('编辑中的草稿');
  await more.click(); page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '丢弃本次草稿' }).click();
  await expect(page.locator('.thought-editor')).toHaveCount(0);
  const after = await snapshot(page); expect(after.drafts).toHaveLength(0); expect(after.thoughts).toEqual(before.thoughts);
});

test('编辑未改动关闭不创建草稿，恢复原文后关闭清理草稿', async ({ page }) => {
  await openEditor(page); await page.getByLabel('思考正文').fill('正式原文'); await page.keyboard.press('Control+Enter');
  await expect(page.locator('.thought-editor')).toHaveCount(0); await openNotesPage(page);
  await page.getByText('展开思考（1）', { exact: true }).click();
  await page.getByRole('button', { name: '编辑', exact: true }).click(); await page.keyboard.press('Escape');
  await expect(page.locator('.thought-editor')).toHaveCount(0); expect((await snapshot(page)).drafts).toHaveLength(0);
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('思考正文').fill('修改后的草稿'); await page.keyboard.press('Control+s');
  await expect(page.locator('.thought-statusbar')).toContainText('草稿已保存');
  await page.getByLabel('思考正文').fill('正式原文'); await page.keyboard.press('Escape');
  await expect(page.locator('.thought-editor')).toHaveCount(0); expect((await snapshot(page)).drafts).toHaveLength(0);
  expect((await snapshot(page)).thoughts[0].text).toBe('正式原文');
});

test('恢复草稿后立即提交使用最新修订，清理恢复源草稿', async ({ page }) => {
  await openEditor(page); await page.getByLabel('思考正文').fill('恢复后提交的完整文字');
  await page.keyboard.press('Escape'); await expect(page.locator('.thought-editor')).toHaveCount(0);
  await page.getByRole('button', { name: /有 1 份本机草稿/ }).click();
  await page.getByText('本机草稿（不计入正式思考）', { exact: true }).click();
  await page.getByRole('button', { name: '恢复草稿', exact: true }).click();
  await expect(page.getByLabel('思考正文')).toHaveValue('恢复后提交的完整文字');
  await page.keyboard.press('Control+Enter'); await expect(page.locator('.thought-editor')).toHaveCount(0);
  const saved = await snapshot(page); expect(saved.drafts).toHaveLength(0); expect(saved.thoughts).toHaveLength(1);
  expect(saved.thoughts[0].text).toBe('恢复后提交的完整文字');
});

test('编辑旧思考清空后关闭仅保留修改草稿，不删除正式条目', async ({ page }) => {
  await openEditor(page); await page.getByLabel('思考正文').fill('不能丢失的正式思考'); await page.keyboard.press('Control+Enter');
  await expect(page.locator('.thought-editor')).toHaveCount(0); await openNotesPage(page);
  await page.getByText('展开思考（1）', { exact: true }).click(); await page.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('思考正文').fill(''); await page.keyboard.press('Escape'); await expect(page.locator('.thought-editor')).toHaveCount(0);
  const saved = await snapshot(page); expect(saved.thoughts[0].text).toBe('不能丢失的正式思考'); expect(saved.drafts.map(d => d.text)).toEqual(['']);
});

test('中文合成输入不触发保存与关闭', async ({ page }) => {
  await openEditor(page); await page.getByLabel('思考正文').fill('正在输入中文');
  await page.getByLabel('思考正文').evaluate(area => {
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }));
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
  });
  await expect(page.locator('.thought-editor')).toBeVisible(); expect((await snapshot(page)).thoughts).toHaveLength(0);
});

test('320px触屏动作44px、长正文滚动及三主题，弹框无越界', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 320, height: 720 } });
  try {
    const page = await context.newPage(); await openEditor(page);
    await page.getByLabel('思考正文').fill('这是一个较长的思考段落。\n'.repeat(60));
    const editor = page.locator('.thought-editor');
    const sizes = await editor.locator('header button').evaluateAll(items => items.map(el => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height })));
    expect(sizes).toHaveLength(4); for (const size of sizes) { expect(size.w).toBeGreaterThanOrEqual(44); expect(size.h).toBeGreaterThanOrEqual(44); }
    const box = (await editor.boundingBox())!; expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320); expect(box.y + box.height).toBeLessThanOrEqual(720);
    expect(await page.getByLabel('思考正文').evaluate(area => area.scrollHeight > area.clientHeight)).toBe(true);
    for (const theme of ['theme-light', 'theme-sepia', 'theme-dark']) {
      await page.locator('.app').evaluate((el, theme) => { el.classList.remove('theme-light', 'theme-sepia', 'theme-dark'); el.classList.add(theme); }, theme);
      await page.screenshot({ path: test.info().outputPath(`${theme}-320.png`), fullPage: true });
    }
  } finally { await context.close(); }
});
