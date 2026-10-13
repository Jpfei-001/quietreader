import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { liveQuery } from 'dexie';
import { flushSync } from 'react-dom';
import { annotations, RevisionConflict, DeletionChanged, type AnnotationChanges, type UndoToken } from '../platform/annotations';
import { reportStorageDiagnostic, storageDiagnostic, storageFailureText, type StorageDiagnostic } from '../platform/storageDiagnostics';
import { anchorKey, HIGHLIGHTS, sourceLabel, type AnnotationDraft, type AnnotationRecord, type AnnotationSeed, type NotesSnapshot, type ThoughtEntry, type NotebookRequest } from '../platform/annotationTypes';
import type { ReaderSession } from '../reader/engine';
import type { ScreenRect } from '../reader/selection';
import SelectionToolbar from './SelectionToolbar';
import ThoughtPopoverEditor from './ThoughtPopoverEditor';
import DraftRecoveryDialog from './DraftRecoveryDialog';
import NotebookPage, { ThoughtList } from './NotebookPage';
import { NoteDialog, useFloatingPosition } from './notePrimitives';
import ExcerptAdjustEditor from './ExcerptAdjustEditor';
import { ExportDialog, RestoreDialog } from './NoteTransferDialogs';
import type { LibraryBook } from '../platform/library';
import { activeAnnotationGroups, groupAnnotations, sameExcerpt } from '../platform/annotationGroups';
import AnnotationTags from './AnnotationTags';
export interface NotesHandle { guard(action: () => void): void; escape(): boolean; openNotebook(options?: Omit<NotebookRequest, 'key'>): void; blocking(): boolean; appendAi(seed: AnnotationSeed, text: string, thoughtId: string, onSaved: () => void): void }
interface Editor { draft: AnnotationDraft; initial: string; text: string; point: { x: number; y: number } }
interface Adjustment { a: AnnotationRecord; members: AnnotationRecord[]; changes: AnnotationChanges; initial: string; seed?: AnnotationSeed }
function adjustmentDirty(a: Adjustment) { return !!a.seed || JSON.stringify(a.changes) !== a.initial; }
const empty: NotesSnapshot = { annotations: [], thoughts: [], drafts: [] };
function errorMessage(e: unknown) { return e instanceof Error && /[\u3400-\u9fff]/.test(e.message) ? e.message : '本机保存失败，请检查存储空间和权限后重试；输入仍保留。'; }
function StorageDiagnosticDetails({ diagnostic, onNotice }: { diagnostic: StorageDiagnostic; onNotice(text: string): void }) {
  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
      onNotice('已复制不含正文的存储诊断。');
    } catch { onNotice('剪贴板权限不可用，可手动选择上面的诊断文字复制。'); }
  }
  return <details className="storage-diagnostic"><summary>不含正文的存储诊断（可复制）</summary><pre>{JSON.stringify(diagnostic, null, 2)}</pre><button onClick={() => void copy()}>复制存储诊断</button></details>;
}
function markerPath(rect: ScreenRect) { let d = `M${rect.x} ${rect.y + rect.height - 1}`; for (let x = 0; x < rect.width; x += 6) d += ` q3 ${Math.floor(x/6)%2 ? 3 : -3} 6 0`; return d; }
function HoverCard({ a, members, thoughts, point, onEnter, onLeave, onClose, onAppend, onEdit, onDelete, onNotebook }: {
  a: AnnotationRecord; members: AnnotationRecord[]; thoughts: ThoughtEntry[]; point: { x: number; y: number }; onEnter(): void; onLeave(): void; onClose(): void; onAppend(): void; onEdit(t: ThoughtEntry): void; onDelete(t: ThoughtEntry): void; onNotebook(): void;
}) {
  const { ref, style } = useFloatingPosition(point, 520);
  return <section ref={ref} style={style} className="note-popover thought-hover" aria-label="思考预览" onPointerEnter={onEnter} onPointerLeave={onLeave} onFocus={onEnter} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onLeave(); }}><header><h3>摘录与思考</h3><button aria-label="关闭思考预览" onClick={onClose}>×</button></header><blockquote>{a.quote.exact}</blockquote><small>摘录自：{sourceLabel(a)}</small>{thoughts.length > 5 && <p>仅显示最近 5 条；在笔记中查看全部 {thoughts.length} 条。</p>}<ThoughtList entries={thoughts.slice(-5)} onEdit={onEdit} onDelete={onDelete} /><div className="hover-toolbar"><AnnotationTags members={members} thoughtCount={thoughts.length} /><div className="note-actions"><button onClick={onAppend}>追加思考</button><button onClick={onNotebook}>在笔记中查看</button></div></div></section>;
}
export default function NotesExperience({ ref, session, bookId, bookSnapshot, books, notebook, onNotebookChange: setNotebook, onLocate, onNotice, onAskAi }: {
  ref: Ref<NotesHandle>; session: ReaderSession | null; bookId?: string; bookSnapshot?: AnnotationSeed['bookSnapshot']; books: LibraryBook[];
  notebook?: NotebookRequest; onNotebookChange(request: NotebookRequest | undefined): void;
  onLocate(a: AnnotationRecord): Promise<void>; onNotice(text: string): void; onAskAi?(seed: AnnotationSeed): void;
}) {
  const [snapshot, setSnapshot] = useState<NotesSnapshot>(empty);
  const [selected, setSelected] = useState<{ seed: AnnotationSeed; point: { x: number; y: number } }>();
  const [geometry, setGeometry] = useState<{ a: AnnotationRecord; rects: ScreenRect[] }[]>([]);
  const [recoverChoice, setRecoverChoice] = useState<{ seed: AnnotationSeed; a?: AnnotationRecord; drafts: AnnotationDraft[] }>();
  const [editor, setEditor] = useState<Editor>(); const editorRef = useRef(editor); editorRef.current = editor;
  const [diagnostic, setDiagnostic] = useState<StorageDiagnostic>();
  const [draftStatus, setDraftStatus] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const groups = useMemo(() => groupAnnotations(snapshot), [snapshot]);
  const groupFor = (a: AnnotationRecord) => groups.find(g => g.members.some(member => member.id === a.id));
  const [hover, setHover] = useState<{ id: string; point: { x: number; y: number } }>();
  const [adjust, setAdjust] = useState<Adjustment>(); const adjustRef = useRef(adjust); adjustRef.current = adjust;
  const [deleting, setDeleting] = useState<{ a?: AnnotationRecord; members?: AnnotationRecord[]; t?: ThoughtEntry; drafts: number; thoughts: number }>();
  const restoreBusy = useRef(false);
  const openingAdjust = useRef(false);
  const [exporting, setExporting] = useState<{ ids: string[]; scope: string }>(); const [restoring, setRestoring] = useState(false);
  const [pending, setPending] = useState<{ action: () => void }>(); const [undo, setUndo] = useState<UndoToken[]>();
  const aiSaveCallbacks = useRef(new Map<string, () => void>());
  const sessionId = useRef(crypto.randomUUID()); const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const draftQueue = useRef(Promise.resolve());
  const draftRevisions = useRef(new Map<string, number>());
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); const hoverId = useRef<string | undefined>(undefined); const overCard = useRef(false);
  const stateRef = useRef({ snapshot, groups, geometry, busy, notebook, exporting, restoring, deleting }); stateRef.current = { snapshot, groups, geometry, busy, notebook, exporting, restoring, deleting };
  const selectedGroup = selected && groups.find(g => sameExcerpt(g.annotation, selected.seed));
  const selectedAnnotation = selectedGroup && { ...selectedGroup.annotation, line: selectedGroup.members.find(a => a.line)?.line ?? null, highlightColor: selectedGroup.members.find(a => a.highlightColor)?.highlightColor ?? null };
  function clearHoverTimers() { clearTimeout(hoverTimer.current); clearTimeout(leaveTimer.current); }
  function guard(action: () => void) {
    if (lock.current || restoreBusy.current || openingAdjust.current) return;
    clearHoverTimers(); overCard.current = false; hoverId.current = undefined; setRecoverChoice(undefined);
    const e = editorRef.current, a = adjustRef.current;
    if (a && adjustmentDirty(a)) { setPending({ action }); return; }
    if (e) { void closeAndKeepDraft().then(success => { if (success) action(); }); return; }
    setEditor(undefined); editorRef.current = undefined; setAdjust(undefined); setSelected(undefined); setHover(undefined); setError(''); action();
  }
  useImperativeHandle(ref, () => ({ guard, appendAi: (seed, text, thoughtId, onSaved) => {
    aiSaveCallbacks.current.set(thoughtId, onSaved);
    openEditor(seed, undefined, undefined, { version: 1, id: crypto.randomUUID(), sessionId: sessionId.current, seed: structuredClone(seed), thoughtId, mode: 'append', text, updatedAt: Date.now() });
  }, openNotebook: (options = {}) => guard(() => setNotebook({ ...options, key: crypto.randomUUID() })), blocking: () => !!(editor || adjust || openingAdjust.current || notebook || exporting || restoring || deleting || pending || recoverChoice), escape: () => {
    if (pending) { setPending(undefined); return true; }
    if (recoverChoice) { setRecoverChoice(undefined); return true; }
    if (editor) { void closeAndKeepDraft(); return true; }
    if (adjust) { guard(() => {}); return true; }
    if (restoring) { if (!restoreBusy.current) setRestoring(false); return true; }
    if (exporting) { setExporting(undefined); return true; }
    if (deleting) { if (!busy) setDeleting(undefined); return true; }
    if (hover) { setHover(undefined); return true; }
    if (selected) { setSelected(undefined); return true; }
    return false;
  } }));
  useEffect(() => {
    const sub = liveQuery(() => annotations.snapshot()).subscribe({ next: setSnapshot, error: e => setError(errorMessage(e)) });
    return () => { sub.unsubscribe(); clearTimeout(draftTimer.current); clearHoverTimers(); };
  }, []);
  useEffect(() => {
    setSelected(undefined); setHover(undefined); clearHoverTimers(); setGeometry([]);
    if (!session || !bookId || !bookSnapshot) return;
    const redraw = () => setGeometry(activeAnnotationGroups(stateRef.current.snapshot).filter(g => g.annotation.bookId === bookId).flatMap(g => g.members).map(a => ({ a, rects: session.annotationRects(a) })));
    redraw(); const offGeometry = session.onGeometry(phase => {
      if (phase === 'changing') {
        clearHoverTimers(); overCard.current = false; hoverId.current = undefined;
        const clear = () => { setGeometry([]); setSelected(undefined); setHover(undefined); };
        // 已绘制的标记必须在阅读引擎移动正文之前移除，不能等待 React 的批量更新。
        // 新会话尚无标记时无需强制提交，避免在打开书籍的 effect 中同步刷新。
        if (stateRef.current.geometry.some(g => g.rects.length)) flushSync(clear);
        else clear();
      } else {
        // 使用此刻正文的坐标，在同一绘制帧提交，不再额外等待一帧。
        flushSync(redraw);
      }
    });
    const offSelection = session.onSelection(selection => {
      if (stateRef.current.notebook) return;
      if (editorRef.current) { guard(() => {}); return; }
      const current = adjustRef.current;
      if (current) {
        if (lock.current) return;
        if (bookId !== current.a.bookId) { setError('只能在原书中重新选择摘录。'); return; }
        const seed = { ...selection.seed, bookId, bookSnapshot };
        const unchanged = JSON.stringify(seed.locator) === JSON.stringify(current.a.locator) && JSON.stringify(seed.quote) === JSON.stringify(current.a.quote);
        const next = { ...current, seed: unchanged ? undefined : seed };
        adjustRef.current = next; setAdjust(next); setHover(undefined); return;
      }
      const rect = selection.rects.find(r => r.x >= 0 && r.x < innerWidth) ?? selection.rects[0];
      if (rect) { setSelected({ seed: { ...selection.seed, bookId, bookSnapshot }, point: { x: rect.x, y: rect.y } }); setHover(undefined); }
    });
    const offPointer = session.onPointer(point => {
      if (point?.dragging) {
        setSelected(undefined); setHover(undefined); overCard.current = false;
        if (editorRef.current) guard(() => {});
      }
      if (!point || point.dragging || point.hasSelection || editorRef.current || adjustRef.current || stateRef.current.notebook || stateRef.current.exporting || stateRef.current.restoring) { clearTimeout(hoverTimer.current); hoverId.current = undefined; if (!overCard.current) leaveHover(); return; }
      const matches = stateRef.current.geometry.filter(g => g.rects.some(r => point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height));
      if (!matches.length) { clearTimeout(hoverTimer.current); hoverId.current = undefined; leaveHover(); return; }
      const matched = matches.slice().sort((a, b) => b.a.quote.exact.length - a.a.quote.exact.length)[0].a;
      const id = stateRef.current.groups.find(g => g.members.some(a => a.id === matched.id))?.annotation.id ?? matched.id;
      clearTimeout(leaveTimer.current);
      if (hoverId.current === id) return;
      hoverId.current = id; clearTimeout(hoverTimer.current);
      hoverTimer.current = setTimeout(() => { setHover({ id, point }); setSelected(undefined); }, 250);
    });
    window.addEventListener('resize', redraw);
    return () => { offGeometry(); offSelection(); offPointer(); window.removeEventListener('resize', redraw); clearHoverTimers(); };
  }, [session, bookId]);
  useEffect(() => {
    if (session && bookId) setGeometry(activeAnnotationGroups(snapshot).filter(g => g.annotation.bookId === bookId).flatMap(g => g.members).map(a => ({ a, rects: session.annotationRects(a) })));
  }, [snapshot, session, bookId, notebook]);
  useEffect(() => {
    if (!editor) return;
    if (editor.text === editor.initial || editor.draft.mode === 'append' && !editor.text.trim()) {
      clearTimeout(draftTimer.current);
      const current = editor;
      const operation = draftQueue.current.catch(() => {}).then(async () => {
        await annotations.discardDraft(current.draft.id, current.draft.recoveryDraftId, current.draft.recoveryDraftRevision);
        // The next queued input creates a fresh revision-0 draft, even if its captured editor
        // still contains the revision from before the user's revert.
        draftRevisions.current.set(current.draft.id, 0);
        if (editorRef.current?.draft.id === current.draft.id) {
          const draft = { ...editorRef.current.draft, revision: undefined, recoveryDraftId: undefined, recoveryDraftRevision: undefined };
          editorRef.current = { ...editorRef.current, draft };
          setEditor(previous => previous?.draft.id === current.draft.id ? { ...previous, draft } : previous);
        }
      });
      draftQueue.current = operation;
      void operation.catch(e => setError(errorMessage(e)));
      setDraftStatus('没有未保存修改');
      return;
    }
    setDraftStatus('草稿待保存'); clearTimeout(draftTimer.current);
    const current = editor;
    draftTimer.current = setTimeout(() => { void persistDraft(current).catch(e => { setDraftStatus('草稿保存失败'); setError(errorMessage(e)); }); }, 500);
    return () => clearTimeout(draftTimer.current);
  }, [editor?.text, editor?.draft.id]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (editorRef.current?.text !== undefined && editorRef.current.text !== editorRef.current.initial || adjustRef.current && adjustmentDirty(adjustRef.current)) { event.preventDefault(); event.returnValue = ''; } };
    const outside = (event: PointerEvent) => {
      if (editorRef.current && !(event.target as Element).closest('.thought-editor,.notes-modal-backdrop,[data-note-guarded]')) guard(() => {});
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('pointerdown', outside); };
  }, []);
  useEffect(() => {
    if (!undo) return; const timer = setTimeout(() => setUndo(undefined), Math.max(0, Math.min(...undo.map(token => token.expires)) - Date.now())); return () => clearTimeout(timer);
  }, [undo]);
  function leaveHover() {
    clearTimeout(leaveTimer.current); leaveTimer.current = setTimeout(() => { if (!overCard.current && !document.activeElement?.closest('.thought-hover')) { setHover(undefined); hoverId.current = undefined; } }, 200);
  }
  async function persistDraft(current: Editor) {
    const d = { ...current.draft, text: current.text, updatedAt: Date.now() };
    const operation = draftQueue.current.catch(() => {}).then(async () => {
      const latest = editorRef.current?.draft.id === d.id ? editorRef.current.draft : d;
      const saved = await annotations.saveDraft({ ...d, recoveryDraftId: latest.recoveryDraftId, recoveryDraftRevision: latest.recoveryDraftRevision, revision: draftRevisions.current.get(d.id) ?? latest.revision });
      draftRevisions.current.set(d.id, saved.revision);
      if (editorRef.current?.draft.id === d.id) {
        editorRef.current = { ...editorRef.current, draft: saved };
        setEditor(previous => previous?.draft.id === d.id ? { ...previous, draft: saved } : previous);
      }
    }); draftQueue.current = operation;
    await operation;
    if (editorRef.current?.draft.id === d.id && editorRef.current.text === d.text) setDraftStatus('草稿已保存');
  }
  async function run(action: () => Promise<void>, operation = 'notes.write') {
    if (lock.current || restoreBusy.current) return;
    const focused = document.activeElement instanceof HTMLElement && document.activeElement.closest('.selection-toolbar,.thought-editor') ? document.activeElement : null;
    lock.current = true; setBusy(true); setError(''); setDiagnostic(undefined);
    try { await action(); return true; } catch (e) {
      const detail = storageDiagnostic(e, annotations.db, operation);
      setDiagnostic(detail);
      if (operation === 'annotations.line' || operation === 'annotations.highlight') void reportStorageDiagnostic(detail);
      setError(e instanceof RevisionConflict || e instanceof DeletionChanged || e instanceof Error && e.name === 'Error' && /[\u3400-\u9fff]/.test(e.message) ? e.message : storageFailureText(detail));
      return false;
    } finally {
      lock.current = false; setBusy(false);
      requestAnimationFrame(() => { if (focused?.isConnected && (document.activeElement === document.body || document.activeElement === focused)) focused.focus(); });
    }
  }
  async function saveEditor(): Promise<boolean> {
    clearTimeout(draftTimer.current);
    await draftQueue.current.catch(() => {});
    const e = editorRef.current; if (!e) return true;
    const t = await annotations.saveThought({ seed: e.draft.seed, id: e.draft.thoughtId, text: e.text, mode: e.draft.mode, revision: e.draft.baseRevision, annotationId: e.draft.annotationId, draftId: e.draft.id, recoveryDraftId: e.draft.recoveryDraftId, recoveryDraftRevision: e.draft.recoveryDraftRevision });
    setEditor(undefined); editorRef.current = undefined; setSelected(undefined); onNotice(`已${e.draft.mode === 'edit' ? '修改' : '保存'}第 ${t.ordinal} 次思考。`);
    aiSaveCallbacks.current.get(e.draft.thoughtId)?.(); aiSaveCallbacks.current.delete(e.draft.thoughtId); return true;
  }
  async function flushEditorDraft() {
    clearTimeout(draftTimer.current);
    await draftQueue.current.catch(() => {});
    const current = editorRef.current; if (!current) return;
    try {
      if (current.text === current.initial || current.draft.mode === 'append' && !current.text.trim()) {
        await annotations.discardDraft(current.draft.id, current.draft.recoveryDraftId, current.draft.recoveryDraftRevision);
        draftRevisions.current.set(current.draft.id, 0);
        const draft = { ...current.draft, revision: undefined, recoveryDraftId: undefined, recoveryDraftRevision: undefined };
        editorRef.current = { ...current, draft };
        setEditor(editorRef.current);
        setDraftStatus('没有未保存修改');
      } else {
        setDraftStatus('正在保存草稿…');
        await persistDraft(current);
      }
    } catch (e) { setDraftStatus('草稿保存失败'); throw e; }
  }
  async function closeAndKeepDraft() {
    return run(async () => {
      await flushEditorDraft();
      clearHoverTimers(); overCard.current = false; hoverId.current = undefined;
      setEditor(undefined); editorRef.current = undefined; setSelected(undefined); setHover(undefined);
    });
  }
  async function discardEditorDraft() {
    return run(async () => {
      clearTimeout(draftTimer.current);
      await draftQueue.current.catch(() => {});
      const current = editorRef.current;
      if (current) await annotations.discardDraft(current.draft.id, current.draft.recoveryDraftId, current.draft.recoveryDraftRevision);
      setEditor(undefined); editorRef.current = undefined; setSelected(undefined);
    });
  }
  async function keepDraftNow() { return run(flushEditorDraft); }
  function openEditor(seed: AnnotationSeed, t?: ThoughtEntry, a?: AnnotationRecord, draft?: AnnotationDraft) {
    guard(() => {
      setHover(undefined); setSelected(undefined); setError(''); setDraftStatus(draft ? '恢复的本机草稿' : '未输入');
      const e: Editor = { draft: draft ?? { version: 1, id: crypto.randomUUID(), sessionId: sessionId.current, seed, annotationId: a?.id, thoughtId: t?.id ?? crypto.randomUUID(), baseRevision: t?.revision, mode: t ? 'edit' : 'append', text: '', updatedAt: Date.now() }, initial: t?.text ?? '', text: draft?.text ?? t?.text ?? '', point: selected?.point ?? { x: Math.max(12, innerWidth / 2 - 314), y: 140 } };
      setEditor(e); editorRef.current = e;
    });
  }
  function beginAppend(seed: AnnotationSeed, a?: AnnotationRecord) {
    const drafts = snapshot.drafts.filter(d => d.mode === 'append' && anchorKey(d.seed) === anchorKey(seed));
    if (drafts.length) guard(() => { setRecoverChoice({ seed, a, drafts }); });
    else openEditor(seed, undefined, a);
  }
  function append(a: AnnotationRecord) { beginAppend(a, a); }
  function restoreDraft(id: string) {
    const draft = snapshot.drafts.find(d => d.id === id); if (!draft) return;
    const a = snapshot.annotations.find(a => a.id === draft.annotationId);
    const t = snapshot.thoughts.find(t => t.id === draft.thoughtId);
    if (draft.mode === 'edit' && (!t || t.revision !== draft.baseRevision)) { setError('草稿对应的正式思考已修改或删除；请复制草稿文字后追加，不能覆盖新版本。'); return; }
    // A recovery copy has a distinct session key; successful writes remove the old copy atomically.
    openEditor(draft.seed, t, a, { ...draft, id: crypto.randomUUID(), revision: undefined, recoveryDraftId: draft.id, recoveryDraftRevision: draft.revision ?? 0, sessionId: sessionId.current });
  }
  function editThought(t: ThoughtEntry) { const a = snapshot.annotations.find(a => a.id === t.annotationId); if (a) openEditor(a, t, a); }
  async function change(changes: Partial<AnnotationChanges>) {
    if (!selected) return;
    await run(async () => { if (selectedGroup) await annotations.changeGroup(selectedGroup.members, changes); else await annotations.change(selected.seed, changes); }, changes.line !== undefined ? 'annotations.line' : changes.highlightColor !== undefined ? 'annotations.highlight' : 'annotations.bookmark');
  }
  function openAdjust(a: AnnotationRecord) {
    guard(() => {
      const members = groupFor(a)?.members ?? [a];
      const changes = { title: a.title, line: members.find(a => a.line)?.line ?? null, highlightColor: members.find(a => a.highlightColor)?.highlightColor ?? null, isBookmarked: a.isBookmarked };
      const previousNotebook = notebook;
      openingAdjust.current = true;
      setNotebook(undefined);
      void onLocate(a).then(() => {
        openingAdjust.current = false;
        const next = { a, members, changes, initial: JSON.stringify(changes) };
        adjustRef.current = next; setAdjust(next);
      }).catch(e => { openingAdjust.current = false; setNotebook(previousNotebook); setError(errorMessage(e)); });
    });
  }
  async function saveAdjust() {
    const current = adjustRef.current; if (!current) return;
    const initial = JSON.parse(current.initial) as AnnotationChanges;
    const changes: Partial<AnnotationChanges> = {};
    if (current.changes.title !== initial.title) changes.title = current.changes.title;
    if (JSON.stringify(current.changes.line) !== JSON.stringify(initial.line)) changes.line = current.changes.line;
    if (current.changes.highlightColor !== initial.highlightColor) changes.highlightColor = current.changes.highlightColor;
    if (current.seed) await annotations.reselectGroup(current.members, current.seed, changes);
    else if (Object.keys(changes).length) await annotations.changeGroup(current.members, changes);
    setAdjust(undefined); adjustRef.current = undefined;
    setSelected(undefined); onNotice('已保存摘录调整，思考与草稿已保留。');
  }
  function askDelete(a?: AnnotationRecord, t?: ThoughtEntry) {
    guard(() => {
      const members = a ? groupFor(a)?.members ?? [a] : undefined;
      const ids = new Set(members?.map(a => a.id)), anchors = new Set(members?.map(a => a.anchorKey));
      setDeleting({ a, members, t, thoughts: a ? snapshot.thoughts.filter(t => ids.has(t.annotationId)).length : 1, drafts: snapshot.drafts.filter(d => a ? ids.has(d.annotationId ?? '') || anchors.has(anchorKey(d.seed)) : d.thoughtId === t?.id).length });
    });
  }
  function beginExport(ids: string[], scope: string) { guard(() => setExporting({ ids, scope })); }
  function resolvePending(mode: 'save' | 'keep' | 'discard') {
    const action = pending?.action;
    void run(async () => {
      const current = editorRef.current;
      if (current) {
        if (mode === 'save') await saveEditor();
        else if (mode === 'keep') { clearTimeout(draftTimer.current); await persistDraft(current); }
        else { clearTimeout(draftTimer.current); await draftQueue.current.catch(() => {}); await annotations.discardDraft(current.draft.id, current.draft.recoveryDraftId, current.draft.recoveryDraftRevision); }
      } else if (adjustRef.current && mode === 'save') await saveAdjust();
      setPending(undefined); setEditor(undefined); editorRef.current = undefined; setAdjust(undefined); adjustRef.current = undefined; setSelected(undefined); setHover(undefined);
    }).then(success => { if (success) action?.(); });
  }
  async function confirmDelete() {
    if (!deleting) return;
    try {
      if (deleting.a) setUndo(await annotations.removeGroup(deleting.members ?? [deleting.a], deleting));
      else if (deleting.t) setUndo([await annotations.removeThought(deleting.t.id, deleting.t.revision, deleting)]);
    } catch (e) {
      if (e instanceof DeletionChanged || e instanceof RevisionConflict) {
        const latest = await annotations.snapshot();
        const a = deleting.a && latest.annotations.find(a => a.id === deleting.a!.id);
        const t = deleting.t && latest.thoughts.find(t => t.id === deleting.t!.id);
        const members = a ? groupAnnotations(latest).find(g => g.members.some(member => member.id === a.id))?.members ?? [a] : undefined;
        const ids = new Set(members?.map(a => a.id)), anchors = new Set(members?.map(a => a.anchorKey));
        if (a || t) setDeleting({ a, members, t, thoughts: a ? latest.thoughts.filter(t => ids.has(t.annotationId)).length : 1, drafts: latest.drafts.filter(d => a ? ids.has(d.annotationId ?? '') || anchors.has(anchorKey(d.seed)) : d.thoughtId === t?.id).length });
      }
      throw e;
    }
    setDeleting(undefined); setSelected(undefined); setHover(undefined);
  }
  const hoverGroup = groups.find(g => g.members.some(a => a.id === hover?.id));
  const hoverAnnotation = hoverGroup?.annotation;
  return <>
    <div className="annotation-drawing" aria-hidden="true" hidden={!!notebook}><svg width="100%" height="100%">{groups.flatMap(({ annotation: a, members }) => {
      const rects = geometry.find(g => g.a.id === a.id)?.rects ?? [];
      const highlights = [...new Set(members.flatMap(a => a.highlightColor ? [a.highlightColor] : []))];
      const lines = [...new Map(members.flatMap(a => a.line ? [[`${a.line.style}|${a.line.color}`, a.line] as const] : [])).values()];
      return rects.map((r, i) => <g key={`${a.id}-${i}`}>
        {highlights.map(color => <rect key={color} x={r.x} y={r.y} width={r.width} height={r.height} fill={HIGHLIGHTS[color]} opacity=".3" />)}
        {lines.map(line => <g key={`${line.style}|${line.color}`} data-line-style={line.style}>{line.style === 'wavy' ? <path d={markerPath(r)} fill="none" stroke={line.color} strokeWidth="1.5" /> : <line x1={r.x} x2={r.x+r.width} y1={r.y+r.height-1} y2={r.y+r.height-1} stroke={line.color} strokeWidth="1.5" strokeDasharray={line.style === 'dashed' ? '4 3' : undefined} />}</g>)}
      </g>);
    })}</svg></div>
    {groups.map(({ annotation: a, members, thoughts }) => {
      const rect = geometry.find(g => g.a.id === a.id)?.rects[0];
      if (notebook || !rect || !(members.some(a => a.line || a.highlightColor) || thoughts.length)) return null;
      const point = { x: rect.x, y: rect.y + rect.height };
      return <button key={a.id} className="annotation-marker" data-note-guarded aria-label={`打开摘录，思考 ${thoughts.length} 条`} style={{ left: Math.min(innerWidth - 80, Math.max(8, rect.x + rect.width - 12)), top: Math.max(8, rect.y - 23) }} onPointerEnter={() => { clearTimeout(leaveTimer.current); clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHover({ id: a.id, point }), 250); }} onPointerLeave={leaveHover} onClick={() => guard(() => { setSelected(undefined); setHover({ id: a.id, point }); })}>{thoughts.length ? `思考 ${thoughts.length}` : '标记'}</button>;
    })}
    {selected && !editor && !adjust && !notebook && !exporting && !restoring && !deleting && <SelectionToolbar key={anchorKey(selected.seed)} point={selected.point} annotation={selectedAnnotation} busy={busy} onLine={style => void change({ line: selectedAnnotation?.line?.style === style ? null : { style, color: selectedAnnotation?.line?.color ?? '#52735c', origin: 'user' } })} onHighlight={color => void change({ highlightColor: selectedAnnotation?.highlightColor === color ? null : color })} onThought={() => beginAppend(selectedGroup?.annotation ?? selected.seed, selectedGroup?.annotation)} onAi={onAskAi ? () => { const seed = structuredClone(selected.seed); guard(() => onAskAi(seed)); } : undefined} onClose={() => setSelected(undefined)} />}
    {editor && <ThoughtPopoverEditor {...editor} seed={editor.draft.seed} mode={editor.draft.mode} status={draftStatus} busy={busy} error={error} diagnostic={diagnostic && <StorageDiagnosticDetails diagnostic={diagnostic} onNotice={onNotice} />} onText={text => { const current = editorRef.current; if (current) { editorRef.current = { ...current, text }; setEditor(editorRef.current); } }} onSave={() => void run(async () => { await saveEditor(); })} onClose={() => void closeAndKeepDraft()} onDiscard={() => void discardEditorDraft()} onKeepDraft={() => void keepDraftNow()} />}
    {hover && hoverAnnotation && !editor && !notebook && !adjust && !deleting && <HoverCard a={hoverAnnotation} members={hoverGroup!.members} thoughts={hoverGroup!.thoughts} point={hover.point} onEnter={() => { overCard.current = true; clearTimeout(leaveTimer.current); }} onLeave={() => { overCard.current = false; leaveHover(); }} onClose={() => setHover(undefined)} onAppend={() => append(hoverAnnotation)} onEdit={editThought} onDelete={t => askDelete(undefined,t)} onNotebook={() => guard(() => setNotebook({ key: crypto.randomUUID(), bookId: hoverAnnotation.bookId, focusedAnnotationId: hoverAnnotation.id, showOverview: true }))} />}
    {notebook && <NotebookPage key={notebook.key} showOverview={notebook.showOverview} focusedAnnotationId={notebook.focusedAnnotationId} initialCategory={notebook.category} snapshot={snapshot} bookId={notebook.bookId} bookTitle={books.find(b => b.id === notebook.bookId)?.title || (notebook.bookId === bookId ? bookSnapshot?.title : undefined)} returnToReader={!!session} availableBooks={books.map(b => b.id)} onClose={() => guard(() => setNotebook(undefined))} onAppend={append} onEdit={editThought} onDeleteThought={t => askDelete(undefined,t)} onDeleteAnnotation={a => askDelete(a)} onLocate={a => guard(() => { setNotebook(undefined); void onLocate(a).catch(e => setError(errorMessage(e))); })} onAdjust={openAdjust} onExport={beginExport} onImport={() => guard(() => setRestoring(true))} onRestoreDraft={restoreDraft} onDiscardDraft={id => { if (window.confirm('丢弃这份本机草稿？')) void run(() => annotations.discardDraft(id)); }} />}
    {adjust && <ExcerptAdjustEditor annotation={adjust.a} seed={adjust.seed} changes={adjust.changes} busy={busy} onChange={changes => { const next = { ...adjust, changes }; adjustRef.current = next; setAdjust(next); }} onSave={() => void run(saveAdjust)} onCancel={() => guard(() => {})} onThoughts={() => guard(() => { setNotebook({ key: crypto.randomUUID(), bookId: adjust.a.bookId, focusedAnnotationId: adjust.a.id }); })} />}
    {deleting && <NoteDialog title={deleting.a ? '删除整条摘录' : '删除单条思考'} onClose={() => { if (!busy) setDeleting(undefined); }}><p>将删除 {deleting.a ? '1 段摘录及' : ''} {deleting.thoughts} 条思考，清理 {deleting.drafts} 份关联草稿。原书和其他摘录不受影响。</p><p>删除成功后，可在 10 秒内点击页面右下角的“撤销”；刷新后不保留撤销记录。</p><div className="delete-actions"><button className="button-secondary" disabled={busy} onClick={() => setDeleting(undefined)}>取消</button><button className="button-danger" disabled={busy} onClick={() => void run(confirmDelete)}>确认删除</button></div></NoteDialog>}
    {exporting && <ExportDialog {...exporting} onClose={() => setExporting(undefined)} />}{restoring && <RestoreDialog onBusyChange={value => { restoreBusy.current = value; }} onClose={() => setRestoring(false)} />}
    {recoverChoice && <DraftRecoveryDialog drafts={recoverChoice.drafts} busy={busy} error={error} diagnostic={diagnostic && <StorageDiagnosticDetails diagnostic={diagnostic} onNotice={onNotice} />} onClose={() => { if (!lock.current) setRecoverChoice(undefined); }} onRestore={restoreDraft} onNew={() => openEditor(recoverChoice.seed, undefined, recoverChoice.a)} onDiscard={id => run(async () => {
      await annotations.discardDraft(id);
      setRecoverChoice(current => {
        if (!current) return current;
        const drafts = current.drafts.filter(draft => draft.id !== id);
        return drafts.length ? { ...current, drafts } : undefined;
      });
    })} />}
    {pending && <NoteDialog title="有未保存修改" onClose={() => setPending(undefined)}><p>保存成功或保留草稿后再继续；放弃会丢弃本次修改。</p><div className="pending-actions"><button className="button-primary" disabled={busy} onClick={() => resolvePending('save')}>保存并继续</button>{editor && <button className="button-secondary" disabled={busy} onClick={() => resolvePending('keep')}>保留草稿并继续</button>}<button className="button-danger" disabled={busy} onClick={() => resolvePending('discard')}>放弃修改</button><button className="button-secondary" disabled={busy} onClick={() => setPending(undefined)}>继续编辑</button></div></NoteDialog>}
    {undo && <div className="note-undo" role="status"><span>已删除 · 10 秒内可撤销，刷新后失效</span><button disabled={busy} onClick={() => void run(async () => { await annotations.undoGroup(undo); setUndo(undefined); })}>撤销</button></div>}
    {snapshot.drafts.length > 0 && !editor && !notebook && !pending && <button className="draft-recovery" data-note-guarded onClick={() => guard(() => setNotebook({ key: crypto.randomUUID() }))}>有 {snapshot.drafts.length} 份本机草稿 · 恢复 / 丢弃</button>}
    {error && !editor && !recoverChoice && <div className="note-error" role="alert">{error}<button onClick={() => { setError(''); setDiagnostic(undefined); }} aria-label="关闭笔记错误">×</button>{diagnostic && <StorageDiagnosticDetails diagnostic={diagnostic} onNotice={onNotice} />}</div>}
  </>;
}
