import { library, type LibraryDatabase } from './library';
import { sameExcerpt } from './annotationGroups';
import { anchorKey, type AnnotationRecord, type AnnotationSeed, type AnnotationDraft, type NotesSnapshot, type ThoughtEntry } from './annotationTypes';
export class RevisionConflict extends Error { constructor() { super('记录已在另一窗口修改或删除，请重新打开后重试。'); } }
export class DeletionChanged extends Error { constructor() { super('记录或思考 / 草稿数量已变化，请核对更新后的数量再次确认。'); } }
export interface DeleteCounts { thoughts: number; drafts: number }
export type AnnotationChanges = Pick<AnnotationRecord, 'title' | 'line' | 'highlightColor' | 'isBookmarked'>;
export interface UndoToken { expires: number; annotation: AnnotationRecord; thoughts: ThoughtEntry[]; drafts: AnnotationDraft[]; whole: boolean; afterRevision?: number }
export class AnnotationRepository {
  constructor(readonly db: LibraryDatabase) {}
  private tables() { return [this.db.annotations, this.db.thoughts, this.db.annotationDrafts]; }
  snapshot(): Promise<NotesSnapshot> {
    return this.db.transaction('r', this.tables(), async () => ({ annotations: await this.db.annotations.toArray(), thoughts: await this.db.thoughts.toArray(), drafts: await this.db.annotationDrafts.toArray() }));
  }
  private async obtain(seed: AnnotationSeed, expected?: { id: string; revision: number }) {
    const current = await this.db.annotations.where('anchorKey').equals(anchorKey(seed)).first()
      ?? (await this.db.annotations.where('bookId').equals(seed.bookId).toArray()).find(a => sameExcerpt(a, seed));
    if (expected && (!current || current.id !== expected.id || current.revision !== expected.revision)) throw new RevisionConflict();
    if (current) return current;
    if (!seed.quote.exact.trim() || seed.quote.exact.length > 10000) throw new Error('选文为空或超过 10,000 字，请分段摘录。');
    const now = Date.now();
    const record: AnnotationRecord = { ...seed, version: 1, id: crypto.randomUUID(), anchorKey: anchorKey(seed), title: '', line: null, highlightColor: null, isBookmarked: false, automaticLineSuppressed: false, nextThoughtOrdinal: 1, createdAt: now, updatedAt: now, revision: 1 };
    await this.db.annotations.add(record);
    return record;
  }
  async change(seed: AnnotationSeed, changes: Partial<AnnotationChanges>, expected?: { id: string; revision: number }) {
    return this.db.transaction('rw', this.tables(), async () => {
      const a = await this.obtain(seed, expected);
      const next = { ...a, ...changes, automaticLineSuppressed: changes.line === null && a.line !== null ? true : a.automaticLineSuppressed, updatedAt: Date.now(), revision: a.revision + 1 };
      await this.db.annotations.put(next);
      return next;
    });
  }
  async changeGroup(members: AnnotationRecord[], changes: Partial<AnnotationChanges>) {
    return this.db.transaction('rw', this.tables(), async () => {
      for (const a of members) await this.change(a, changes, { id: a.id, revision: a.revision });
    });
  }
  /** Explicitly replace an excerpt's range without dropping its thoughts or drafts. */
  async reselectGroup(members: AnnotationRecord[], seed: AnnotationSeed, changes: Partial<AnnotationChanges>) {
    if (!members.length || members.some(a => a.bookId !== seed.bookId)) throw new Error('只能在原书中重新选择摘录。');
    if (!seed.quote.exact.trim() || seed.quote.exact.length > 10000) throw new Error('选文为空或超过 10,000 字，请分段摘录。');
    return this.db.transaction('rw', this.tables(), async () => {
      const ids = new Set(members.map(a => a.id)), anchors = new Set(members.map(a => a.anchorKey));
      for (const member of members) {
        const current = await this.db.annotations.get(member.id);
        if (!current || current.revision !== member.revision) throw new RevisionConflict();
      }
      const others = (await this.db.annotations.where('bookId').equals(seed.bookId).toArray()).filter(a => !ids.has(a.id));
      if (others.some(a => a.anchorKey === anchorKey(seed) || sameExcerpt(a, seed))) throw new Error('所选原文已有另一条摘录，请选择其他范围；原有笔记未更改。');
      const primary = members[0], now = Date.now();
      const thoughts = (await this.db.thoughts.toArray()).filter(t => ids.has(t.annotationId));
      const drafts = (await this.db.annotationDrafts.toArray()).filter(d => ids.has(d.annotationId ?? '') || anchors.has(anchorKey(d.seed)));
      // Historical duplicates become one record only when the user explicitly saves a new range.
      // Keep every thought ID/text/date and every draft; revisions invalidate stale editors.
      let nextOrdinal = Math.max(...members.map(a => a.nextThoughtOrdinal));
      const used = new Set(thoughts.filter(t => t.annotationId === primary.id).map(t => t.ordinal));
      for (const t of thoughts) {
        let ordinal = t.ordinal;
        if (t.annotationId !== primary.id && used.has(ordinal)) ordinal = nextOrdinal++;
        used.add(ordinal); nextOrdinal = Math.max(nextOrdinal, ordinal + 1);
        if (t.annotationId !== primary.id || ordinal !== t.ordinal) await this.db.thoughts.put({ ...t, annotationId: primary.id, ordinal, revision: t.revision + 1 });
      }
      for (const draft of drafts) {
        const thought = thoughts.find(t => t.id === draft.thoughtId);
        const latestThought = thought && await this.db.thoughts.get(thought.id);
        await this.db.annotationDrafts.put({ ...draft, seed, annotationId: primary.id,
          baseRevision: thought && draft.baseRevision === thought.revision ? latestThought?.revision : draft.baseRevision,
          revision: (draft.revision ?? 0) + 1, updatedAt: now });
      }
      await this.db.annotations.bulkDelete(members.slice(1).map(a => a.id));
      const next: AnnotationRecord = {
        ...primary, ...seed,
        title: [...new Set(members.map(a => a.title).filter(Boolean))].join(' / '),
        line: members.find(a => a.line)?.line ?? null,
        highlightColor: members.find(a => a.highlightColor)?.highlightColor ?? null,
        ...changes, anchorKey: anchorKey(seed), nextThoughtOrdinal: nextOrdinal,
        automaticLineSuppressed: changes.line === null && members.some(a => a.line) ? true : primary.automaticLineSuppressed,
        revision: primary.revision + 1, updatedAt: now,
      };
      await this.db.annotations.put(next);
      return next;
    });
  }
  async removeGroup(members: AnnotationRecord[], confirmed: DeleteCounts): Promise<UndoToken[]> {
    return this.db.transaction('rw', this.tables(), async () => {
      const state = await this.snapshot(), ids = new Set(members.map(a => a.id)), anchors = new Set(members.map(a => a.anchorKey));
      if (state.thoughts.filter(t => ids.has(t.annotationId)).length !== confirmed.thoughts || state.drafts.filter(d => ids.has(d.annotationId ?? '') || anchors.has(anchorKey(d.seed))).length !== confirmed.drafts) throw new DeletionChanged();
      const tokens: UndoToken[] = [];
      for (const a of members) tokens.push(await this.removeAnnotation(a.id, a.revision));
      return tokens;
    });
  }
  async undoGroup(tokens: UndoToken[]) {
    return this.db.transaction('rw', this.tables(), async () => { for (const token of tokens) await this.undo(token); });
  }
  private async recoverySource(id?: string, recoveryId?: string, revision?: number, allowMissing = false) {
    if (!recoveryId) return undefined;
    // A persisted replacement has already transferred its source in a successful transaction.
    const copy = id && await this.db.annotationDrafts.get(id);
    if (copy && !copy.recoveryDraftId) return undefined;
    const source = await this.db.annotationDrafts.get(recoveryId);
    if (!source && allowMissing) return undefined;
    if (!source || revision === undefined || (source.revision ?? 0) !== revision) throw new RevisionConflict();
    return source.id;
  }
  async saveThought(input: { seed: AnnotationSeed; id: string; text: string; mode: 'append' | 'edit'; revision?: number; draftId?: string; recoveryDraftId?: string; recoveryDraftRevision?: number; annotationId?: string }) {
    if (!input.text.trim() || input.text.length > 20000) throw new Error('思考不能为空，最多 20,000 字。清空已有思考请使用删除。');
    return this.db.transaction('rw', this.tables(), async () => {
      const existing = await this.db.thoughts.get(input.id);
      if (input.mode === 'append' && existing) {
        const parent = await this.db.annotations.get(existing.annotationId);
        if (!parent || parent.anchorKey !== anchorKey(input.seed) || existing.text !== input.text || input.annotationId && parent.id !== input.annotationId) throw new RevisionConflict();
        const sourceId = await this.recoverySource(input.draftId, input.recoveryDraftId, input.recoveryDraftRevision, true);
        if (input.draftId) await this.db.annotationDrafts.delete(input.draftId);
        if (sourceId) await this.db.annotationDrafts.delete(sourceId);
        return existing;
      }
      if (input.mode === 'edit' && (!existing || existing.revision !== input.revision)) throw new RevisionConflict();
      const sourceId = await this.recoverySource(input.draftId, input.recoveryDraftId, input.recoveryDraftRevision);
      const a = await this.obtain(input.seed);
      if (input.annotationId && a.id !== input.annotationId) throw new RevisionConflict();
      const now = Date.now();
      const t: ThoughtEntry = existing ? { ...existing, text: input.text, updatedAt: now, revision: existing.revision + 1 } : { version: 1, id: input.id, annotationId: a.id, bookId: a.bookId, ordinal: a.nextThoughtOrdinal, text: input.text, createdAt: now, updatedAt: now, revision: 1 };
      if (existing && existing.annotationId !== a.id) throw new RevisionConflict();
      await this.db.thoughts.put(t);
      const firstThought = !existing && await this.db.thoughts.where('annotationId').equals(a.id).count() === 1;
      await this.db.annotations.put({ ...a, line: firstThought && !a.line && !a.automaticLineSuppressed ? { style: 'solid', color: '#52735c', origin: 'thought' } : a.line, nextThoughtOrdinal: existing ? a.nextThoughtOrdinal : a.nextThoughtOrdinal + 1, revision: a.revision + 1, updatedAt: now });
      if (input.draftId) await this.db.annotationDrafts.delete(input.draftId);
      if (sourceId) await this.db.annotationDrafts.delete(sourceId);
      return t;
    });
  }
  async saveDraft(draft: AnnotationDraft): Promise<AnnotationDraft & { revision: number }> {
    if (draft.text.length > 20000) throw new Error('草稿超过 20,000 字。');
    return this.db.transaction('rw', [this.db.annotations, this.db.annotationDrafts], async () => {
      if (draft.annotationId && !await this.db.annotations.get(draft.annotationId)) throw new RevisionConflict();
      const current = await this.db.annotationDrafts.get(draft.id);
      if (current ? current.sessionId !== draft.sessionId || (current.revision ?? 0) !== (draft.revision ?? 0) : (draft.revision ?? 0) !== 0) throw new RevisionConflict();
      const sourceId = await this.recoverySource(draft.id, draft.recoveryDraftId, draft.recoveryDraftRevision);
      const { recoveryDraftId: _source, recoveryDraftRevision: _revision, ...content } = draft;
      const next = { ...content, revision: (current?.revision ?? 0) + 1 };
      await this.db.annotationDrafts.put(next);
      if (sourceId) await this.db.annotationDrafts.delete(sourceId);
      return next;
    });
  }
  async discardDraft(id: string, recoveryDraftId?: string, recoveryDraftRevision?: number) {
    await this.db.transaction('rw', this.db.annotationDrafts, async () => {
      const sourceId = await this.recoverySource(id, recoveryDraftId, recoveryDraftRevision);
      await this.db.annotationDrafts.delete(id);
      if (sourceId) await this.db.annotationDrafts.delete(sourceId);
    });
  }
  async removeAnnotation(id: string, revision: number, confirmed?: DeleteCounts): Promise<UndoToken> {
    return this.db.transaction('rw', this.tables(), async () => {
      const a = await this.db.annotations.get(id);
      if (!a || a.revision !== revision) throw new RevisionConflict();
      const thoughts = await this.db.thoughts.where('annotationId').equals(id).toArray();
      const drafts = (await this.db.annotationDrafts.toArray()).filter(d => d.annotationId === id || anchorKey(d.seed) === a.anchorKey);
      if (confirmed && (confirmed.thoughts !== thoughts.length || confirmed.drafts !== drafts.length)) throw new DeletionChanged();
      await this.db.thoughts.bulkDelete(thoughts.map(t => t.id));
      await this.db.annotationDrafts.bulkDelete(drafts.map(d => d.id));
      await this.db.annotations.delete(id);
      return { expires: Date.now() + 10000, annotation: a, thoughts, drafts, whole: true };
    });
  }
  async removeThought(id: string, revision: number, confirmed?: DeleteCounts): Promise<UndoToken> {
    return this.db.transaction('rw', this.tables(), async () => {
      const t = await this.db.thoughts.get(id);
      if (!t || t.revision !== revision) throw new RevisionConflict();
      const a = await this.db.annotations.get(t.annotationId);
      if (!a) throw new RevisionConflict();
      const drafts = await this.db.annotationDrafts.where('thoughtId').equals(id).toArray();
      if (confirmed && (confirmed.thoughts !== 1 || confirmed.drafts !== drafts.length)) throw new DeletionChanged();
      await this.db.annotationDrafts.bulkDelete(drafts.map(d => d.id));
      await this.db.thoughts.delete(id);
      const remaining = await this.db.thoughts.where('annotationId').equals(a.id).count();
      await this.db.annotations.put({ ...a, revision: a.revision + 1, updatedAt: Date.now(), line: !remaining && a.line?.origin === 'thought' ? null : a.line });
      return { expires: Date.now() + 10000, annotation: a, thoughts: [t], drafts, whole: false, afterRevision: a.revision + 1 };
    });
  }
  async undo(token: UndoToken) {
    if (Date.now() > token.expires) throw new Error('撤销时限已过；刷新后不保留撤销记录。');
    await this.db.transaction('rw', this.tables(), async () => {
      const a = await this.db.annotations.get(token.annotation.id);
      if (token.whole) {
        if (a || await this.db.annotations.where('anchorKey').equals(token.annotation.anchorKey).count()) throw new RevisionConflict();
        await this.db.annotations.add(token.annotation);
      } else {
        if (!a || a.revision !== token.afterRevision) throw new RevisionConflict();
        await this.db.annotations.put({ ...token.annotation, revision: a.revision + 1, updatedAt: Date.now() });
      }
      for (const t of token.thoughts) await this.db.thoughts.add(t);
      for (const d of token.drafts) await this.db.annotationDrafts.add(d);
    });
  }
}
export const annotations = new AnnotationRepository(library.db);
