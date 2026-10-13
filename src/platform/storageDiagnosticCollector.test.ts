import { expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { sameOriginLoopback, validateCollectedDiagnostic } from '../../scripts/storageDiagnosticCollector';
const diagnostic = { operation: 'annotations.line', errorNames: ['DataCloneError'], expectedVersion: 3, declaredVersion: 3, nativeVersion: 30, connectionOpen: true, connectionStatus: 'ready', declaredTables: ['annotations'], nativeTables: ['annotations'], annotationIndexes: ['anchorKey (unique)'], declaredIndexes: { annotations: ['anchorKey (unique)'] }, nativeIndexes: { annotations: ['UnknownIndex'] } };
it('server independently validates metadata and reconstructs only allowed fields', () => {
  expect(validateCollectedDiagnostic(diagnostic)).toEqual(diagnostic);
  for (const value of [{ ...diagnostic, message: 'PRIVATE' }, { ...diagnostic, errorNames: ['PRIVATE'] }, { ...diagnostic, nativeIndexes: { annotations: ['PRIVATE'] } }, { ...diagnostic, connectionStatus: ['ready'] }, { ...diagnostic, operation: ['annotations.line'] }, { ...diagnostic, nativeVersion: Infinity }, { ...diagnostic, declaredIndexes: JSON.parse('{"__proto__":[]}') }]) expect(() => validateCollectedDiagnostic(value)).toThrow();
});
it('collector requires both socket loopback and exact same Origin/Host/local port, ignoring forwarded headers', () => {
  const request = (remoteAddress: string, host: string, origin: string) => ({ socket: { remoteAddress, localPort: 1420 }, headers: { host, origin, 'x-forwarded-for': '127.0.0.1' } }) as unknown as IncomingMessage;
  expect(sameOriginLoopback(request('127.0.0.1', '127.0.0.1:1420', 'http://127.0.0.1:1420'))).toBe(true);
  expect(sameOriginLoopback(request('::1', '[::1]:1420', 'http://[::1]:1420'))).toBe(true);
  expect(sameOriginLoopback(request('::ffff:127.0.0.1', 'localhost:1420', 'http://localhost:1420'))).toBe(true);
  for (const values of [['192.168.1.2', '127.0.0.1:1420', 'http://127.0.0.1:1420'], ['127.0.0.1', 'localhost:1421', 'http://localhost:1421'], ['127.0.0.1', 'localhost:1420', 'null'], ['127.0.0.1', 'localhost:1420', 'http://localhost:1420.evil.invalid'], ['127.0.0.1', '127.0.0.1:1420', 'http://localhost:1420']]) expect(sameOriginLoopback(request(...values as [string,string,string]))).toBe(false);
});
it('legacy declared versions are preserved independently of expected version without expanding metadata permissions', () => {
  for (const declaredVersion of [1, 2, 3, 4, 2.1]) expect(validateCollectedDiagnostic({ ...diagnostic, declaredVersion }).declaredVersion).toBe(declaredVersion);
  for (const declaredVersion of [0, 1001, '2', [2], Infinity, NaN]) expect(() => validateCollectedDiagnostic({ ...diagnostic, declaredVersion })).toThrow();
});
