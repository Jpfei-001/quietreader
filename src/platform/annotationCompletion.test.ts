import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LibraryDatabase } from './library';
import { AnnotationRepository } from './annotations';
import { backupOf, makeDownload, parseBackup } from './noteTransfer';
import type { AnnotationDraft, AnnotationSeed } from './annotationTypes';
let db: LibraryDatabase, repo: AnnotationRepository;
const seed: AnnotationSeed = { bookId: 'a'.repeat(64), bookSnapshot: { title: '书', author: '作者', fileName: '书.epub' }, locator: { rangeCfi: 'epubcfi(/6/2!/4,/2/1:0,/2/1:5)', href: 'chapter.xhtml', spineIndex: 0 }, quote: { exact: '原文', prefix: '', suffix: '' }, source: { tocPath: ['章'], headingPath: ['标题'] } };
beforeEach(() => { db = new LibraryDatabase(`completion-${crypto.randomUUID()}`); repo = new AnnotationRepository(db); });
afterEach(async () => { await db.delete(); });
function draft(id: string): AnnotationDraft { return { version: 1, id, sessionId: id, seed, thoughtId: 'thought', mode: 'append', text: '草稿', updatedAt: 1 }; }
it.each(['autosave', 'save', 'discard'])('stale recovered source cannot delete newer draft via %s', async mode => {
  const source = await repo.saveDraft(draft('source'));
  const copy = { ...draft('copy'), recoveryDraftId: source.id, recoveryDraftRevision: source.revision };
  await repo.saveDraft({ ...source, text: '另一窗口的最新草稿' });
  const before = await repo.snapshot();
  const action = mode === 'autosave' ? repo.saveDraft(copy) : mode === 'save' ? repo.saveThought({ seed, id: copy.thoughtId, text: copy.text, mode: 'append', draftId: copy.id, recoveryDraftId: source.id, recoveryDraftRevision: source.revision }) : repo.discardDraft(copy.id, source.id, source.revision);
  await expect(action).rejects.toThrow('另一窗口');
  expect(await repo.snapshot()).toEqual(before);
});
it('successful recovery transfers once, repeated saves and second recovery leave no stale drafts', async () => {
  const source = await repo.saveDraft(draft('source'));
  const copy = await repo.saveDraft({ ...draft('copy'), recoveryDraftId: source.id, recoveryDraftRevision: source.revision });
  expect(copy.recoveryDraftId).toBeUndefined();
  const updated = await repo.saveDraft({ ...copy, text: '继续写' });
  const last = await repo.saveDraft({ ...draft('last'), text: updated.text, recoveryDraftId: updated.id, recoveryDraftRevision: updated.revision });
  await repo.saveThought({ seed, id: last.thoughtId, text: last.text, mode: 'append', draftId: last.id });
  expect(await db.annotationDrafts.count()).toBe(0);
  expect(await db.thoughts.count()).toBe(1);
});
it.each(['annotation', 'thought'])('delete %s must recheck confirmed draft count inside transaction', async kind => {
  const t = await repo.saveThought({ seed, id: 'thought', text: '正式思考', mode: 'append' });
  const a = (await repo.snapshot()).annotations[0];
  await repo.saveDraft({ ...draft('new'), annotationId: a.id, thoughtId: t.id, mode: 'edit', baseRevision: t.revision });
  const before = await repo.snapshot();
  const method = kind === 'annotation' ? repo.removeAnnotation.bind(repo) : repo.removeThought.bind(repo);
  await expect(method(kind === 'annotation' ? a.id : t.id, kind === 'annotation' ? a.revision : t.revision, { thoughts: 1, drafts: 0 })).rejects.toThrow('数量');
  expect(await repo.snapshot()).toEqual(before);
});
it('full long book metadata and heading paths export to a recoverable JSON without truncation', async () => {
  const longSeed = { ...seed, bookSnapshot: { ...seed.bookSnapshot, title: '书'.repeat(1001), author: '作'.repeat(1001) }, source: { tocPath: Array.from({ length: 31 }, (_, i) => `目录${i}`), headingPath: ['标题'.repeat(1001)] } };
  await repo.change(longSeed, { isBookmarked: true });
  const state = await repo.snapshot(); const b = backupOf(state, state.annotations.map(a => a.id));
  const blob = await makeDownload(b, 'json', new AbortController().signal, () => {});
  expect(parseBackup(await blob.text()).annotations[0].source).toEqual(longSeed.source);
  expect(parseBackup(await blob.text()).annotations[0].bookSnapshot).toEqual(longSeed.bookSnapshot);
});
