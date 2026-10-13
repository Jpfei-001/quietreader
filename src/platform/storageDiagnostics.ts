import type { LibraryDatabase } from './library';
export interface StorageDiagnostic {
  operation: string;
  errorNames: string[];
  expectedVersion: number;
  declaredVersion: number;
  nativeVersion: number | null;
  connectionOpen: boolean;
  connectionStatus: string;
  declaredTables: string[];
  nativeTables: string[];
  annotationIndexes: string[];
  declaredIndexes: Record<string, string[]>;
  nativeIndexes: Record<string, string[]>;
}
const ERROR_NAMES = ['UnknownError', 'Error', 'TypeError', 'AbortError', 'ConstraintError', 'DataCloneError', 'DataError', 'InvalidAccessError', 'InvalidStateError', 'NotFoundError', 'NotReadableError', 'QuotaExceededError', 'ReadOnlyError', 'SecurityError', 'SyntaxError', 'TimeoutError', 'TransactionInactiveError', 'VersionError', 'DatabaseClosedError', 'UpgradeError', 'SchemaError', 'MissingAPIError', 'OpenFailedError', 'InvalidArgumentError', 'NoSuchDatabaseError', 'PrematureCommitError', 'ForeignAwaitError', 'BulkError', 'ModifyError', 'SubTransactionError'];
const OPERATIONS = ['annotations.line', 'annotations.highlight', 'annotations.bookmark', 'notes.write'];
const TABLES = ['books', 'files', 'covers', 'progress', 'settings', 'annotations', 'thoughts', 'annotationDrafts'];
const INDEXES: Record<string, string[]> = { books: ['lastReadAt', 'addedAt'], files: [], covers: [], progress: [], settings: [], annotations: ['bookId', 'anchorKey (unique)', '[bookId+locator.spineIndex]', 'createdAt', 'updatedAt'], thoughts: ['annotationId', 'bookId', '[annotationId+ordinal] (unique)', 'createdAt', 'updatedAt'], annotationDrafts: ['annotationId', 'thoughtId', 'sessionId', 'seed.bookId', 'updatedAt'] };
const safeName = (value: unknown) => typeof value === 'string' && ERROR_NAMES.includes(value) ? value : 'UnknownError';
const safeTable = (value: string) => TABLES.includes(value) ? value : 'UnknownStore';
const safeIndexes = (values: string[], table: string) => Array.from(new Set(values.map(v => INDEXES[table]?.includes(v) ? v : 'UnknownIndex')));
// Never include message, stack, book identity, text, CFI, or record values in diagnostics.
export function storageDiagnostic(error: unknown, db: Pick<LibraryDatabase, 'isOpen' | 'backendDB' | 'tables' | 'verno'> & { connectionStatus?: unknown }, operation: string): StorageDiagnostic {
  const names: string[] = [];
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current) && names.length < 6) {
    visited.add(current);
    const detail = current as { name?: unknown; inner?: unknown; cause?: unknown };
    names.push(safeName(detail.name)); current = detail.inner ?? detail.cause;
  }
  let nativeVersion: number | null = null, nativeTables: string[] = [];
  const nativeIndexes: Record<string, string[]> = {};
  try {
    if (db.isOpen()) {
      const native = db.backendDB(); nativeVersion = native.version; const actualTables = Array.from(native.objectStoreNames); nativeTables = Array.from(new Set(actualTables.map(safeTable)));
      if (actualTables.length) {
        const transaction = native.transaction(actualTables, 'readonly');
        for (const name of actualTables) {
          const store = transaction.objectStore(name);
          nativeIndexes[safeTable(name)] = safeIndexes(Array.from(store.indexNames).map(key => `${key}${store.index(key).unique ? ' (unique)' : ''}`), name);
        }
      }
    }
  } catch { /* A closed connection is itself diagnostic evidence. */ }
  const declaredIndexes = Object.fromEntries(db.tables.map(t => [safeTable(t.name), safeIndexes(t.schema.indexes.map(i => `${i.name}${i.unique ? ' (unique)' : ''}`), t.name)]));
  return { operation: OPERATIONS.includes(operation) ? operation : 'UnknownError', errorNames: names.length ? names : ['UnknownError'], expectedVersion: 3, declaredVersion: db.verno, nativeVersion, connectionOpen: db.isOpen(), connectionStatus: typeof db.connectionStatus === 'string' && ['not-opened', 'ready', 'upgrade-blocked', 'closed-for-upgrade'].includes(db.connectionStatus) ? db.connectionStatus : db.isOpen() ? 'ready' : 'not-opened', declaredTables: Array.from(new Set(db.tables.map(t => safeTable(t.name)))), nativeTables, annotationIndexes: declaredIndexes.annotations ?? [], declaredIndexes, nativeIndexes };
}
// Best effort, same-origin loopback only. A missing/blocked collector never changes save state.
export async function reportStorageDiagnostic(diagnostic: StorageDiagnostic): Promise<void> {
  if (typeof location === 'undefined' || location.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  try {
    await fetch('/__quiet_reader_diagnostics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(diagnostic), mode: 'same-origin', credentials: 'omit', redirect: 'error', signal: controller.signal });
  } catch { /* Reporting is not part of the database transaction and must never show another error. */ }
  finally { clearTimeout(timer); }
}
export function storageFailureText(diagnostic: StorageDiagnostic) {
  const names = diagnostic.errorNames.join(' → ');
  let help = '保存失败，输入和原标记仍保留。请复制下方诊断供排查，不要清理站点数据。';
  if (diagnostic.errorNames.includes('QuotaExceededError')) help = '浏览器报告本机存储空间不足；输入和原标记仍保留，请备份后检查空间。';
  else if (diagnostic.errorNames.some(n => ['VersionError','DatabaseClosedError','UpgradeError','SchemaError','NotFoundError'].includes(n)) || diagnostic.connectionStatus === 'upgrade-blocked') help = '数据库连接或升级未完成；请关闭其他静读标签页并刷新本页后重试，不要删库或清理站点数据。';
  else if (diagnostic.errorNames.includes('DataCloneError')) help = '浏览器无法复制待保存数据；原标记不变，请复制诊断协助定位。';
  else if (diagnostic.errorNames.includes('ConstraintError')) help = '选区或编号唯一索引发生冲突；请重新选文后重试，原记录仍保留。';
  return `${help}（${diagnostic.operation} / ${names}；数据库声明 ${diagnostic.declaredVersion}，连接版本 ${diagnostic.nativeVersion ?? '未打开'}）`;
}
