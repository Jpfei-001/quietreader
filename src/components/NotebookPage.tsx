import { useEffect, useMemo, useRef, useState } from 'react';
import { sourceLabel, type AnnotationRecord, type NotesSnapshot, type ThoughtEntry, type NoteCategory } from '../platform/annotationTypes';
import { activeAnnotationGroups } from '../platform/annotationGroups';
import { compareAnnotations } from '../platform/noteTransfer';
import AnnotationTags from './AnnotationTags';
import SearchHighlight from './SearchHighlight';
import { searchTerms, searchRanges, matchesNote, type SearchTerm } from '../platform/noteSearch';

export function ThoughtList({ entries, onEdit, onDelete, terms = [] }: { entries: ThoughtEntry[]; terms?: readonly SearchTerm[]; onEdit(t: ThoughtEntry): void; onDelete(t: ThoughtEntry): void }) {
  const [visibleCount, setVisibleCount] = useState(50);
  let lastMatch = -1;
  if (terms.length) entries.forEach((t, index) => { if (searchRanges(t.text, terms).length) lastMatch = index; });
  const limit = Math.max(visibleCount, lastMatch + 1);
  return <>{entries.slice(0, limit).map(t => <section className="thought-entry" key={t.id}>
    <div className="thought-entry-heading"><h4>第 {t.ordinal} 次思考</h4><small>{t.createdAt === null ? '时间未知' : new Date(t.createdAt).toLocaleString('zh-CN', { hour12: false })}</small><div className="thought-entry-actions"><button onClick={() => onEdit(t)}>编辑</button><button className="note-danger" onClick={() => onDelete(t)}>删除</button></div></div>
    <p><SearchHighlight text={t.text} terms={terms} /></p>
  </section>)}{entries.length > limit && <button onClick={() => setVisibleCount(limit + 50)}>显示更多思考（{limit} / {entries.length}）</button>}</>;
}
export default function NotebookPage({ focusedAnnotationId, showOverview = false, initialCategory = 'all', returnToReader, snapshot, bookId, bookTitle, availableBooks, onClose, onAppend, onEdit, onDeleteThought, onDeleteAnnotation, onLocate, onAdjust, onExport, onImport, onRestoreDraft, onDiscardDraft }: {
  focusedAnnotationId?: string; showOverview?: boolean; initialCategory?: NoteCategory; returnToReader: boolean; snapshot: NotesSnapshot; bookId?: string; bookTitle?: string; availableBooks: string[]; onClose(): void; onAppend(a: AnnotationRecord): void; onEdit(t: ThoughtEntry): void; onDeleteThought(t: ThoughtEntry): void;
  onDeleteAnnotation(a: AnnotationRecord): void; onLocate(a: AnnotationRecord): void; onAdjust(a: AnnotationRecord): void; onExport(ids: string[], scope: string): void; onImport(): void;
  onRestoreDraft(id: string): void; onDiscardDraft(id: string): void;
}) {
  const focused = snapshot.annotations.find(a => a.id === focusedAnnotationId);
  const [scope, setScope] = useState(bookId && (!focused || focused.bookId === bookId) ? 'book' : 'all');
  const [query, setQuery] = useState(''); const [category, setCategory] = useState<string>(initialCategory); const [chapter, setChapter] = useState(''); const [sort, setSort] = useState('created');
  const [selected, setSelected] = useState<string[]>([]); const [visibleCount, setVisibleCount] = useState(50);
  const listRef = useRef<HTMLDivElement>(null); const didFocus = useRef(false);
  const pageRef = useRef<HTMLElement>(null);
  useEffect(() => { pageRef.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, []);
  useEffect(() => { setVisibleCount(50); }, [scope, query, category, chapter, sort]);
  const groups = useMemo(() => activeAnnotationGroups(snapshot), [snapshot]);
  const terms = useMemo(() => searchTerms(query), [query]);
  const searchMatches = useMemo(() => new Set(groups.filter(g => matchesNote([...g.members.flatMap(a => [a.quote.exact, a.title, a.bookSnapshot.title, a.bookSnapshot.author, sourceLabel(a)]), ...g.thoughts.map(t => t.text)], terms)).map(g => g.annotation.id)), [groups, terms]);
  const scopedBookId = scope === 'book' ? bookId : scope.startsWith('book:') ? scope.slice(5) : undefined;
  const bookOptions = [...new Map(snapshot.annotations.map(a => [a.bookId, a.bookSnapshot.title])).entries()];
  const base = groups.filter(g => scope === 'all' || g.annotation.bookId === scopedBookId);
  const chapterKey = (a: AnnotationRecord) => `${a.bookId}|${a.locator.href}|${a.source.tocPath.join(' → ')}`;
  const chapters = Array.from(new Map(base.map(({ annotation: a }) => [chapterKey(a), `${scope === 'all' ? a.bookSnapshot.title + ' · ' : ''}${sourceLabel(a)}`])).entries());
  const matching = base.filter(g => (!chapter || chapterKey(g.annotation) === chapter) && searchMatches.has(g.annotation.id));
  const filtered = matching.filter(g => category === 'all' || category === 'line' && g.members.some(a => a.line) || category === 'highlight' && g.members.some(a => a.highlightColor) || category === 'thought' && g.thoughts.length).sort((a, b) => sort === 'position' ? compareAnnotations(a.annotation, b.annotation) : sort === 'created' ? Math.max(...b.members.map(a => a.createdAt)) - Math.max(...a.members.map(a => a.createdAt)) : Math.max(...b.members.map(a => a.updatedAt)) - Math.max(...a.members.map(a => a.updatedAt)));
  const selectedGroups = groups.filter(g => g.members.some(a => selected.includes(a.id)));
  const counts = [
    ['all', '摘录', matching.length],
    ['line', '标注', matching.filter(g => g.members.some(a => a.line)).length],
    ['highlight', '高亮', matching.filter(g => g.members.some(a => a.highlightColor)).length],
    ['thought', '思考', matching.reduce((sum, g) => sum + g.thoughts.length, 0)],
  ] as const;
  useEffect(() => {
    if (!focusedAnnotationId || didFocus.current) return;
    const index = filtered.findIndex(g => g.members.some(a => a.id === focusedAnnotationId));
    if (index < 0) return;
    if (index >= visibleCount) { setVisibleCount(index + 1); return; }
    const frame = requestAnimationFrame(() => {
      const card = Array.from(listRef.current?.querySelectorAll<HTMLElement>('.annotation-card') ?? []).find(a => a.dataset.annotationId === filtered[index].annotation.id);
      if (!card) return;
      const details = card.querySelector('details'); if (details) details.open = true;
      // The reader's "view in notes" entry opens the list overview, not the middle
      // of a potentially very long quote. Still expand all thoughts for that excerpt.
      if (!showOverview) { card.focus({ preventScroll: true }); card.scrollIntoView({ block: 'nearest' }); }
      didFocus.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedAnnotationId, showOverview, visibleCount, scope, snapshot, filtered]);
  return <main ref={pageRef} tabIndex={-1} className="notebook-page" aria-label="我的笔记">
    <header className="library-heading notebook-page-heading"><div><div className="eyebrow">你的文字，留在本机</div><h1>我的笔记</h1><p>集中查看标记、高亮和思考</p></div><button className="text-button" onClick={onClose}>{returnToReader ? '返回阅读' : '返回书架'}</button></header>
    <div className="notebook-filters">
      <select aria-label="笔记范围" value={scope} onChange={e => { setScope(e.target.value); setChapter(''); }}><option value="all">全部书籍</option>{bookId && <option value="book">{bookTitle || snapshot.annotations.find(a => a.bookId === bookId)?.bookSnapshot.title || snapshot.drafts.find(d => d.seed.bookId === bookId)?.seed.bookSnapshot.title || '当前书籍'}</option>}{bookOptions.filter(([id]) => id !== bookId).map(([id, title]) => <option key={id} value={`book:${id}`}>{title}</option>)}</select>
      <input aria-label="搜索笔记" placeholder="搜索原文 / 思考 / 章节" title="支持部分词、多关键词、大小写及全角兼容；4 字及以上允许一个错字或漏字" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="笔记分类" value={category} onChange={e => setCategory(e.target.value)}>{[['all','全部类型'],['line','标注'],['highlight','高亮'],['thought','有思考']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
      <select aria-label="章节筛选" value={chapter} onChange={e => setChapter(e.target.value)}><option value="">全部章节</option>{chapters.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select>
      <select aria-label="笔记排序" value={sort} onChange={e => setSort(e.target.value)}><option value="position">原书顺序</option><option value="created">最近创建（倒序）</option><option value="updated">最近修改</option></select>
      <button className="filter-reset" onClick={() => { setQuery(''); setCategory('all'); setChapter(''); setSort('created'); }}>重置筛选</button>
    </div>
    <div className="notebook-toolbar"><div className="note-counts" aria-label="笔记统计与筛选">{counts.map(([key, label, count]) => <button key={key} className={`note-tag tag-${key}`} aria-pressed={category === key} onClick={() => setCategory(category === key && key !== 'all' ? 'all' : key)}>{label} {count}{key === 'thought' ? ' 条' : ''}</button>)}</div>
    <div className="note-actions notebook-transfer"><button onClick={() => onExport(base.flatMap(g => g.members.map(a => a.id)), scope !== 'all' ? '本书全部' : '全部书籍')}>导出{scope !== 'all' ? '本书' : '全部'}</button><button onClick={() => onExport(filtered.flatMap(g => g.members.map(a => a.id)), '当前筛选结果')}>导出筛选</button><button disabled={!selectedGroups.length} onClick={() => onExport(selectedGroups.flatMap(g => g.members.map(a => a.id)), '选中多段')}>导出选中 {selectedGroups.length} 段</button><button onClick={onImport}>导入 JSON 备份</button></div></div>
    {!!terms.length && <p className="search-summary" role="status">匹配 {filtered.length} 段摘录 · 命中文字已高亮；多个关键词需全部匹配。<button onClick={() => setQuery('')}>清除搜索</button></p>}
    {snapshot.drafts.filter(d => scope === 'all' || d.seed.bookId === scopedBookId).length > 0 && <details className="draft-list"><summary>本机草稿（不计入正式思考）</summary>{snapshot.drafts.filter(d => scope === 'all' || d.seed.bookId === scopedBookId).map(d => <section key={d.id}>{d.seed.bookSnapshot.title} · {d.mode === 'edit' ? '编辑草稿' : '追加草稿'} · {d.text.slice(0,80)} <button onClick={() => onRestoreDraft(d.id)}>恢复草稿</button><button onClick={() => onDiscardDraft(d.id)}>丢弃草稿</button><details><summary>完整草稿（可复制；冲突时不覆盖正式思考）</summary><pre className="export-preview">{d.text}</pre></details></section>)}</details>}
    <div ref={listRef} className="notebook-list">{filtered.slice(0, visibleCount).map(({ annotation: a, members, thoughts }) => <article className="annotation-card" tabIndex={-1} key={a.id} data-annotation-id={a.id}>
      <div className="annotation-card-top"><label><input type="checkbox" aria-label={`选择摘录 ${a.title || a.quote.exact.slice(0,20)}`} checked={members.some(a => selected.includes(a.id))} onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...members.map(a => a.id)])] : selected.filter(id => !members.some(a => a.id === id)))} /><span><SearchHighlight text={`${a.bookSnapshot.title} · ${a.bookSnapshot.author}`} terms={terms} /></span></label>{!availableBooks.includes(a.bookId) && <small className="archive-label">原书未载入 · 归档笔记</small>}<AnnotationTags members={members} thoughtCount={thoughts.length} /></div>
      <blockquote className="annotation-quote"><SearchHighlight text={a.quote.exact} terms={terms} /></blockquote>
      <p className="annotation-source">摘录自：<SearchHighlight text={sourceLabel(a)} terms={terms} /></p>
      {[...new Set(members.map(a => a.title).filter(Boolean))].map(title => <h3 key={title} className="annotation-title"><SearchHighlight text={title} terms={terms} /></h3>)}
      {!!thoughts.length && <details open={terms.length > 0 && thoughts.some(t => searchRanges(t.text, terms).length > 0) || undefined}><summary>展开思考（{thoughts.length}）</summary><ThoughtList entries={thoughts} terms={terms} onEdit={onEdit} onDelete={onDeleteThought} /></details>}
      <div className="note-actions card-actions"><button disabled={!availableBooks.includes(a.bookId)} onClick={() => onLocate(a)}>回到原文</button><button onClick={() => onAppend(a)}>追加思考</button><button disabled={!availableBooks.includes(a.bookId)} title={!availableBooks.includes(a.bookId) ? '请先重新载入原书，再调整摘录范围' : undefined} onClick={() => onAdjust(a)}>调整摘录</button><button onClick={() => onExport(members.map(a => a.id), '当前 1 段摘录')}>导出此段</button><button className="note-danger" onClick={() => onDeleteAnnotation(a)}>删除整条摘录</button></div>
    </article>)}</div>
    {filtered.length > visibleCount && <button onClick={() => setVisibleCount(visibleCount + 50)}>显示更多摘录（已显示 {visibleCount} / {filtered.length}，计数和导出包含全部结果）</button>}
    {!filtered.length && <p className="notebook-empty">暂无符合条件的摘录。选文后保存标注、高亮或思考。</p>}
  </main>;
}
