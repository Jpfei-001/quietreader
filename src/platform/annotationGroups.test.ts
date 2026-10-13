import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnnotationRepository } from './annotations';
import { LibraryDatabase } from './library';
import { activeAnnotationGroups, activeNoteCounts, groupAnnotations, sameExcerpt } from './annotationGroups';
import { anchorKey, type AnnotationRecord, type AnnotationSeed } from './annotationTypes';
import { backupOf, markdownOf, parseBackup } from './noteTransfer';

const seed: AnnotationSeed = { bookId: 'a'.repeat(64), bookSnapshot: { title: '测试书', author: '测试作者', fileName: 'test.epub' }, locator: { rangeCfi: 'epubcfi(/6/2!/4,/2/1:0,/2/1:20)', href: 'chapter.xhtml', spineIndex: 0 }, quote: { exact: '因此在切入点上强调从供给侧下手提高质量效率', prefix: '', suffix: '' }, source: { tocPath: ['第一章', '供给侧改革'], headingPath: ['根本区别'] } };
const shorter = { ...seed, locator: { ...seed.locator, rangeCfi: 'epubcfi(/6/2!/4,/2/1:1,/2/1:20)' }, quote: { ...seed.quote, exact: seed.quote.exact.slice(1) } };
let db: LibraryDatabase, repo: AnnotationRepository;
beforeEach(() => { db = new LibraryDatabase(`group-${crypto.randomUUID()}`); repo = new AnnotationRepository(db); });
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });
async function legacyGroup() {
  const a = await repo.change(seed, { line: { style: 'solid', color: '#52735c', origin: 'user' }, title: '我的备注' });
  const b: AnnotationRecord = { ...a, ...shorter, id: 'legacy-highlight', anchorKey: anchorKey(shorter), line: null, highlightColor: 'green', title: '' };
  await db.annotations.add(b);
  await repo.saveThought({ seed: a, id: 'first', text: '我的第一次思考', mode: 'append' });
  await repo.saveThought({ seed: b, id: 'second', text: '另一条独立思考', mode: 'append' });
  return (await repo.snapshot());
}
it('same passage with slightly different endpoints shares tags, but disjoint repeated text and small subranges do not', () => {
  expect(sameExcerpt(seed, shorter)).toBe(true);
  expect(sameExcerpt(seed, { ...seed, locator: { ...seed.locator, rangeCfi: 'epubcfi(/6/2!/4,/4/1:0,/4/1:20)' } })).toBe(false);
  expect(sameExcerpt(seed, { ...shorter, quote: { ...seed.quote, exact: seed.quote.exact.slice(5) } })).toBe(false);
  expect(sameExcerpt(seed, { ...seed, bookId: 'b'.repeat(64) })).toBe(false);
});
it('cancelled marks disappear from active groups without deleting thoughts, and re-marking restores the entry', async () => {
  const a = await repo.change(seed, { line: { style: 'solid', color: '#52735c', origin: 'user' }, highlightColor: 'green' });
  await repo.change(seed, { line: null });
  expect(activeNoteCounts(await repo.snapshot())).toEqual({ excerpts: 1, lines: 0, highlights: 1, thoughts: 0 });
  await repo.change(seed, { highlightColor: null });
  expect(activeAnnotationGroups(await repo.snapshot())).toHaveLength(0); expect(await db.annotations.count()).toBe(1);
  const restored = await repo.change(seed, { line: { style: 'wavy', color: '#52735c', origin: 'user' } });
  expect(restored.id).toBe(a.id); expect(activeNoteCounts(await repo.snapshot()).lines).toBe(1);
  await repo.saveThought({ seed, id: 'retained', text: '自己的思考不能丢失', mode: 'append' }); await repo.change(seed, { line: null });
  expect(activeNoteCounts(await repo.snapshot())).toEqual({ excerpts: 1, lines: 0, highlights: 0, thoughts: 1 });
  expect(activeAnnotationGroups(await repo.snapshot())[0].thoughts[0].text).toBe('自己的思考不能丢失');
});
it('new line/highlight selections reuse an existing equivalent excerpt', async () => {
  const a = await repo.change(seed, { line: { style: 'solid', color: '#52735c', origin: 'user' } });
  const b = await repo.change(shorter, { highlightColor: 'green' });
  expect(a.id).toBe(b.id); expect(b.line?.style).toBe('solid'); expect(b.highlightColor).toBe('green');
  expect(await db.annotations.count()).toBe(1);
});
it('legacy duplicates group non-destructively with all thoughts; readable export has no internal data and JSON remains recoverable', async () => {
  const snapshot = await legacyGroup(); const groups = groupAnnotations(snapshot);
  expect(groups).toHaveLength(1); expect(groups[0].members).toHaveLength(2); expect(groups[0].thoughts).toHaveLength(2);
  expect(await db.annotations.count()).toBe(2);
  const backup = backupOf(snapshot, snapshot.annotations.map(a => a.id)); const md = markdownOf(backup);
  expect(md.match(/^## 测试书$/gm)).toHaveLength(1);
  for (const text of ['我的备注', '我的第一次思考', '另一条独立思考', '标注', '高亮', '第一章']) expect(md).toContain(text);
  for (const text of ['legacy-highlight', 'epubcfi', 'chapter.xhtml', 'spine', 'ID：', '#52735c']) expect(md).not.toContain(text);
  expect(parseBackup(JSON.stringify(backup)).thoughts).toHaveLength(2);
});
it('group changes and delete/undo are atomic, preserve all thoughts and refuse stale revisions', async () => {
  const state = await legacyGroup(); let members = groupAnnotations(state)[0].members;
  await repo.changeGroup(members, { title: '统一备注' });
  await expect(repo.changeGroup(members, { title: '过期' })).rejects.toThrow('另一窗口');
  const before = await repo.snapshot(); members = groupAnnotations(before)[0].members;
  await expect(repo.removeGroup(members, { thoughts: 1, drafts: 0 })).rejects.toThrow('数量');
  expect(await repo.snapshot()).toEqual(before);
  const tokens = await repo.removeGroup(members, { thoughts: 2, drafts: 0 });
  expect((await repo.snapshot()).annotations).toHaveLength(0);
  await repo.undoGroup(tokens); expect(await repo.snapshot()).toEqual(before);
  const put = db.annotations.put.bind(db.annotations);
  vi.spyOn(db.annotations, 'put').mockImplementationOnce(put).mockRejectedValueOnce(new Error('第二条失败'));
  await expect(repo.changeGroup(members, { title: '失败不部分保存' })).rejects.toThrow('失败');
  expect(await repo.snapshot()).toEqual(before);
});
