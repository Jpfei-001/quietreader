import type { ReaderTheme } from '../reader/themes';

export type ContentsSide = 'left' | 'right';

export interface ReaderPreferences {
  version: 1;
  theme: ReaderTheme;
  fontSize: number;
  contentsSide: ContentsSide;
  contentsPinned: boolean;
}

export const DEFAULT_PREFERENCES: Readonly<ReaderPreferences> = {
  version: 1, theme: 'light', fontSize: 16, contentsSide: 'left', contentsPinned: false,
};

export function normalizePreferences(value: unknown): ReaderPreferences {
  if (typeof value !== 'object' || value === null || (value as { version?: unknown }).version !== 1) {
    return { ...DEFAULT_PREFERENCES };
  }
  const candidate = value as Partial<ReaderPreferences>;
  return {
    version: 1,
    theme: candidate.theme === 'light' || candidate.theme === 'sepia' || candidate.theme === 'dark'
      ? candidate.theme : DEFAULT_PREFERENCES.theme,
    fontSize: typeof candidate.fontSize === 'number' && Number.isInteger(candidate.fontSize) &&
      candidate.fontSize >= 14 && candidate.fontSize <= 32 ? candidate.fontSize : DEFAULT_PREFERENCES.fontSize,
    // 兼容已有设置记录：只补目录位置，不重置原主题与字号。
    contentsSide: candidate.contentsSide === 'left' || candidate.contentsSide === 'right'
      ? candidate.contentsSide : DEFAULT_PREFERENCES.contentsSide,
    contentsPinned: candidate.contentsPinned === true,
  };
}
