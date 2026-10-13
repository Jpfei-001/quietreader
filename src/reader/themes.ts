import type Rendition from 'epubjs/types/rendition';

export type ReaderTheme = 'light' | 'sepia' | 'dark';
export const palette = {
  light: { background: '#fafaf8', text: '#2d302d' },
  sepia: { background: '#f2ebdd', text: '#494237' },
  dark: { background: '#202321', text: '#d6dad4' },
} satisfies Record<ReaderTheme, { background: string; text: string }>;

export function applyTheme(rendition: Rendition, theme: ReaderTheme, fontSize: number, focused = false): void {
  const colors = palette[theme];
  rendition.themes.default({
    // EPUB lives in a separate iframe; the application's scrollbar rules do not cross into it.
    'html, body, html body *': { 'scrollbar-width': 'none !important' },
    'html::-webkit-scrollbar, body::-webkit-scrollbar, html body *::-webkit-scrollbar': {
      display: 'none !important', width: '0 !important', height: '0 !important',
    },
    html: { background: `${colors.background} !important` },
    body: {
      color: `${colors.text} !important`,
      background: `${colors.background} !important`,
      'font-family': 'Georgia, "Noto Serif SC", "Songti SC", SimSun, serif !important',
      'line-height': '1.85 !important',
      padding: focused ? '6px 16px 2px !important' : '12px 24px 4px !important',
    },
    // 不为段尾孤行额外预留多行；段首保留两行，避免段落首行独自挂在页底。
    'p, li': { 'line-height': '1.85 !important', orphans: '2 !important', widows: '1 !important' },
    'img, svg': { 'max-width': '100% !important', 'object-fit': 'contain' },
    a: { color: `${colors.text} !important` },
  });
  rendition.themes.fontSize(`${fontSize}px`);
}
