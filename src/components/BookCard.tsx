import { useEffect, useState } from 'react';
import { library, type LibraryBook } from '../platform/library';
import type { NoteCategory } from '../platform/annotationTypes';

export default function BookCard({ book, disabled, onOpen, onDelete, notes, onNotes }: {
  book: LibraryBook;
  disabled: boolean;
  onOpen(book: LibraryBook): void;
  onDelete(book: LibraryBook): void;
  notes: { lines: number; highlights: number; thoughts: number };
  onNotes(category: NoteCategory): void;
}) {
  const [coverUrl, setCoverUrl] = useState<string>();
  const [chapter, setChapter] = useState('');
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    void library.getCover(book.id).then((cover) => {
      if (!active || !cover) return;
      url = URL.createObjectURL(cover);
      setCoverUrl(url);
    }).catch(() => {});
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [book.id]);
  useEffect(() => {
    let active = true;
    void library.getProgress(book.id).then((progress) => {
      if (active) setChapter(progress?.chapterIndex && progress.chapterCount ? `读到第 ${progress.chapterIndex} / ${progress.chapterCount} 章` : '');
    }).catch(() => {});
    return () => { active = false; };
  }, [book.id, book.lastReadAt]);
  return (
    <article className="book-card" data-book-id={book.id}>
      <button className="book-open" disabled={disabled} onClick={() => onOpen(book)} aria-label={`阅读 ${book.title}`}>
        <div className={`book-cover ${coverUrl ? 'has-cover' : ''}`}>
          {coverUrl ? <img src={coverUrl} alt={`${book.title}的封面`} onError={() => setCoverUrl(undefined)} /> : <><span className="cover-title">{book.title}</span><span className="cover-author">{book.author}</span></>}
        </div>
        <h2 title={book.title}>{book.title}</h2>
        <div className="card-meta">
          <p className="card-author" title={book.author}>{book.author}</p>
          <p className="card-progress">{chapter || (book.lastReadAt ? '已保存阅读位置' : '尚未阅读')}</p>
        </div>
      </button>
      <div className="card-note-tags" aria-label={`${book.title}的笔记分类`}>
        {([['line', '标记', notes.lines], ['highlight', '高亮', notes.highlights], ['thought', '思考', notes.thoughts]] as const).map(([category, label, count]) => <button key={category} className={`card-notes note-tag tag-${category}`} disabled={disabled} onClick={() => onNotes(category)} aria-label={`${book.title}的${label}笔记 ${count}`}>{label} {count}</button>)}
      </div>
      <div className="card-bottom"><span>{(book.size / 1024).toFixed(0)} KB</span><button disabled={disabled} onClick={() => onDelete(book)} aria-label={`删除 ${book.title}`}>删除</button></div>
    </article>
  );
}
