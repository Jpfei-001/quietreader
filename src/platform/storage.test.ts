import { describe, expect, it } from 'vitest';
import { BrowserProgressStore } from './storage';

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

describe('阅读位置存储', () => {
  it('按书籍隔离并跨实例恢复 CFI', () => {
    const storage = memory();
    const first = new BrowserProgressStore(storage);
    first.set('book-a', 'epubcfi(/6/2!/4/2:0)');
    const reopened = new BrowserProgressStore(storage);
    expect(reopened.get('book-a')?.cfi).toBe('epubcfi(/6/2!/4/2:0)');
    expect(reopened.get('book-b')).toBeUndefined();
  });
  it('忽略损坏、旧版本和无效 CFI', () => {
    for (const raw of ['broken json', 'null', '{}', '{"version":2}', '{"version":1,"cfi":"page 2","updatedAt":1}']) {
      const store = new BrowserProgressStore({ getItem: () => raw, setItem: () => {} });
      expect(store.get('a')).toBeUndefined();
    }
  });
  it('读取被禁用时安全降级，写入失败交给界面提示', () => {
    const store = new BrowserProgressStore({
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
    });
    expect(store.get('a')).toBeUndefined();
    expect(() => store.set('a', 'epubcfi(test)')).toThrow('quota');
  });
});
