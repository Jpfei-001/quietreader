import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { waitForBook } from './helpers';
async function settings(page: Page) { await page.getByRole('button',{name:'设置',exact:true}).click(); }
async function reloadReader(page: Page) { await page.reload(); await page.getByRole('button',{name:'阅读 静读 · 给文字留一点空白',exact:true}).click(); await waitForBook(page); await settings(page); }
test('浏览器记住密钥后禁用缓存强制刷新仍可用，输入框不回显；清除后刷新不恢复',async({page})=>{
  let requests=0;
  await page.route('https://api.deepseek.com/**',async route=>{requests++;expect(route.request().headers().authorization).toBe('Bearer sk-browser-persistence-fixture');await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'连接成功'}}]})});});
  await page.goto('/');await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub'));await waitForBook(page);await settings(page);
  await expect(page.getByRole('checkbox',{name:/记住 API Key/})).toBeChecked();await page.locator('#ai-key').fill('sk-browser-persistence-fixture');await page.getByRole('button',{name:'保存配置',exact:true}).click();await expect(page.locator('.ai-setting-status')).toContainText('刷新后仍可用');
  const ordinary=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));expect(ordinary).not.toContain('sk-browser-persistence-fixture');
  const cdp=await page.context().newCDPSession(page);await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await reloadReader(page);
  await expect(page.locator('.ai-settings')).toContainText('当前浏览器已加密保存');await expect(page.locator('#ai-key')).toHaveValue('');await expect(page.getByRole('checkbox',{name:/记住 API Key/})).toBeChecked();expect(requests).toBe(0);
  await page.getByRole('button',{name:'测试连接',exact:true}).click();await expect(page.locator('.ai-setting-status')).toContainText('连接成功');expect(requests).toBe(1);
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'清除密钥',exact:true}).click();await expect(page.locator('.ai-setting-status')).toContainText('密钥已清除');await reloadReader(page);await expect(page.locator('#ai-key')).toHaveAttribute('placeholder','输入 API Key');await expect(page.getByRole('button',{name:'测试连接',exact:true})).toBeDisabled();
});
test('浏览器仅会话密钥可不重填改为记住，也可取消持久化',async({page})=>{
  await page.goto('/');await page.getByLabel('选择 EPUB 文件').setInputFiles(path.resolve('public/demo/minimal.epub'));await waitForBook(page);await settings(page);
  await page.getByRole('checkbox',{name:/记住 API Key/}).uncheck();await page.locator('#ai-key').fill('sk-browser-memory-fixture');await page.getByRole('button',{name:'保存配置',exact:true}).click();await expect(page.locator('.ai-setting-status')).toContainText('仅本次');
  await page.getByRole('checkbox',{name:/记住 API Key/}).check();await page.getByRole('button',{name:'保存配置',exact:true}).click();await expect(page.locator('.ai-setting-status')).toContainText('刷新后仍可用');await reloadReader(page);await expect(page.locator('.ai-settings')).toContainText('当前浏览器已加密保存');
  await page.getByRole('checkbox',{name:/记住 API Key/}).uncheck();await page.getByRole('button',{name:'保存配置',exact:true}).click();await expect(page.locator('.ai-setting-status')).toContainText('仅本次');await reloadReader(page);await expect(page.getByRole('button',{name:'测试连接',exact:true})).toBeDisabled();
});
