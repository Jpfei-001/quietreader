import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { getDesktopWindow } from './desktop';

afterEach(() => vi.unstubAllGlobals());
describe('桌面窗口集成边界', () => {
  it('浏览器 / 无窗口环境不启用桌面标题栏或调用原生 API', () => {
    expect(getDesktopWindow()).toBeUndefined();
    vi.stubGlobal('window', {}); expect(getDesktopWindow()).toBeUndefined();
  });
  it('使用公开的 Tauri 全局 API 获取当前窗口', () => {
    const native = { label: 'main' }, getCurrentWindow = vi.fn(() => native);
    vi.stubGlobal('window', { __TAURI__: { window: { getCurrentWindow } } });
    expect(getDesktopWindow()).toBe(native); expect(getCurrentWindow).toHaveBeenCalledOnce();
  });
  it('优先使用 WebviewWindow 公共 API，同时更新原生窗口与 WebView 背景', () => {
    const native = { label: 'main', setBackgroundColor: vi.fn() }, getCurrentWebviewWindow = vi.fn(() => native);
    const getCurrentWindow = vi.fn(); vi.stubGlobal('window', { __TAURI__: { webviewWindow: { getCurrentWebviewWindow }, window: { getCurrentWindow } } });
    expect(getDesktopWindow()).toBe(native); expect(getCurrentWebviewWindow).toHaveBeenCalledOnce(); expect(getCurrentWindow).not.toHaveBeenCalled();
  });
  it('无系统标题栏时启用公共 API，初始窗口采用竖向比例，不默认最大化', async () => {
    const config = JSON.parse(await readFile(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    const main = config.app.windows.find((item: { label: string }) => item.label === 'main');
    expect(config.app.withGlobalTauri).toBe(true); expect(main.decorations).toBe(false);
    expect(main.width).toBe(800); expect(main.height).toBe(1100);
    expect(main.height).toBeGreaterThanOrEqual(1050);
    expect(main.minWidth).toBe(400); expect(main.minHeight).toBe(500);
    expect(Math.abs(main.width / main.height - 1271 / 1731)).toBeLessThan(0.01);
    expect(main.visible).toBe(false); // Rust sizes and shows it after fitting the monitor work area.
    expect(main.resizable).toBe(true); expect(main.maximized ?? false).toBe(false);
  });
  it('能力授权仅增加标题栏所需窗口操作，不开放文件系统或 Shell', async () => {
    const capability = JSON.parse(await readFile(new URL('../../src-tauri/capabilities/main.json', import.meta.url), 'utf8'));
    expect(capability.windows).toEqual(['main']);
    expect(capability.permissions).toEqual([
      'core:default', 'core:window:allow-minimize', 'core:window:allow-toggle-maximize',
      'core:window:allow-close', 'core:window:allow-destroy', 'core:window:allow-start-dragging',
      'core:window:allow-set-background-color', 'core:webview:allow-set-webview-background-color',
    ]);
  });
});
