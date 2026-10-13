import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import { BookRepository, LibraryDatabase, type ImportBook } from './library';

let database: LibraryDatabase;
let repository: BookRepository;
let serial = 0;
const input = (id = 'a'): ImportBook => ({
  id, title: `测试书 ${id}`, author: '测试作者', fileName: `${id}.epub`,
  data: Uint8Array.from([1, 2, 3]).buffer,
  cover: new Blob(['cover'], { type: 'image/png' }),
});

beforeEach(() => {
  database = new LibraryDatabase(`quiet-reader-test-${++serial}`);
  repository = new BookRepository(database);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await database.delete();
});

describe('IndexedDB 本地书架', () => {
  it('保存元数据、文件、封面，并在重新打开数据库后恢复', async () => {
    await repository.add(input());
    const name = database.name;
    database.close();
    database = new LibraryDatabase(name);
    repository = new BookRepository(database);
    const result = await repository.read('a');
    expect(result.book.title).toBe('测试书 a');
    expect(Array.from(new Uint8Array(result.data))).toEqual([1, 2, 3]);
    expect((await repository.getCover('a'))?.type).toBe('image/png');
    expect(database.verno).toBe(3);
  });
  it('相同内容标识不会重复保存，也不覆盖已有元数据', async () => {
    await repository.add(input());
    const result = await repository.add({ ...input(), fileName: '重命名.epub', title: '不能覆盖' });
    expect(result.duplicate).toBe(true);
    expect(result.book.title).toBe('测试书 a');
    expect(await database.books.count()).toBe(1);
    expect(await database.files.count()).toBe(1);
    expect(await database.covers.count()).toBe(1);
  });
  it('文件写入失败回滚整个导入事务，不留下空书架条目', async () => {
    vi.spyOn(database.files, 'add').mockRejectedValueOnce(new DOMException('空间不足', 'QuotaExceededError'));
    await expect(repository.add(input())).rejects.toThrow('空间不足');
    expect(await database.books.count()).toBe(0);
    expect(await database.files.count()).toBe(0);
    expect(await database.covers.count()).toBe(0);
  });
  it('按最近阅读排序，未阅读书籍按导入时间排序', async () => {
    const clock = vi.spyOn(Date, 'now');
    clock.mockReturnValue(10);
    await repository.add(input('a'));
    clock.mockReturnValue(20);
    await repository.add(input('b'));
    expect((await repository.list()).map((book) => book.id)).toEqual(['b', 'a']);
    clock.mockReturnValue(30);
    await repository.saveProgress('a', { cfi: 'epubcfi(/6/2!/4/2:0)', chapterIndex: 2, chapterCount: 3 });
    expect((await repository.list()).map((book) => book.id)).toEqual(['a', 'b']);
    expect((await repository.getProgress('a'))?.chapterIndex).toBe(2);
  });
  it('删除同时清理书籍、文件、封面和阅读记录', async () => {
    await repository.add(input());
    await repository.saveProgress('a', { cfi: 'epubcfi(/6/2!/4/2:0)' });
    await repository.remove('a');
    for (const table of [database.books, database.files, database.covers, database.progress]) {
      expect(await table.count()).toBe(0);
    }
  });
  it('迁移旧版 CFI，不丢失更新时间和版本', async () => {
    const legacyProgress = { version: 1 as const, cfi: 'epubcfi(/6/4!/4/2:0)', updatedAt: 123 };
    await repository.add({ ...input(), legacyProgress });
    expect(await repository.getProgress('a')).toEqual({ ...legacyProgress, bookId: 'a' });
  });
  it('重复导入可补迁移旧位置，但不覆盖已有 IndexedDB 位置', async () => {
    await repository.add(input());
    const legacyProgress = { version: 1 as const, cfi: 'epubcfi(/6/4!/4/2:0)', updatedAt: 123 };
    await repository.add({ ...input(), legacyProgress });
    expect((await repository.getProgress('a'))?.cfi).toBe(legacyProgress.cfi);
    await repository.saveProgress('a', { cfi: 'epubcfi(/6/6!/4/2:0)' });
    await repository.add({ ...input(), legacyProgress });
    expect((await repository.getProgress('a'))?.cfi).toBe('epubcfi(/6/6!/4/2:0)');
  });
  it('已删除的书籍不会被迟到的位置事件重新创建', async () => {
    await repository.add(input());
    await repository.remove('a');
    expect(await repository.saveProgress('a', { cfi: 'epubcfi(test)' })).toBe(false);
    expect(await database.progress.count()).toBe(0);
  });
  it('字号、主题与目录位置保存后重新打开可恢复，删书不会清空全局设置', async () => {
    await repository.savePreferences({ version: 1, theme: 'sepia', fontSize: 24, contentsSide: 'right', contentsPinned: true });
    await repository.add(input());
    await repository.remove('a');
    const name = database.name;
    database.close();
    database = new LibraryDatabase(name);
    repository = new BookRepository(database);
    expect(await repository.loadPreferences()).toEqual({ version: 1, theme: 'sepia', fontSize: 24, contentsSide: 'right', contentsPinned: true });
  });
  it('版本 1 升级到 3 保留原始书籍、封面、位置，新增设置表默认 16px', async () => {
    const previous = new Dexie(database.name);
    previous.version(1).stores({ books: 'id, lastReadAt, addedAt', files: 'bookId', covers: 'bookId', progress: 'bookId' });
    await previous.table('books').put({ version: 1, id: 'a', title: '原有书籍', author: '原作者', fileName: 'a.epub', size: 3, addedAt: 1, lastReadAt: 2 });
    await previous.table('files').put({ bookId: 'a', data: input().data });
    await previous.table('covers').put({ bookId: 'a', blob: input().cover });
    await previous.table('progress').put({ version: 1, bookId: 'a', cfi: 'epubcfi(/6/4!/4/2:0)', updatedAt: 2 });
    previous.close();
    expect((await repository.read('a')).book.title).toBe('原有书籍');
    expect((await repository.getCover('a'))?.type).toBe('image/png');
    expect((await repository.getProgress('a'))?.cfi).toBe('epubcfi(/6/4!/4/2:0)');
    expect(await repository.loadPreferences()).toEqual({ version: 1, theme: 'light', fontSize: 16, contentsSide: 'left', contentsPinned: false });
    expect(database.verno).toBe(3);
  });
  it('旧设置补目录位置，不覆盖原有主题和字号，不在读取时回写', async () => {
    const value = { version: 1, theme: 'dark', fontSize: 22 };
    await database.settings.put({ id: 'reader', value });
    expect(await repository.loadPreferences()).toEqual({ ...value, contentsSide: 'left', contentsPinned: false });
    expect((await database.settings.get('reader'))?.value).toEqual(value);
  });
  it('损坏设置安全回退，保存失败不冒充成功', async () => {
    await database.settings.put({ id: 'reader', value: 'broken' });
    expect((await repository.loadPreferences()).fontSize).toBe(16);
    vi.spyOn(database.settings, 'put').mockRejectedValueOnce(new DOMException('空间不足', 'QuotaExceededError'));
    await expect(repository.savePreferences({ version: 1, theme: 'dark', fontSize: 26, contentsSide: 'left', contentsPinned: false })).rejects.toThrow('空间不足');
  });
  it('本地文件缺失时给出可恢复的中文提示', async () => {
    await expect(repository.read('missing')).rejects.toThrow('重新导入');
  });
});
