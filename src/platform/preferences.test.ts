import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, normalizePreferences } from './preferences';

describe('阅读设置校验', () => {
  it('缺省设置为明亮主题和 16px', () => {
    expect(normalizePreferences(undefined)).toEqual({ version: 1, theme: 'light', fontSize: 16, contentsSide: 'left', contentsPinned: false });
  });
  it('接受三种主题和合法整数字号', () => {
    for (const theme of ['light', 'sepia', 'dark']) {
      expect(normalizePreferences({ version: 1, theme, fontSize: 26 })).toEqual({ version: 1, theme, fontSize: 26, contentsSide: 'left', contentsPinned: false });
    }
  });
  it('越界、字符串、小数和无穷字号回退为 16px', () => {
    for (const fontSize of [13, 33, '20', 18.5, NaN, Infinity]) {
      expect(normalizePreferences({ version: 1, theme: 'dark', fontSize })).toEqual({ version: 1, theme: 'dark', fontSize: 16, contentsSide: 'left', contentsPinned: false });
    }
  });
  it('未知主题回退，合法字号不丢失', () => {
    expect(normalizePreferences({ version: 1, theme: 'unknown', fontSize: 22 })).toEqual({ version: 1, theme: 'light', fontSize: 22, contentsSide: 'left', contentsPinned: false });
  });
  it('目录位置支持左右，旧记录保留主题字号并补默认左侧', () => {
    for (const contentsSide of ['left', 'right']) {
      expect(normalizePreferences({ version: 1, theme: 'sepia', fontSize: 24, contentsSide })).toEqual({ version: 1, theme: 'sepia', fontSize: 24, contentsSide, contentsPinned: false });
    }
    expect(normalizePreferences({ version: 1, theme: 'dark', fontSize: 22 })).toEqual({ version: 1, theme: 'dark', fontSize: 22, contentsSide: 'left', contentsPinned: false });
  });
  it('非法目录位置只回退位置，不重置其它设置', () => {
    for (const contentsSide of [null, 'center', 1, {}, true]) {
      expect(normalizePreferences({ version: 1, theme: 'dark', fontSize: 22, contentsSide })).toEqual({ version: 1, theme: 'dark', fontSize: 22, contentsSide: 'left', contentsPinned: false });
    }
  });
  it('固定目录只接受布尔 true，旧记录与非法值默认不固定', () => {
    expect(normalizePreferences({ version: 1, contentsPinned: true }).contentsPinned).toBe(true);
    for (const contentsPinned of [undefined, false, 'true', 1, null, {}]) {
      expect(normalizePreferences({ version: 1, contentsPinned }).contentsPinned).toBe(false);
    }
  });
  it('损坏或未知版本回退，不修改默认对象', () => {
    for (const value of [null, 'bad data', {}, { version: 2, fontSize: 30 }]) {
      const result = normalizePreferences(value);
      expect(result).toEqual(DEFAULT_PREFERENCES);
      expect(result).not.toBe(DEFAULT_PREFERENCES);
    }
  });
});
