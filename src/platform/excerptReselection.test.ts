import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnnotationRepository } from './annotations';
import { LibraryDatabase } from './library';
import { anchorKey, type AnnotationRecord, type AnnotationSeed } from './annotationTypes';
import { backupOf, parseBackup } from './noteTransfer';

const seed: AnnotationSeed = { bookId: 'a'.repeat(64), bookSnapshot: { title: '原书', author: '作者', fileName: 'a.epub' }, locator: { rangeCfi: 'epubcfi(/6/2!/4,/2/1:0,/2/1:20)', href: 'chapter.xhtml', spineIndex: 0 }, quote: { exact: '原来的完整选文内容供合并测试使用', prefix: '前', suffix: '后' }, source: { tocPath: ['第一章'], headingPath: [] } };
const replacement = { ...seed, locator: { ...seed.locator, rangeCfi: 'epubcfi(/6/2!/4,/4/1:0,/4/1:12)' }, quote: { exact: '重新拖选的原文', prefix: '新的前文', suffix: '新的后文' }, source: { tocPath: ['第一章'], headingPath: ['小节'], paragraphIndex: 2 } };
let db: LibraryDatabase, repo: AnnotationRepository;
beforeEach(() => { db = new LibraryDatabase(`reselect-${crypto.randomUUID()}`); repo = new AnnotationRepository(db); });
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });
async function fixture(legacy = false) {
  const a = await repo.change(seed, { line: { style: 'solid', color: '#52735c', origin: 'user' }, title: '原备注' });
  await repo.saveThought({ seed: a, id: 'thought-one', text: '原有思考', mode: 'append' });
  if (legacy) {
    const old: AnnotationRecord = { ...a, id: 'legacy', locator: { ...a.locator, rangeCfi: 'epubcfi(/6/2!/4,/2/1:1,/2/1:20)' }, quote: { ...a.quote, exact: a.quote.exact.slice(1) }, title: '另一条备注', nextThoughtOrdinal: 1 };
    old.anchorKey = anchorKey(old); await db.annotations.add(old);
    const t = await repo.saveThought({ seed: old, id: 'thought-two', text: '历史重复摘录中的思考', mode: 'append' });
    await repo.saveDraft({ version: 1, id: 'edit-draft', sessionId: 'session', seed: old, annotationId: old.id, thoughtId: t.id, mode: 'edit', baseRevision: t.revision, text: '未完成的编辑', updatedAt: 1 });
  }
  await repo.saveDraft({ version: 1, id: 'append-draft', sessionId: 'session', seed: a, annotationId: a.id, thoughtId: 'future', mode: 'append', text: '未完成的追加', updatedAt: 1 });
  return await repo.snapshot();
}
it('重新选文更新原文/出处/CFI，保留摘录ID、思考、草稿，备份与恢复仍有效', async () => {
  const before = await fixture(); const a = before.annotations[0];
  await repo.reselectGroup([a], replacement, { title: '修改标题', highlightColor: 'blue' });
  const after = await repo.snapshot();
  expect(after.annotations).toHaveLength(1); expect(after.annotations[0]).toMatchObject({ ...replacement, id: a.id, anchorKey: anchorKey(replacement), title: '修改标题', highlightColor: 'blue', revision: a.revision + 1 });
  expect(after.thoughts).toEqual(before.thoughts);
  expect(after.drafts[0]).toMatchObject({ text: '未完成的追加', seed: replacement, annotationId: a.id, revision: before.drafts[0].revision! + 1 });
  await expect(repo.saveDraft(before.drafts[0])).rejects.toThrow('另一窗口');
  expect(parseBackup(JSON.stringify(backupOf(after, [a.id]))).thoughts).toHaveLength(1);
  await repo.saveThought({ seed: replacement, annotationId: a.id, id: 'next', text: '重新选择后追加', mode: 'append' });
  expect(await db.annotations.count()).toBe(1);
});
it('显式重选历史分组时无损保留所有思考/备注/草稿，思考编号不重复，编辑草稿继续可恢复', async () => {
  const before = await fixture(true); const primary = before.annotations.find(a => a.id !== 'legacy')!;
  await repo.reselectGroup([primary, before.annotations.find(a => a.id === 'legacy')!], replacement, {});
  const after = await repo.snapshot(); expect(after.annotations).toHaveLength(1);
  expect(after.annotations[0].title).toContain('原备注'); expect(after.annotations[0].title).toContain('另一条备注');
  expect(after.thoughts.map(t => t.id).sort()).toEqual(before.thoughts.map(t => t.id).sort());
  expect(after.thoughts.map(t => t.text).sort()).toEqual(before.thoughts.map(t => t.text).sort());
  expect(new Set(after.thoughts.map(t => t.ordinal)).size).toBe(2); expect(after.thoughts.every(t => t.annotationId === primary.id)).toBe(true);
  expect(after.drafts).toHaveLength(2);
  const draft = after.drafts.find(d => d.id === 'edit-draft')!, thought = after.thoughts.find(t => t.id === draft.thoughtId)!;
  expect(draft.baseRevision).toBe(thought.revision);
  await repo.saveThought({ seed: draft.seed, annotationId: draft.annotationId, id: thought.id, mode: 'edit', text: draft.text, revision: draft.baseRevision, draftId: draft.id });
  expect((await db.thoughts.get(thought.id))?.text).toBe('未完成的编辑');
});
it('跨窗口修订冲突、已有目标摘录、空选文和跨书选文均拒绝，不改变原笔记', async () => {
  const before = await fixture(), members = before.annotations;
  await expect(repo.reselectGroup(members, { ...replacement, bookId: 'b'.repeat(64) }, {})).rejects.toThrow('原书');
  await expect(repo.reselectGroup(members, { ...replacement, quote: { ...replacement.quote, exact: ' ' } }, {})).rejects.toThrow('选文');
  await repo.change(replacement, { title: '已有目标' }); const withTarget = await repo.snapshot();
  await expect(repo.reselectGroup(members, replacement, {})).rejects.toThrow('已有另一条'); expect(await repo.snapshot()).toEqual(withTarget);
  await repo.change(seed, { title: '另一窗口修改' }); const changed = await repo.snapshot();
  await expect(repo.reselectGroup(members, replacement, {})).rejects.toThrow('另一窗口'); expect(await repo.snapshot()).toEqual(changed);
});
it('保存失败回滚已移动的思考、草稿和历史记录，原文与定位不部分更新', async () => {
  const before = await fixture(true);
  vi.spyOn(db.annotations, 'put').mockRejectedValueOnce(new Error('模拟写入失败'));
  await expect(repo.reselectGroup(before.annotations, replacement, {})).rejects.toThrow('模拟写入失败');
  expect(await repo.snapshot()).toEqual(before);
});
