import { EpubCFI } from 'epubjs';
import type { AnnotationRecord, AnnotationSeed, NotesSnapshot, ThoughtEntry } from './annotationTypes';

const compactQuote = (text: string) => text.replace(/\s+/g, '');
/** Only coalesce equivalent selections at the same location, never repeated text elsewhere. */
export function sameExcerpt(a: AnnotationSeed, b: AnnotationSeed): boolean {
  if (a.bookId !== b.bookId || a.locator.href !== b.locator.href || a.locator.spineIndex !== b.locator.spineIndex) return false;
  if (a.locator.rangeCfi.trim() === b.locator.rangeCfi.trim()) return true;
  const left = compactQuote(a.quote.exact), right = compactQuote(b.quote.exact);
  if (!left || !right || Math.min(left.length, right.length) / Math.max(left.length, right.length) < .9 || !(left.includes(right) || right.includes(left))) return false;
  try {
    const startA = new EpubCFI(a.locator.rangeCfi), endA = new EpubCFI(a.locator.rangeCfi);
    const startB = new EpubCFI(b.locator.rangeCfi), endB = new EpubCFI(b.locator.rangeCfi);
    if (!startA.range || !startB.range) return false;
    startA.collapse(true); endA.collapse(false); startB.collapse(true); endB.collapse(false);
    const cfi = new EpubCFI();
    return cfi.compare(startA, endB) < 0 && cfi.compare(startB, endA) < 0;
  } catch { return false; }
}
export interface AnnotationGroup {
  annotation: AnnotationRecord;
  members: AnnotationRecord[];
  thoughts: ThoughtEntry[];
}
export function groupAnnotations(snapshot: Pick<NotesSnapshot, 'annotations' | 'thoughts'>): AnnotationGroup[] {
  const groups: AnnotationGroup[] = [];
  const cfi = new EpubCFI();
  const prepared = snapshot.annotations.map(a => {
    const location = `${a.bookId}|${a.locator.href}|${a.locator.spineIndex}`;
    try {
      const start = new EpubCFI(a.locator.rangeCfi), end = new EpubCFI(a.locator.rangeCfi);
      if (!start.range) throw new Error();
      start.collapse(true); end.collapse(false);
      return { a, location, start, end };
    } catch { return { a, location, start: undefined, end: undefined }; }
  }).sort((a, b) => a.location.localeCompare(b.location) || (a.start && b.start ? cfi.compare(a.start, b.start) : Number(!!b.start) - Number(!!a.start)) || b.a.quote.exact.length - a.a.quote.exact.length || a.a.id.localeCompare(b.a.id));
  let active: { group: AnnotationGroup; end: EpubCFI }[] = [], location = '';
  const byAnchor = new Map<string, AnnotationGroup>();
  // Sweep only overlapping ranges. Repeated text in large books does not cause quadratic CFI parsing.
  for (const { a, location: key, start, end } of prepared) {
    if (location !== key) { active = []; location = key; }
    if (start) active = active.filter(item => cfi.compare(item.end, start) > 0);
    let group = byAnchor.get(`${key}|${a.locator.rangeCfi.trim()}`) ?? active.find(item => sameExcerpt(item.group.annotation, a))?.group;
    if (group) {
      group.members.push(a);
      if (a.quote.exact.length > group.annotation.quote.exact.length) group.annotation = a;
      const current = active.find(item => item.group === group);
      if (current && end && cfi.compare(end, current.end) > 0) current.end = end;
    } else {
      group = { annotation: a, members: [a], thoughts: [] }; groups.push(group);
      if (start && end) active.push({ group, end });
    }
    byAnchor.set(`${key}|${a.locator.rangeCfi.trim()}`, group);
  }
  const byId = new Map(groups.flatMap(g => g.members.map(a => [a.id, g] as const)));
  for (const t of snapshot.thoughts) byId.get(t.annotationId)?.thoughts.push(t);
  for (const g of groups) g.thoughts.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.ordinal - b.ordinal || a.id.localeCompare(b.id));
  return groups;
}

/** Records with all marks removed stay in storage for draft/revision safety, but are not notebook entries. */
export function activeAnnotationGroups(snapshot: Pick<NotesSnapshot, 'annotations' | 'thoughts'>): AnnotationGroup[] {
  return groupAnnotations(snapshot).filter(g => g.thoughts.length > 0 || g.members.some(a => a.line || a.highlightColor));
}
export function activeNoteCounts(snapshot: Pick<NotesSnapshot, 'annotations' | 'thoughts'>) {
  const groups = activeAnnotationGroups(snapshot);
  return { excerpts: groups.length, lines: groups.filter(g => g.members.some(a => a.line)).length,
    highlights: groups.filter(g => g.members.some(a => a.highlightColor)).length,
    thoughts: groups.reduce((count, g) => count + g.thoughts.length, 0) };
}
