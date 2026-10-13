import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { waitForBook } from './helpers';
const endpoint = '/__quiet_reader_diagnostics';
async function readDiagnostic() { return JSON.parse(await readFile('.tools/test-storage-diagnostic.json', 'utf8')); }
async function latestFile() { try { return await readFile('.tools/latest-storage-diagnostic.json', 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } }
async function select(page: import('@playwright/test').Page) {
  await page.frameLocator('.reader-viewport iframe').first().locator('p').first().evaluate(p => {
    const range = p.ownerDocument.createRange(); range.selectNodeContents(p);
    const selection = p.ownerDocument.defaultView!.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  await expect(page.getByRole('region', { name: '选文工具条' })).toBeVisible();
}
test('automatic local marker diagnostics are private and test-isolated; failed reporting cannot affect retry', async ({ page }) => {
  const before = await latestFile();
  await page.addInitScript(() => {
    (window as unknown as { failMark: boolean }).failMark = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'annotations' && (window as unknown as { failMark: boolean }).failMark) throw new DOMException('PRIVATE_TEXT 书名 原文 思考 epubcfi(private)', 'DataCloneError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.goto('/'); await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub')); await waitForBook(page); await select(page);
  const report = page.waitForRequest(r => r.url().endsWith(endpoint));
  await page.getByRole('button', { name: '粉色高亮', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('DataCloneError');
  const payload = (await report).postData()!;
  expect(payload).not.toMatch(/PRIVATE_TEXT|书名|原文|思考|epubcfi|\"bookId\"\s*:|fileName|message|stack/);
  await expect.poll(async () => { try { return (await readDiagnostic()).diagnostic.operation; } catch { return ''; } }).toBe('annotations.highlight');
  const captured = await readDiagnostic(); expect(captured.testMode).toBe(true); expect(captured.source).toBe(process.env.READER_PREVIEW === '1' ? 'vite-preview' : 'vite-dev');
  expect(captured.diagnostic.errorNames).toContain('DataCloneError');
  expect(captured.diagnostic.nativeIndexes.annotations).toContain('anchorKey (unique)');
  expect(await latestFile()).toBe(before);
  await expect(page.getByRole('button', { name: '粉色高亮', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.route(`**${endpoint}`, route => route.abort());
  await page.getByRole('button', { name: '实线', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('annotations.line');
  await expect(page.getByRole('alert')).toHaveCount(1);
  await page.evaluate(() => { (window as unknown as { failMark: boolean }).failMark = false; });
  await page.getByRole('button', { name: '关闭笔记错误' }).click();
  await page.getByRole('button', { name: '粉色高亮', exact: true }).click();
  await expect(page.getByRole('button', { name: '粉色高亮', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '粉色高亮', exact: true }).click();
  await expect(page.getByRole('button', { name: '粉色高亮', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('dev/preview collector rejects cross-site/forged hosts, body overflow, unknown/private fields and paths', async ({ request }, testInfo) => {
  const origin = new URL(testInfo.project.use.baseURL!).origin;
  const port = new URL(origin).port;
  const payload = { operation: 'annotations.line', errorNames: ['DataCloneError'], expectedVersion: 3, declaredVersion: 3, nativeVersion: 30, connectionOpen: true, connectionStatus: 'ready', declaredTables: [], nativeTables: [], annotationIndexes: [], declaredIndexes: {}, nativeIndexes: {} };
  const valid = await request.post(endpoint, { data: payload, headers: { Origin: origin } }); expect(valid.status()).toBe(204);
  expect(valid.headers()['access-control-allow-origin']).toBeUndefined();
  const legacy = { ...payload, declaredVersion: 2, nativeVersion: 20, declaredTables: ['books', 'files', 'covers', 'progress', 'settings'], nativeTables: ['books', 'files', 'covers', 'progress', 'settings'] };
  expect((await request.post(endpoint, { data: legacy, headers: { Origin: origin } })).status()).toBe(204);
  expect((await readDiagnostic()).diagnostic).toMatchObject({ declaredVersion: 2, expectedVersion: 3, nativeVersion: 20 });
  const before = await readFile('.tools/test-storage-diagnostic.json', 'utf8'); const latest = await latestFile();
  const rejectedHeaders: Record<string, string>[] = [{}, { Origin: 'http://evil.invalid' }, { Origin: `http://localhost:${port}` }, { Origin: origin, Host: `evil.invalid:${port}` }, { Origin: origin, Host: `127.0.0.1:${Number(port) + 1}` }];
  for (const headers of rejectedHeaders) {
    const response = await request.post(endpoint, { data: payload, headers }); expect(response.status()).toBe(403); expect(response.headers()['access-control-allow-origin']).toBeUndefined();
  }
  expect((await request.fetch(endpoint, { method: 'OPTIONS', headers: { Origin: origin } })).status()).toBe(405);
  expect((await request.get(endpoint, { headers: { Origin: origin } })).status()).toBe(405);
  expect((await request.post(endpoint + '?path=../../private.json', { data: payload, headers: { Origin: origin } })).status()).toBe(403);
  expect((await request.post(endpoint, { data: 'x'.repeat(16385), headers: { Origin: origin, 'Content-Type': 'application/json' } })).status()).toBe(413);
  expect((await request.post(endpoint, { data: JSON.stringify(payload), headers: { Origin: origin, 'Content-Type': 'text/plain' } })).status()).toBe(415);
  for (const value of [{ ...payload, message: 'PRIVATE_MESSAGE' }, { ...payload, operation: 'PRIVATE_TITLE' }, { ...payload, errorNames: ['PRIVATE_QUOTE'] }, { ...payload, nativeTables: ['PRIVATE_BOOK'] }, { ...payload, nativeIndexes: { books: ['PRIVATE_THOUGHT'] } }, { ...payload, path: '/anywhere' }]) {
    expect((await request.post(endpoint, { data: value, headers: { Origin: origin } })).status()).toBe(400);
  }
  expect(await readFile('.tools/test-storage-diagnostic.json', 'utf8')).toBe(before); expect(await latestFile()).toBe(latest);
});
