import { EpubCFI } from 'epubjs';
import { groupAnnotations } from './annotationGroups';
import JSZip from 'jszip';
import { annotations, RevisionConflict, type AnnotationRepository } from './annotations';
import { anchorKey, LINE_NAMES, sourceLabel, type AnnotationRecord, type NotesSnapshot, type ThoughtEntry } from './annotationTypes';
export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_BACKUP_ANNOTATIONS = 10000;
export const MAX_BACKUP_THOUGHTS = 50000;
function checkRecordCounts(backup: Pick<NotesBackup, 'annotations' | 'thoughts'>) {
  if (backup.annotations.length > MAX_BACKUP_ANNOTATIONS || backup.thoughts.length > MAX_BACKUP_THOUGHTS) throw new Error('备份记录数超限，请按书籍或筛选结果分批导出。');
}
export function hasRestoreChoice(choices: Record<string, 'local' | 'incoming'>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(choices, id) && (choices[id] === 'local' || choices[id] === 'incoming');
}
export interface NotesBackup { format: 'quiet-reader-notes'; version: 1; exportedAt: number; annotations: AnnotationRecord[]; thoughts: ThoughtEntry[] }
export function compareAnnotations(a: AnnotationRecord, b: AnnotationRecord) {
  return a.bookId.localeCompare(b.bookId) || a.locator.spineIndex - b.locator.spineIndex || new EpubCFI().compare(a.locator.rangeCfi, b.locator.rangeCfi) || a.id.localeCompare(b.id);
}
function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份结构无效。');
  return value as Record<string, unknown>;
}
function str(value: unknown, max: number, nonempty = false): string {
  if (typeof value !== 'string' || value.length > max || (nonempty && !value.trim()) || /\u0000/.test(value)) throw new Error('备份文本长度或类型无效。');
  return value;
}
function integer(value: unknown, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error('备份编号或时间无效。');
  return value as number;
}
function timestamp(value: unknown): number {
  const time = integer(value);
  if (time > 8640000000000000) throw new Error('备份时间超出有效日期范围。');
  return time;
}
function ordinal(value: unknown): number {
  const number = integer(value, 1);
  if (number > 1000000000) throw new Error('备份编号超限。');
  return number;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_BACKUP_ANNOTATIONS) throw new Error('章节路径无效。');
  // Source metadata is preserved verbatim; the aggregate 20 MB limit bounds untrusted input.
  return value.map(v => str(v, MAX_BACKUP_BYTES));
}
export function validCfi(value: unknown): string {
  const cfi = str(value, 2048, true);
  const step = String.raw`\/[1-9]\d*(?:\[[^\]\r\n,!:]*\])?`;
  const path = `(?:${step})+`;
  const terminal = String.raw`(?::\d+(?:\[[^\]\r\n,!:]*\])?)?`;
  if (!new RegExp(`^epubcfi\\(${path}!${path},${path}${terminal},${path}${terminal}\\)$`).test(cfi)) throw new Error('备份 CFI 无效。');
  const numbers = cfi.replace(/\[[^\]]*\]/g, '').match(/\d+/g) ?? [];
  if (numbers.length > 128 || numbers.some(n => !Number.isSafeInteger(Number(n)))) throw new Error('备份 CFI 数值超限。');
  try {
    const parsed = new EpubCFI(cfi); if (!parsed.range || !Number.isSafeInteger(parsed.spinePos) || parsed.spinePos < 0) throw new Error();
    const start = new EpubCFI(cfi), end = new EpubCFI(cfi); start.collapse(true); end.collapse(false);
    if (new EpubCFI().compare(start, end) >= 0) throw new Error();
  } catch { throw new Error('备份需要有效非空选区 CFI。'); }
  return cfi;
}
export function parseBackup(text: string): NotesBackup {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('备份超过 20 MB，请分书导出。');
  let root: Record<string, unknown>;
  try { root = plain(JSON.parse(text)); } catch { throw new Error('不是有效的 JSON 备份。'); }
  if (root.format !== 'quiet-reader-notes' || root.version !== 1) throw new Error('不支持的笔记备份格式或版本。');
  if (!Array.isArray(root.annotations) || !Array.isArray(root.thoughts) || root.annotations.length > MAX_BACKUP_ANNOTATIONS || root.thoughts.length > MAX_BACKUP_THOUGHTS) throw new Error('备份记录数超限或结构无效。');
  const ids = new Set<string>();
  const list = root.annotations.map(value => {
    const a = plain(value), book = plain(a.bookSnapshot), loc = plain(a.locator), q = plain(a.quote), src = plain(a.source);
    const id = str(a.id, 200, true), bookId = str(a.bookId, 64, true);
    if (a.version !== 1 || !/^[a-f0-9]{64}$/.test(bookId) || ids.has(id)) throw new Error('摘录版本、书籍 SHA-256 或 ID 无效/重复。');
    ids.add(id);
    const href = str(loc.href, 2048, true);
    if (/^(?:[a-z][\w+.-]*:|\/\/)|(?:^|\/)\.\.(?:\/|$)|[\\\u0000]/i.test(href)) throw new Error('备份资源路径不安全。');
    let line: AnnotationRecord['line'] = null;
    if (a.line !== null) {
      const l = plain(a.line);
      if (typeof l.style !== 'string' || !['solid', 'dashed', 'wavy'].includes(l.style) || typeof l.color !== 'string' || !/^#[a-f0-9]{6}$/i.test(l.color) || typeof l.origin !== 'string' || !['user', 'thought'].includes(l.origin)) throw new Error('备份划线颜色或样式无效。');
      line = { style: l.style as NonNullable<typeof line>['style'], color: String(l.color), origin: l.origin as 'user' | 'thought' };
    }
    if (a.highlightColor !== null && (typeof a.highlightColor !== 'string' || !['yellow', 'green', 'blue', 'pink'].includes(a.highlightColor))) throw new Error('备份高亮颜色无效。');
    if (typeof a.isBookmarked !== 'boolean' || typeof a.automaticLineSuppressed !== 'boolean') throw new Error('备份开关类型无效。');
    const record: AnnotationRecord = { version: 1, id, bookId, bookSnapshot: { title: str(book.title, MAX_BACKUP_BYTES), author: str(book.author, MAX_BACKUP_BYTES), fileName: str(book.fileName, MAX_BACKUP_BYTES) }, locator: { rangeCfi: validCfi(loc.rangeCfi), href, spineIndex: integer(loc.spineIndex) }, quote: { exact: str(q.exact, 10000, true), prefix: str(q.prefix, 200), suffix: str(q.suffix, 200) }, source: { tocPath: strings(src.tocPath), headingPath: strings(src.headingPath), ...(src.paragraphIndex === undefined ? {} : { paragraphIndex: integer(src.paragraphIndex, 1) }) }, anchorKey: '', title: str(a.title, 500), line, highlightColor: a.highlightColor as AnnotationRecord['highlightColor'], isBookmarked: a.isBookmarked, automaticLineSuppressed: a.automaticLineSuppressed, nextThoughtOrdinal: ordinal(a.nextThoughtOrdinal), createdAt: timestamp(a.createdAt), updatedAt: timestamp(a.updatedAt), revision: ordinal(a.revision) };
    record.anchorKey = anchorKey(record);
    if (a.anchorKey !== record.anchorKey) throw new Error('备份选区键不一致。');
    if (new EpubCFI(record.locator.rangeCfi).spinePos !== record.locator.spineIndex) throw new Error('备份 spine 与 CFI 不一致。');
    return record;
  });
  const parents = new Map(list.map(a => [a.id, a]));
  const ordinals = new Set<string>();
  const thoughts = root.thoughts.map(value => {
    const t = plain(value), id = str(t.id, 200, true), annotationId = str(t.annotationId, 200, true), parent = parents.get(annotationId);
    const number = ordinal(t.ordinal), key = `${annotationId}|${number}`;
    if (t.version !== 1 || ids.has(id) || !parent || t.bookId !== parent.bookId || ordinals.has(key) || number >= parent.nextThoughtOrdinal) throw new Error('思考关联、ID 或顺序编号无效。');
    ids.add(id); ordinals.add(key);
    return { version: 1 as const, id, annotationId, bookId: parent.bookId, ordinal: number, text: str(t.text, 20000, true), createdAt: t.createdAt === null ? null : timestamp(t.createdAt), updatedAt: t.updatedAt === null ? null : timestamp(t.updatedAt), revision: ordinal(t.revision) };
  });
  return { format: 'quiet-reader-notes', version: 1, exportedAt: timestamp(root.exportedAt), annotations: list, thoughts };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function equal(a: unknown, b: unknown) { return canonical(a) === canonical(b); }
export interface RestorePreview { added: number; duplicate: number; merged: number; addedThoughts: number; duplicateThoughts: number; conflicts: { id: string; local: string; incoming: string }[]; fingerprint: string }
function fingerprint(s: NotesSnapshot) { return JSON.stringify([s.annotations, s.thoughts]); }
export function previewRestore(backup: NotesBackup, local: NotesSnapshot): RestorePreview {
  const result: RestorePreview = { added: 0, duplicate: 0, merged: 0, addedThoughts: 0, duplicateThoughts: 0, conflicts: [], fingerprint: fingerprint(local) };
  const localById = new Map(local.annotations.map(a => [a.id, a]));
  const localByAnchor = new Map(local.annotations.map(a => [a.anchorKey, a]));
  const incomingById = new Map(backup.annotations.map(a => [a.id, a]));
  const thoughtsById = new Map(local.thoughts.map(t => [t.id, t]));
  if (backup.annotations.some(a => thoughtsById.has(a.id)) || backup.thoughts.some(t => localById.has(t.id))) throw new Error('摘录与思考 ID 跨表冲突，不能恢复。');
  for (const a of backup.annotations) {
    const same = localById.get(a.id);
    const anchor = localByAnchor.get(a.anchorKey);
    if (same && same.anchorKey !== a.anchorKey) throw new Error('相同摘录 ID 对应不同选区，不能恢复。');
    if (!same && !anchor) { result.added++; localByAnchor.set(a.anchorKey, a); }
    else {
      const target = same ?? anchor!;
      // Parent updatedAt is maintained locally on restore; content and createdAt still conflict.
      const equivalent = equal({ ...a, id: target.id, revision: target.revision, nextThoughtOrdinal: target.nextThoughtOrdinal, updatedAt: target.updatedAt }, target);
      if (!same) result.merged++;
      if (equivalent && same) result.duplicate++;
      if (!equivalent) result.conflicts.push({ id: a.id, local: JSON.stringify(target, null, 2), incoming: JSON.stringify(a, null, 2) });
    }
  }
  for (const t of backup.thoughts) {
    const same = thoughtsById.get(t.id);
    if (same && (same.bookId !== t.bookId || localById.get(same.annotationId)?.anchorKey !== incomingById.get(t.annotationId)?.anchorKey)) throw new Error('相同思考 ID 对应不同选区，不能恢复。');
    if (!same) result.addedThoughts++;
    else if (!equal({ ...same, annotationId: t.annotationId, ordinal: t.ordinal, revision: t.revision }, t)) result.conflicts.push({ id: t.id, local: same.text, incoming: t.text });
    else result.duplicateThoughts++;
  }
  return result;
}
export async function restoreBackup(backup: NotesBackup, preview: RestorePreview, choices: Record<string, 'local' | 'incoming'>, repo: AnnotationRepository = annotations) {
  const db = repo.db;
  await db.transaction('rw', [db.annotations, db.thoughts, db.annotationDrafts], async () => {
    const local = await repo.snapshot();
    if (fingerprint(local) !== preview.fingerprint) throw new RevisionConflict();
    const checked = previewRestore(backup, local);
    if (checked.conflicts.some(c => !hasRestoreChoice(choices, c.id))) throw new Error('请逐项选择保留本机版本或恢复版本。');
    const conflictIds = new Set(checked.conflicts.map(c => c.id));
    const remap = new Map<string, AnnotationRecord>();
    const changedParents = new Set<string>();
    const originalById = new Map(local.annotations.map(a => [a.id, a]));
    const byAnchor = new Map(local.annotations.map(a => [a.anchorKey, a]));
    const incomingById = new Map(backup.annotations.map(a => [a.id, a]));
    for (const a of backup.annotations) {
      let target = byAnchor.get(a.anchorKey);
      if (!target) { target = { ...a }; await db.annotations.add(target); }
      else if (conflictIds.has(a.id) && hasRestoreChoice(choices, a.id) && choices[a.id] === 'incoming') {
        target = { ...a, id: target.id, nextThoughtOrdinal: Math.max(a.nextThoughtOrdinal, target.nextThoughtOrdinal), revision: Math.max(a.revision, target.revision) + 1 };
        changedParents.add(target.id);
        await db.annotations.put(target);
      }
      byAnchor.set(a.anchorKey, target);
      remap.set(a.id, target);
    }
    for (const a of backup.annotations) remap.set(a.id, byAnchor.get(a.anchorKey)!);
    for (const t of backup.thoughts) {
      const a = remap.get(t.annotationId)!;
      const old = await db.thoughts.get(t.id);
      if (old) {
        if (hasRestoreChoice(choices, t.id) && choices[t.id] === 'incoming' && !equal({ ...old, annotationId: t.annotationId, ordinal: t.ordinal, revision: t.revision }, t)) {
          await db.thoughts.put({ ...old, text: t.text, createdAt: t.createdAt, updatedAt: t.updatedAt, revision: old.revision + 1 });
          changedParents.add(a.id);
        }
        continue;
      }
      const used = await db.thoughts.where('[annotationId+ordinal]').equals([a.id, t.ordinal]).first();
      const ordinal = used || a.id !== t.annotationId ? a.nextThoughtOrdinal : t.ordinal;
      await db.thoughts.add({ ...t, annotationId: a.id, ordinal });
      changedParents.add(a.id);
      a.nextThoughtOrdinal = Math.max(a.nextThoughtOrdinal, ordinal + 1);
      await db.annotations.put(a);
    }
    for (const [id, a] of remap) {
      const next = Math.max(a.nextThoughtOrdinal, incomingById.get(id)!.nextThoughtOrdinal);
      if (next !== a.nextThoughtOrdinal) changedParents.add(a.id);
      a.nextThoughtOrdinal = next;
    }
    // Parent CAS must invalidate pre-restore undo tokens even when only thoughts/numbering change.
    for (const a of new Map(Array.from(remap.values()).map(a => [a.id, a])).values()) {
      if (!changedParents.has(a.id)) continue;
      a.revision = Math.max(a.revision, (originalById.get(a.id)?.revision ?? a.revision) + 1);
      a.updatedAt = Date.now();
      await db.annotations.put(a);
    }
  });
}
export function backupOf(snapshot: NotesSnapshot, ids: string[]): NotesBackup {
  const selected = new Set(ids);
  return { format: 'quiet-reader-notes', version: 1, exportedAt: Date.now(), annotations: snapshot.annotations.filter(a => selected.has(a.id)).sort(compareAnnotations), thoughts: snapshot.thoughts.filter(t => selected.has(t.annotationId)).sort((a, b) => a.ordinal - b.ordinal) };
}
export function escapeMarkdown(text: string) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~\-])/g, '\\$1'); }
export function markdownOf(backup: NotesBackup) {
  const e = escapeMarkdown;
  const colorNames = { yellow: '黄色', green: '绿色', blue: '蓝色', pink: '粉色' };
  return '# 静读笔记\n\n' + groupAnnotations(backup).sort((a, b) => compareAnnotations(a.annotation, b.annotation)).map(({ annotation: a, members, thoughts }) => {
    const tags = [...new Set(members.flatMap(a => [a.line ? `标注 · ${LINE_NAMES[a.line.style]}` : '', a.highlightColor ? `高亮 · ${colorNames[a.highlightColor]}` : ''].filter(Boolean)))];
    const remarks = [...new Set(members.map(a => a.title).filter(Boolean))];
    return `## ${e(a.bookSnapshot.title)}\n\n作者：${e(a.bookSnapshot.author)}\n\n${a.quote.exact.split('\n').map(l => '> ' + e(l)).join('\n')}\n\n摘录自：${e(sourceLabel(a))}\n\n` +
      remarks.map(title => `备注：${e(title)}\n\n`).join('') + (tags.length ? `${tags.map(e).join(' / ')}\n\n` : '') +
      (thoughts.length ? thoughts.map((t, index) => `### 第 ${index + 1} 次思考\n\n${e(t.text)}\n`).join('\n') : '') + '---\n';
  }).join('\n');
}
export async function makeDownload(backup: NotesBackup, format: 'md' | 'json' | 'zip', signal: AbortSignal, progress: (n: number) => void) {
  checkRecordCounts(backup);
  const json = JSON.stringify(backup, null, 2);
  if (new TextEncoder().encode(json).byteLength > MAX_BACKUP_BYTES) throw new Error('导出超过 20 MB，请按书籍或筛选结果分批导出。');
  if (signal.aborted) throw new Error('已取消导出。');
  // Never offer a successful backup download that our own recovery parser rejects.
  parseBackup(json);
  progress(20);
  await new Promise(resolve => setTimeout(resolve, 0));
  const md = markdownOf(backup);
  if (new TextEncoder().encode(md).byteLength > MAX_BACKUP_BYTES) throw new Error('Markdown 超过 20 MB，请分批导出。');
  let blob: Blob;
  if (format === 'zip') {
    const zip = new JSZip(); zip.file('静读笔记.md', md); zip.file('静读笔记.json', json);
    blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, meta => { if (signal.aborted) throw new Error('已取消导出。'); progress(20 + Math.round(meta.percent * .8)); });
  } else blob = new Blob([format === 'md' ? md : json], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8' });
  if (signal.aborted) throw new Error('已取消导出。');
  progress(100);
  return blob;
}
