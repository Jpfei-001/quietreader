import { describe, expect, it, vi } from 'vitest';
import type Rendition from 'epubjs/types/rendition';
import { applyTheme, palette, type ReaderTheme } from './themes';

describe('阅读主题和隐藏滚动条', () => {
  for (const theme of ['light', 'sepia', 'dark'] as ReaderTheme[]) it(`${theme} 主题也隐藏 EPUB iframe 内滚动条，但不禁用滚动`, () => {
    const themes = { default: vi.fn(), fontSize: vi.fn() };
    applyTheme({ themes } as unknown as Rendition, theme, 20);
    const css = themes.default.mock.calls[0][0];
    expect(css.html.background).toBe(`${palette[theme].background} !important`);
    expect(css.body.background).toBe(`${palette[theme].background} !important`);
    expect(css['html, body, html body *']['scrollbar-width']).toBe('none !important');
    expect(css['html::-webkit-scrollbar, body::-webkit-scrollbar, html body *::-webkit-scrollbar'].display).toBe('none !important');
    expect(css.body.overflow).toBeUndefined();
    expect(css['html, body, html body *'].overflow).toBeUndefined();
    expect(themes.fontSize).toHaveBeenCalledWith('20px');
  });
});
