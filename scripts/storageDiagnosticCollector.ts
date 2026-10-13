import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

export const DIAGNOSTIC_ENDPOINT = '/__quiet_reader_diagnostics';
export const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
// Independent server allowlists: do not trust strings merely because the client calls them diagnostic.
const operations = ['annotations.line', 'annotations.highlight', 'annotations.bookmark', 'notes.write'];
const errors = ['UnknownError', 'Error', 'TypeError', 'AbortError', 'ConstraintError', 'DataCloneError', 'DataError', 'InvalidAccessError', 'InvalidStateError', 'NotFoundError', 'NotReadableError', 'QuotaExceededError', 'ReadOnlyError', 'SecurityError', 'SyntaxError', 'TimeoutError', 'TransactionInactiveError', 'UnknownError', 'VersionError', 'DatabaseClosedError', 'UpgradeError', 'SchemaError', 'MissingAPIError', 'OpenFailedError', 'InvalidArgumentError', 'NoSuchDatabaseError', 'PrematureCommitError', 'ForeignAwaitError', 'BulkError', 'ModifyError', 'SubTransactionError'];
const statuses = ['not-opened', 'ready', 'upgrade-blocked', 'closed-for-upgrade'];
const indexes: Record<string, string[]> = {
  books: ['lastReadAt', 'addedAt'], files: [], covers: [], progress: [], settings: [], UnknownStore: [],
  annotations: ['bookId', 'anchorKey (unique)', '[bookId+locator.spineIndex]', 'createdAt', 'updatedAt'],
  thoughts: ['annotationId', 'bookId', '[annotationId+ordinal] (unique)', 'createdAt', 'updatedAt'],
  annotationDrafts: ['annotationId', 'thoughtId', 'sessionId', 'seed.bookId', 'updatedAt'],
};
for (const name of Object.keys(indexes)) indexes[name].push('UnknownIndex');
const tables = Object.keys(indexes);
const keys = ['operation', 'errorNames', 'expectedVersion', 'declaredVersion', 'nativeVersion', 'connectionOpen', 'connectionStatus', 'declaredTables', 'nativeTables', 'annotationIndexes', 'declaredIndexes', 'nativeIndexes'];
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid diagnostic');
  return value as Record<string, unknown>;
}
function list(value: unknown, allowed: string[], max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some(v => typeof v !== 'string' || !allowed.includes(v))) throw new Error('invalid diagnostic');
  return value.slice();
}
function indexMap(value: unknown) {
  return Object.fromEntries(Object.entries(object(value)).map(([name, values]) => {
    if (!tables.includes(name)) throw new Error('invalid diagnostic');
    return [name, list(values, indexes[name], indexes[name].length)];
  }));
}
export function validateCollectedDiagnostic(value: unknown) {
  const v = object(value);
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(key => !keys.includes(key)) || typeof v.operation !== 'string' || !operations.includes(v.operation) || v.expectedVersion !== 3 || typeof v.declaredVersion !== 'number' || !Number.isFinite(v.declaredVersion) || v.declaredVersion <= 0 || v.declaredVersion > 1000 || typeof v.connectionOpen !== 'boolean' || typeof v.connectionStatus !== 'string' || !statuses.includes(v.connectionStatus) || v.nativeVersion !== null && (!Number.isSafeInteger(v.nativeVersion) || Number(v.nativeVersion) < 1 || Number(v.nativeVersion) > 10000)) throw new Error('invalid diagnostic');
  // Construct a new object; unknown fields, raw messages/stacks and record values never reach disk.
  return { operation: v.operation, errorNames: list(v.errorNames, errors, 6), expectedVersion: 3, declaredVersion: v.declaredVersion, nativeVersion: v.nativeVersion, connectionOpen: v.connectionOpen, connectionStatus: v.connectionStatus,
    declaredTables: list(v.declaredTables, tables, tables.length), nativeTables: list(v.nativeTables, tables, tables.length), annotationIndexes: list(v.annotationIndexes, indexes.annotations, indexes.annotations.length), declaredIndexes: indexMap(v.declaredIndexes), nativeIndexes: indexMap(v.nativeIndexes) };
}
export function sameOriginLoopback(req: IncomingMessage) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return false;
  try {
    const host = req.headers.host;
    if (!host || !/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(host)) return false;
    const url = new URL(`http://${host}`);
    return Number(url.port || 80) === req.socket.localPort && req.headers.origin === url.origin;
  } catch { return false; }
}
function respond(res: ServerResponse, status: number) {
  res.statusCode = status; res.setHeader('Cache-Control', 'no-store'); res.end();
}
export function storageDiagnosticCollector(): Plugin {
  let writeQueue = Promise.resolve();
  // Only trusted server startup selects test storage; a request cannot change the destination.
  const testMode = process.env.QUIET_READER_DIAGNOSTICS_TEST === '1';
  const destination = testMode ? 'test-storage-diagnostic' : 'latest-storage-diagnostic';
  function install(root: string, mode: 'dev' | 'preview', use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void) {
    use((req, res, next) => {
      if (req.url?.split('?')[0] !== DIAGNOSTIC_ENDPOINT) { next(); return; }
      if (req.url !== DIAGNOSTIC_ENDPOINT || !sameOriginLoopback(req)) { respond(res, 403); return; }
      if (req.method !== 'POST') { respond(res, 405); return; }
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] ?? '')) { respond(res, 415); return; }
      if (Number(req.headers['content-length'] ?? 0) > MAX_DIAGNOSTIC_BYTES) { respond(res, 413); return; }
      void (async () => {
        try {
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of req) {
            const data = Buffer.from(chunk); size += data.length;
            if (size > MAX_DIAGNOSTIC_BYTES) { respond(res, 413); return; }
            chunks.push(data);
          }
          let diagnostic: ReturnType<typeof validateCollectedDiagnostic>;
          try { diagnostic = validateCollectedDiagnostic(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { respond(res, 400); return; }
          const directory = path.join(root, '.tools');
          const write = writeQueue.catch(() => {}).then(async () => {
            await mkdir(directory, { recursive: true });
            await writeFile(path.join(directory, `${destination}.tmp`), JSON.stringify({ collectedAt: new Date().toISOString(), source: `vite-${mode}`, testMode, diagnostic }, null, 2), { encoding: 'utf8', mode: 0o600 });
            await rename(path.join(directory, `${destination}.tmp`), path.join(directory, `${destination}.json`));
          });
          writeQueue = write; await write; respond(res, 204);
        } catch { if (!res.writableEnded) respond(res, 503); }
      })();
    });
  }
  return {
    name: 'quiet-reader-local-storage-diagnostics',
    configureServer(server) { install(server.config.root, 'dev', handler => server.middlewares.use(handler)); },
    configurePreviewServer(server) { install(server.config.root, 'preview', handler => server.middlewares.use(handler)); },
  };
}
