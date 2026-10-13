export type NoteCategory = 'all' | 'line' | 'highlight' | 'thought';
export interface NotebookRequest { key: string; bookId?: string; category?: NoteCategory; focusedAnnotationId?: string; showOverview?: boolean }
export type LineStyle = 'solid' | 'dashed' | 'wavy';
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';
export const HIGHLIGHTS: Record<HighlightColor, string> = { yellow: '#d9bd6a', green: '#90b89a', blue: '#9ab7d2', pink: '#dba5ad' };
export const LINE_NAMES: Record<LineStyle, string> = { solid: '实线', dashed: '虚线', wavy: '波浪线' };
export interface AnnotationSeed {
  bookId: string;
  bookSnapshot: { title: string; author: string; fileName: string };
  locator: { rangeCfi: string; href: string; spineIndex: number };
  quote: { exact: string; prefix: string; suffix: string };
  source: { tocPath: string[]; headingPath: string[]; paragraphIndex?: number };
}
export interface AnnotationRecord extends AnnotationSeed {
  version: 1; id: string; anchorKey: string; title: string;
  line: { style: LineStyle; color: string; origin: 'user' | 'thought' } | null;
  highlightColor: HighlightColor | null; isBookmarked: boolean;
  automaticLineSuppressed: boolean;
  nextThoughtOrdinal: number; createdAt: number; updatedAt: number; revision: number;
}
export interface ThoughtEntry {
  version: 1; id: string; annotationId: string; bookId: string; ordinal: number;
  text: string; createdAt: number | null; updatedAt: number | null; revision: number;
}
export interface AnnotationDraft {
  version: 1; id: string; sessionId: string; seed: AnnotationSeed;
  revision?: number; // Legacy drafts start at revision 0; each write is compare-and-swap.
  annotationId?: string; thoughtId: string; baseRevision?: number; recoveryDraftId?: string; recoveryDraftRevision?: number;
  mode: 'append' | 'edit'; text: string; updatedAt: number;
}
export interface NotesSnapshot { annotations: AnnotationRecord[]; thoughts: ThoughtEntry[]; drafts: AnnotationDraft[] }
export function anchorKey(seed: AnnotationSeed) { return `${seed.bookId}|${seed.locator.rangeCfi.trim()}`; }
export function sourceLabel(seed: AnnotationSeed) {
  return [...seed.source.tocPath, ...seed.source.headingPath].filter((s, i, all) => s && all.indexOf(s) === i).join(' → ') || `未命名章节 / 内容项 ${seed.locator.spineIndex + 1}`;
}
export function noteCounts(snapshot: Pick<NotesSnapshot, 'annotations' | 'thoughts'>) {
  return { excerpts: snapshot.annotations.length, lines: snapshot.annotations.filter(a => a.line).length,
    highlights: snapshot.annotations.filter(a => a.highlightColor).length, bookmarks: snapshot.annotations.filter(a => a.isBookmarked).length,
    thoughts: snapshot.thoughts.length, thoughtExcerpts: new Set(snapshot.thoughts.map(t => t.annotationId)).size };
}
