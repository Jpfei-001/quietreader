export interface ProgressRecord {
  version: 1;
  cfi: string;
  updatedAt: number;
}

export interface ProgressStore {
  get(bookId: string): ProgressRecord | undefined;
  set(bookId: string, cfi: string): void;
}

// 保留阶段一记录的读取能力，供导入时迁移；当前阅读记录由 library.ts 写入 IndexedDB。
export class BrowserProgressStore implements ProgressStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}

  get(bookId: string): ProgressRecord | undefined {
    try {
      const raw = this.storage.getItem(`quiet-reader:progress:${bookId}`);
      if (!raw) return undefined;
      const record: unknown = JSON.parse(raw);
      if (typeof record !== 'object' || record === null) return undefined;
      const value = record as Partial<ProgressRecord>;
      if (value.version !== 1 || typeof value.cfi !== 'string' ||
          !value.cfi.startsWith('epubcfi(') || typeof value.updatedAt !== 'number') return undefined;
      return value as ProgressRecord;
    } catch {
      return undefined;
    }
  }

  set(bookId: string, cfi: string): void {
    this.storage.setItem(`quiet-reader:progress:${bookId}`, JSON.stringify({
      version: 1, cfi, updatedAt: Date.now(),
    } satisfies ProgressRecord));
  }
}

export async function identifyBook(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
