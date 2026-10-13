import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LibraryDatabase } from './library';
import { storageDiagnostic, storageFailureText } from './storageDiagnostics';
let db: LibraryDatabase;
beforeEach(() => { db = new LibraryDatabase(`diagnostic-${crypto.randomUUID()}`); });
afterEach(async () => { await db.delete(); });
it('diagnostics expose only schema/connection/error categories, including actual native indexes', async () => {
  await db.open();
  const error = { name: 'DataCloneError', message: 'PRIVATE_BOOK_QUOTE', stack: 'PRIVATE_THOUGHT', inner: { name: 'ConstraintError', bookId: 'PRIVATE_ID' } };
  const result = storageDiagnostic(error, db, 'annotations.line');
  expect(result.nativeVersion).toBe(30);
  expect(result.errorNames).toEqual(['DataCloneError', 'ConstraintError']);
  expect(result.nativeIndexes.annotations).toContain('anchorKey (unique)');
  expect(result.nativeIndexes.thoughts).toContain('[annotationId+ordinal] (unique)');
  expect(result.declaredIndexes.annotationDrafts).toContain('seed.bookId');
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_/);
  expect(storageFailureText(result)).toContain('浏览器无法复制待保存数据');
});
it('closed connections and cyclic/unsafe error names remain safe without opening or writing the database', () => {
  const error = { name: 'PRIVATE quote <script>', inner: null as unknown }; error.inner = error;
  const result = storageDiagnostic(error, db, 'PRIVATE user quote');
  expect(result.errorNames).toEqual(['UnknownError']);
  expect(result.operation).toBe('UnknownError');
  expect(result.nativeVersion).toBeNull(); expect(result.nativeIndexes).toEqual({});
  expect(db.isOpen()).toBe(false);
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('real legacy v2 Dexie instance without connectionStatus yields complete collector-safe metadata', async () => {
  const { default: Dexie } = await import('dexie');
  const { validateCollectedDiagnostic } = await import('../../scripts/storageDiagnosticCollector');
  const legacy = new Dexie(`legacy-diagnostic-${crypto.randomUUID()}`);
  legacy.version(1).stores({ books: 'id,lastReadAt,addedAt', files: 'bookId', covers: 'bookId', progress: 'bookId' }); legacy.version(2).stores({ settings: 'id' });
  try {
    const closed = storageDiagnostic({ name: 'NotFoundError', message: 'PRIVATE_BOOK_TEXT_CFI' }, legacy, 'annotations.line');
    expect(closed.connectionStatus).toBe('not-opened'); expect(validateCollectedDiagnostic(JSON.parse(JSON.stringify(closed)))).toEqual(closed);
    await legacy.open(); const opened = storageDiagnostic({ name: 'SchemaError', message: 'PRIVATE_BOOK_TEXT_CFI' }, legacy, 'annotations.highlight');
    expect(opened).toMatchObject({ declaredVersion: 2, expectedVersion: 3, nativeVersion: 20, connectionStatus: 'ready', connectionOpen: true });
    expect(JSON.stringify(opened)).not.toContain('PRIVATE'); expect(validateCollectedDiagnostic(JSON.parse(JSON.stringify(opened)))).toEqual(opened);
  } finally { await legacy.delete(); }
});
