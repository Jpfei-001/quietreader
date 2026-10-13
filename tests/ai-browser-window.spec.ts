import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { savedCfi, waitForBook } from './helpers';
async function open(page: Page) { await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page); }
async function select(page: Page) { await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => { const range = p.ownerDocument.createRange(); range.selectNodeContents(p); const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range); p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }); }
// Positioning APIs are simulated: headless Chrome does not provide proof of Windows/Edge placement.
async function geometryMock(page: Page, availableWidth = 1920, frames = false, sizingMismatch = false, fractionalMove = false) {
  await page.context().addInitScript(({ availableWidth, frames, sizingMismatch, fractionalMove }) => {
    if (window !== window.top) return;
    if (frames || fractionalMove) Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
    if (fractionalMove) Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.75 });
    if (window.opener) {
      const state = { x: 0, y: 0, width: 440, height: 720, moves: [] as number[][], sizes: [] as number[][], resizeToCalls: 0, relativeSizes: [] as number[][] }; Object.assign(window, { aiPopupGeometry: state });
      for (const [name, field] of [['screenX', 'x'], ['screenY', 'y'], ['outerWidth', 'width'], ['outerHeight', 'height']] as const) Object.defineProperty(window, name, { configurable: true, get: () => state[field] });
      if (frames) Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => state.width - 16 });
      window.moveTo = (x, y) => { state.x = x; state.y = y; if (fractionalMove) { state.width++; state.height++; } state.moves.push([x, y]); }; window.resizeTo = (width, height) => { state.resizeToCalls++; state.width = width + (fractionalMove ? 1 : sizingMismatch ? 16 : 0); state.height = height + (fractionalMove ? 1 : sizingMismatch ? 40 : 0); state.sizes.push([width, height]); };
      window.resizeBy = (dx, dy) => { state.width += dx; state.height += dy + (sizingMismatch ? 40 : 0); state.relativeSizes.push([dx, dy]); state.sizes.push([state.width, state.height]); };
    } else {
      const state = { x: 80, y: 40, width: 900, height: 920, features: [] as string[], illegalMainChanges: 0 }; Object.assign(window, { aiMainGeometry: state });
      for (const [name, field] of [['screenX', 'x'], ['screenY', 'y'], ['outerWidth', 'width'], ['outerHeight', 'height']] as const) Object.defineProperty(window, name, { configurable: true, get: () => state[field] });
      for (const [name, value] of Object.entries({ availLeft: 0, availTop: 0, availWidth: availableWidth, availHeight: 1080 })) Object.defineProperty(screen, name, { configurable: true, value });
      if (frames) Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => state.width - 16 });
      const nativeOpen = window.open; window.open = (...args) => { state.features.push(args[2] ?? ''); const popup = nativeOpen.apply(window, args); Object.assign(state, { popup }); return popup; };
      window.resizeTo = () => { state.illegalMainChanges++; }; window.resizeBy = () => { state.illegalMainChanges++; }; window.moveTo = () => { state.illegalMainChanges++; };
    }
  }, { availableWidth, frames, sizingMismatch, fractionalMove });
}
test('浏览器默认右侧独立助手，同高留 4px；跟随主窗口变化，阅读与 CFI 不变（窗口 API 模拟）', async ({ page }) => {
  await geometryMock(page); await open(page); const cfi = await savedCfi(page), box = await page.locator('.reading-space').boundingBox();
  await select(page); const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: '问 AI', exact: true }).click(); const popup = await opening;
  await expect(popup.getByLabel('助手呈现模式')).toHaveValue('detached'); await expect(page.locator('.ai-floating')).toHaveCount(0);
  await expect.poll(() => popup.evaluate(() => ({ x: screenX, y: screenY, height: outerHeight }))).toEqual({ x: 984, y: 40, height: 920 });
  expect(await page.evaluate(() => (window as unknown as { aiMainGeometry: { features: string[] } }).aiMainGeometry.features)).toEqual(['popup,width=440,height=920,left=984,top=40']);
  await select(page); await page.getByRole('button', { name: '问 AI', exact: true }).click(); expect(await page.evaluate(() => (window as unknown as { aiMainGeometry: { features: string[] } }).aiMainGeometry.features.length)).toBe(1);
  await page.evaluate(() => { const state = (window as unknown as { aiMainGeometry: { x: number; y: number; height: number } }).aiMainGeometry; state.x = 100; state.y = 60; state.height = 800; dispatchEvent(new Event('resize')); });
  await expect.poll(() => popup.evaluate(() => ({ x: screenX, y: screenY, height: outerHeight }))).toEqual({ x: 1004, y: 60, height: 920 });
  expect(await page.evaluate(() => (window as unknown as { aiMainGeometry: { illegalMainChanges: number } }).aiMainGeometry.illegalMainChanges)).toBe(0); expect(await page.locator('.reading-space').boundingBox()).toEqual(box); expect(await savedCfi(page)).toBe(cfi);
});
test('连续移动逐帧吸附，移动不重复缩放；助手偏离后重新吸附（窗口 API 模拟）', async ({ page }) => {
  await geometryMock(page); await open(page); const box = await page.locator('.reading-space').boundingBox(); await select(page); const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: '问 AI', exact: true }).click(); const popup = await opening;
  await expect.poll(() => popup.evaluate(() => screenX)).toBe(984);
  const sizes = await popup.evaluate(() => (window as unknown as { aiPopupGeometry: { sizes: number[][] } }).aiPopupGeometry.sizes.length);
  const positions = await page.evaluate(async () => {
    const main = (window as unknown as { aiMainGeometry: { x: number; y: number; popup: Window } }).aiMainGeometry, positions: number[][] = [];
    for (let i = 0; i < 20; i++) { main.x += 3; main.y += 1; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); positions.push([main.x, main.y, main.popup.screenX, main.popup.screenY]); }
    return positions;
  });
  for (const [x, y, assistantX, assistantY] of positions) { expect(assistantX).toBe(x + 904); expect(assistantY).toBe(y); }
  expect(await popup.evaluate(() => (window as unknown as { aiPopupGeometry: { sizes: number[][] } }).aiPopupGeometry.sizes.length)).toBe(sizes);
  await popup.evaluate(() => { const state = (window as unknown as { aiPopupGeometry: { x: number; y: number } }).aiPopupGeometry; state.x += 100; state.y += 40; });
  await expect.poll(() => popup.evaluate(() => ({ x: screenX, y: screenY }))).toEqual({ x: 1044, y: 60 });
  expect(await page.evaluate(() => (window as unknown as { aiMainGeometry: { illegalMainChanges: number } }).aiMainGeometry.illegalMainChanges)).toBe(0); expect(await page.locator('.reading-space').boundingBox()).toEqual(box);
});
test('浏览器尺寸单位或外框存在偏差时，连续跟随不累积宽度、不一直缩放（窗口 API 模拟）', async ({ page }) => {
  await geometryMock(page, 1920, false, true); await open(page); await select(page); const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: '问 AI', exact: true }).click(); const popup = await opening;
  await expect.poll(() => popup.evaluate(() => (window as unknown as { aiPopupGeometry: { resizeToCalls: number } }).aiPopupGeometry.resizeToCalls)).toBe(1);
  await page.evaluate(async () => { const main = (window as unknown as { aiMainGeometry: { x: number } }).aiMainGeometry; for (let i = 0; i < 30; i++) { main.x += 1; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); } });
  const result = await popup.evaluate(() => { const state = (window as unknown as { aiPopupGeometry: { resizeToCalls: number; relativeSizes: number[][] } }).aiPopupGeometry; return { width: outerWidth, height: outerHeight, calls: state.resizeToCalls, relative: state.relativeSizes }; });
  expect(result).toEqual({ width: 456, height: 960, calls: 1, relative: [] }); await expect(popup.locator('.ai-inline-notice').filter({ hasText: '已暂停自动跟随' })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { aiMainGeometry: { illegalMainChanges: number } }).aiMainGeometry.illegalMainChanges)).toBe(0);
});
test('分数 DPI 移动本身增宽增高时，保持首次固定尺寸，不随主窗后续高度改变（窗口 API 模拟）', async ({ page }) => {
  await geometryMock(page,1920,true,false,true);await open(page);await select(page);const opening=page.waitForEvent('popup');await page.getByRole('button',{name:'问 AI',exact:true}).click();const popup=await opening;
  await expect.poll(()=>popup.evaluate(()=>({width:outerWidth,height:outerHeight}))).toEqual({width:440,height:920});
  await page.evaluate(async()=>{const main=(window as unknown as {aiMainGeometry:{x:number;height:number}}).aiMainGeometry;for(let i=0;i<30;i++){main.x+=3;main.height=800;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));}});
  await expect.poll(()=>popup.evaluate(()=>({width:outerWidth,height:outerHeight}))).toEqual({width:440,height:920});
});
test('Windows 浏览器补偿不可见边框，只收窄缝隙，不修改主阅读器（窗口 API 模拟）', async ({ page }) => {
  await geometryMock(page, 1920, true); await open(page); const box = await page.locator('.reading-space').boundingBox(); await select(page); const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: '问 AI', exact: true }).click(); const popup = await opening;
  await expect.poll(() => popup.evaluate(() => screenX)).toBe(968);
  expect(await page.evaluate(() => (window as unknown as { aiMainGeometry: { illegalMainChanges: number } }).aiMainGeometry.illegalMainChanges)).toBe(0); expect(await page.locator('.reading-space').boundingBox()).toEqual(box);
});
test('浏览器右侧空间不足时提示，不缩小或移动主阅读器（窗口 API 模拟）', async ({ page }) => {
  await geometryMock(page, 1000); await open(page); const box = await page.locator('.reading-space').boundingBox(); await select(page); const opening = page.waitForEvent('popup'); await page.getByRole('button', { name: '问 AI', exact: true }).click(); const popup = await opening;
  await expect(popup.locator('.ai-inline-notice').filter({ hasText: '空间不足' })).toBeVisible(); expect(await page.evaluate(() => (window as unknown as { aiMainGeometry: { illegalMainChanges: number } }).aiMainGeometry.illegalMainChanges)).toBe(0); expect(await page.locator('.reading-space').boundingBox()).toEqual(box);
});
test('浏览器拦截弹窗时保留引用并回退悬浮，不假称右侧窗口已创建', async ({ page }) => {
  await page.addInitScript(() => { if (window === window.top) window.open = () => null; }); await open(page); const box = await page.locator('.reading-space').boundingBox(); await select(page); await page.getByRole('button', { name: '问 AI', exact: true }).click();
  await expect(page.locator('.ai-floating')).toBeVisible(); await expect(page.locator('.ai-inline-notice').filter({ hasText: '拦截' })).toBeVisible(); await expect(page.getByRole('group', { name: '引用 1', exact: true })).toContainText('第 1 段。'); expect(await page.locator('.reading-space').boundingBox()).toEqual(box);
});
