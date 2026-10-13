import Dexie, { type Table } from 'dexie';
import type { AnnotationRecord, ThoughtEntry, AnnotationDraft } from './annotationTypes';
import type { ProgressRecord } from './storage';
import { normalizePreferences, type ReaderPreferences } from './preferences';

export const LIBRARY_DB_NAME = 'quiet-reader-library';

export interface LibraryBook {
  version: 1;
  id: string;
  title: string;
  author: string;
  fileName: string;
  size: number;
  addedAt: number;
  lastReadAt: number;
}
export interface LibraryProgress extends ProgressRecord {
  bookId: string;
  chapterIndex?: number;
  chapterCount?: number;
  page?: number;
  total?: number;
}
export interface ImportBook {
  id: string;
  title: string;
  author: string;
  fileName: string;
  data: ArrayBuffer;
  cover?: Blob;
  legacyProgress?: ProgressRecord;
}

export class LibraryDatabase extends Dexie {
  connectionStatus = 'not-opened';
  books!: Table<LibraryBook, string>;
  files!: Table<{ bookId: string; data: ArrayBuffer }, string>;
  covers!: Table<{ bookId: string; blob: Blob }, string>;
  progress!: Table<LibraryProgress, string>;
  settings!: Table<{ id: string; value: unknown }, string>;
  annotations!: Table<AnnotationRecord, string>;
  thoughts!: Table<ThoughtEntry, string>;
  annotationDrafts!: Table<AnnotationDraft, string>;

  constructor(name = LIBRARY_DB_NAME) {
    super(name);
    this.on('ready', () => { this.connectionStatus = 'ready'; });
    this.on('blocked', () => { this.connectionStatus = 'upgrade-blocked'; });
    this.on('versionchange', () => { this.connectionStatus = 'closed-for-upgrade'; });
    // 元数据、文件与封面分表，刷新书架不会反复读取完整 EPUB。
    this.version(1).stores({
      books: 'id, lastReadAt, addedAt',
      files: 'bookId',
      covers: 'bookId',
      progress: 'bookId',
    });
    // 只新增设置表，版本 1 的书籍、文件、封面与位置保持原样。
    this.version(2).stores({ settings: 'id' });
    this.version(3).stores({
      annotations: 'id, bookId, &anchorKey, [bookId+locator.spineIndex], createdAt, updatedAt',
      thoughts: 'id, annotationId, bookId, &[annotationId+ordinal], createdAt, updatedAt',
      annotationDrafts: 'id, annotationId, thoughtId, sessionId, seed.bookId, updatedAt',
    });
  }
}

export class BookRepository {
  constructor(readonly db: LibraryDatabase) {}

  async list(): Promise<LibraryBook[]> {
    const books = await this.db.books.toArray();
    return books.sort((a, b) => {
      // 有阅读记录的书优先，其次按导入时间；不将“新导入”冒充“最近阅读”。
      return b.lastReadAt - a.lastReadAt || b.addedAt - a.addedAt || a.id.localeCompare(b.id);
    });
  }

  async loadPreferences(): Promise<ReaderPreferences> {
    return normalizePreferences((await this.db.settings.get('reader'))?.value);
  }

  async savePreferences(preferences: ReaderPreferences): Promise<void> {
    await this.db.settings.put({ id: 'reader', value: normalizePreferences(preferences) });
  }

  find(id: string) { return this.db.books.get(id); }
  getProgress(id: string) { return this.db.progress.get(id); }
  async getCover(id: string) { return (await this.db.covers.get(id))?.blob; }

  async add(input: ImportBook): Promise<{ book: LibraryBook; duplicate: boolean }> {
    return this.db.transaction('rw', this.db.books, this.db.files, this.db.covers, this.db.progress, async () => {
      const existing = await this.db.books.get(input.id);
      if (existing) {
        if (input.legacyProgress && !await this.db.progress.get(input.id)) {
          await this.db.progress.add({ ...input.legacyProgress, bookId: input.id });
        }
        return { book: existing, duplicate: true };
      }
      const book: LibraryBook = {
        version: 1, id: input.id, title: input.title, author: input.author,
        fileName: input.fileName, size: input.data.byteLength,
        addedAt: Date.now(), lastReadAt: 0,
      };
      await this.db.books.add(book);
      await this.db.files.add({ bookId: input.id, data: input.data });
      if (input.cover) await this.db.covers.add({ bookId: input.id, blob: input.cover });
      if (input.legacyProgress) await this.db.progress.add({ ...input.legacyProgress, bookId: input.id });
      return { book, duplicate: false };
    });
  }

  async read(id: string): Promise<{ book: LibraryBook; data: ArrayBuffer }> {
    return this.db.transaction('r', this.db.books, this.db.files, async () => {
      const book = await this.db.books.get(id);
      const file = await this.db.files.get(id);
      if (!book || !file) throw new Error('这本书的本地文件不存在，请返回书架重新导入。');
      return { book, data: file.data };
    });
  }

  async saveProgress(id: string, progress: Omit<LibraryProgress, 'bookId' | 'version' | 'updatedAt'>): Promise<boolean> {
    return this.db.transaction('rw', this.db.books, this.db.progress, async () => {
      // 另一标签页可能已删除书籍，不能用延迟的 relocated 事件重新创建记录。
      if (!await this.db.books.get(id)) return false;
      const now = Date.now();
      await this.db.progress.put({ ...progress, version: 1, bookId: id, updatedAt: now });
      await this.db.books.update(id, { lastReadAt: now });
      return true;
    });
  }

  async remove(id: string, clearNotes = false): Promise<void> {
    await this.db.transaction('rw', [this.db.books, this.db.files, this.db.covers, this.db.progress, this.db.annotations, this.db.thoughts, this.db.annotationDrafts], async () => {
      if (clearNotes) {
        await this.db.annotations.where('bookId').equals(id).delete();
        await this.db.thoughts.where('bookId').equals(id).delete();
        await this.db.annotationDrafts.where('seed.bookId').equals(id).delete();
      }
      await this.db.books.delete(id);
      await this.db.files.delete(id);
      await this.db.covers.delete(id);
      await this.db.progress.delete(id);
    });
  }
}

export const library = new BookRepository(new LibraryDatabase());
// Dispose the previous development connection instead of leaving an HMR-era client blocking upgrades.
if (import.meta.hot) import.meta.hot.dispose(() => library.db.close());
