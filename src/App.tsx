import { useEffect, useRef, useState } from 'react';
import brandMark from './assets/brand-pine-seal.png';
import { readEpub } from './platform/files';
import { BrowserProgressStore, identifyBook } from './platform/storage';
import { createReader, type ReaderSession, type ReadingLocation } from './reader/engine';
import type { ReaderTheme } from './reader/themes';
import { liveQuery } from 'dexie';
import { library, type LibraryBook } from './platform/library';
import { inspectEpub } from './reader/metadata';
import BookCard from './components/BookCard';
import ImportCard from './components/ImportCard';
import DesktopTitleBar from './components/DesktopTitleBar';
import ContentsPanel from './components/ContentsPanel';
import { getDesktopWindow } from './platform/desktop';
import { DEFAULT_PREFERENCES, type ContentsSide } from './platform/preferences';
import NotesExperience, { type NotesHandle } from './components/NotesExperience';
import AiSettings from './components/AiSettings';
import AiFeature, { type AiFeatureHandle } from './components/AiFeature';
import { annotations } from './platform/annotations';
import { type NotesSnapshot, type AnnotationRecord, type NotebookRequest } from './platform/annotationTypes';

import { activeNoteCounts } from './platform/annotationGroups';

interface Selection { id: string; file: File; notice?: string }

const progressStore = new BrowserProgressStore({
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
});
const themeNames: Record<ReaderTheme, string> = { light: '明亮', sepia: '护眼', dark: '深色' };

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') return '本地存储空间不足，请先删除部分书籍或释放空间后重试。';
    if (/[\u3400-\u9fff]/.test(error.message)) return error.message;
  }
  return '操作失败，请检查 EPUB 文件和浏览器的本地存储权限。';
}

export default function App() {
  const [desktop] = useState(getDesktopWindow);
  const [selection, setSelection] = useState<Selection | null>(null);
  const file = selection?.file ?? null;
  const [shelf, setShelf] = useState<LibraryBook[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LibraryBook | null>(null);
  const [clearBookNotes, setClearBookNotes] = useState(false);
  const [notesSnapshot, setNotesSnapshot] = useState<NotesSnapshot>({ annotations: [], thoughts: [], drafts: [] });
  const [notebook, setNotebook] = useState<NotebookRequest>();
  const notesRef = useRef<NotesHandle>(null);
  const aiRef = useRef<AiFeatureHandle>(null);
  const pendingLocator = useRef<{ annotation: AnnotationRecord; resolve(): void; reject(reason: unknown): void } | null>(null);
  const protect = (action: () => void) => notesRef.current ? notesRef.current.guard(action) : action();
  const [book, setBook] = useState<ReaderSession | null>(null);
  const [location, setLocation] = useState<ReadingLocation | null>(null);
  const [columns, setColumns] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'contents' | 'settings' | null>(null);
  const [chrome, setChrome] = useState(true);
  const [theme, setTheme] = useState<ReaderTheme>(DEFAULT_PREFERENCES.theme);
  const [fontSize, setFontSize] = useState(DEFAULT_PREFERENCES.fontSize);
  const [contentsSide, setContentsSide] = useState<ContentsSide>(DEFAULT_PREFERENCES.contentsSide);
  const [contentsPinned, setContentsPinned] = useState(DEFAULT_PREFERENCES.contentsPinned);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<ReaderSession | null>(null);
  const navigationLock = useRef(false);
  const importLock = useRef(false);
  const preferencesLoading = useRef<Promise<void>>(Promise.resolve());
  const preferencesInitialized = useRef(false);
  const styleRef = useRef({ theme, fontSize, focused: !chrome });
  const panelRef = useRef(panel);
  styleRef.current = { theme, fontSize, focused: !chrome };
  panelRef.current = panel;

  function turn(direction: 'next' | 'prev', fromKeyboard = false) {
    const session = sessionRef.current;
    if (!session || navigationLock.current || panelRef.current) return;
    protect(() => {
      // 方向键用于阅读翻页时，将焦点移回正文，避免鼠标点过的按钮出现键盘焦点框。
      if (fromKeyboard) viewportRef.current?.focus({ preventScroll: true });
      navigationLock.current = true;
      session[direction]().catch((reason: unknown) => setError(messageOf(reason))).finally(() => { navigationLock.current = false; });
    });
  }

  function onKey(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (notesRef.current?.escape()) return;
      setPanel(null);
      setDeleteTarget(null);
      setChrome(true);
      return;
    }
    if (target?.isContentEditable || target?.closest?.('[data-ai-ui]') || target?.closest?.('.contents-panel') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName ?? '')) return;
    if (notesRef.current?.blocking()) return;
    if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      turn(event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 'next' : 'prev', true);
    }
  }

  useEffect(() => {
    const header = headerRef.current;
    const app = header?.closest<HTMLElement>('.app');
    if (!header || !app) return;
    // 同步响应式顶栏的实际高度；笔记页保留隐藏正文的高度预算，避免后台重新分页。
    const updateHeight = () => {
      if (!app.classList.contains('is-notes-page')) {
        app.style.setProperty('--reader-header-height', `${header.getBoundingClientRect().height}px`);
      }
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(header);
    return () => {
      observer.disconnect();
      app.style.removeProperty('--reader-header-height');
    };
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let active = true;
    preferencesLoading.current = library.loadPreferences().then((preferences) => {
      if (!active) return;
      styleRef.current = { theme: preferences.theme, fontSize: preferences.fontSize, focused: false };
      setTheme(preferences.theme);
      setFontSize(preferences.fontSize);
      setContentsSide(preferences.contentsSide);
      setContentsPinned(preferences.contentsPinned);
      setPreferencesReady(true);
    }).catch(() => {
      if (!active) return;
      setPreferencesReady(true);
      setNotice('无法读取已保存的设置，暂用默认设置。');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    // 读取后的第一轮不回写，避免默认值覆盖原设置。
    if (!preferencesInitialized.current) {
      preferencesInitialized.current = true;
      return;
    }
    void library.savePreferences({ version: 1, theme, fontSize, contentsSide, contentsPinned }).catch(() => {
      setNotice('设置保存失败，请检查本地存储空间；本次设置仍然生效。');
    });
  }, [theme, fontSize, contentsSide, contentsPinned, preferencesReady]);

  useEffect(() => {
    const sub = liveQuery(() => annotations.snapshot()).subscribe({ next: setNotesSnapshot, error: reason => setError(messageOf(reason)) });
    return () => sub.unsubscribe();
  }, []);

  useEffect(() => {
    if (!book || !pendingLocator.current) return;
    const pending = pendingLocator.current; pendingLocator.current = null;
    void book.locateAnnotation(pending.annotation).then(pending.resolve, pending.reject);
  }, [book]);

  useEffect(() => {
    const subscription = liveQuery(() => library.list()).subscribe({
      next: (books) => { setShelf(books); setLibraryReady(true); },
      error: (reason: unknown) => {
        setLibraryReady(true);
        setError(`无法载入本地书架。${messageOf(reason)}`);
      },
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!selection || !viewportRef.current) return;
    const abort = new AbortController();
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    // 每次打开拥有独立渲染节点，取消的异步任务不会破坏下一本书。
    viewportRef.current.replaceChildren(container);
    setBusy(true);
    setError('');
    setNotice(selection.notice ?? '');
    setBook(null);
    setLocation(null);
    setPanel(null);
    setChrome(true);
    navigationLock.current = false;
    let session: ReaderSession | undefined;
    async function open() {
      try {
        await preferencesLoading.current;
        const data = await readEpub(selection!.file);
        const id = selection!.id;
        if (abort.signal.aborted) return;
        const savedCfi = (await library.getProgress(id))?.cfi;
        if (abort.signal.aborted) return;
        session = await createReader({
          data, container, signal: abort.signal, savedCfi,
          ...styleRef.current,
          onKey,
          onError: reason => setError(messageOf(reason)),
          beforeNavigate: protect,
          onLayout: (count) => { if (!abort.signal.aborted) setColumns(count); },
          onLocation: (next) => {
            if (abort.signal.aborted) return;
            setLocation(next);
            void library.saveProgress(id, {
              cfi: next.cfi, chapterIndex: next.chapterIndex, chapterCount: next.chapterCount,
              page: next.page, total: next.total,
            }).catch(() => {
              if (!abort.signal.aborted) setNotice('无法保存阅读位置，请检查本地存储空间；本次阅读不受影响。');
            });
          },
        });
        if (abort.signal.aborted) {
          session.destroy();
          return;
        }
        sessionRef.current = session;
        setBook(session);
        if (session.restored) setNotice([selection!.notice, '已恢复上次阅读位置。'].filter(Boolean).join(' '));
      } catch (reason) {
        if (!abort.signal.aborted) {
          setError(messageOf(reason)); pendingLocator.current?.reject(reason); pendingLocator.current = null;
        }
      } finally {
        if (!abort.signal.aborted) setBusy(false);
      }
    }
    void open();
    return () => {
      abort.abort();
      session?.destroy();
      container.remove();
      sessionRef.current = null;
    };
  }, [selection]);

  useEffect(() => {
    sessionRef.current?.style(theme, fontSize, !chrome);
  }, [theme, fontSize, chrome, contentsSide, contentsPinned]);

  async function importFile(selected: File) {
    if (importLock.current) return;
    importLock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await preferencesLoading.current;
      const data = await readEpub(selected);
      const id = await identifyBook(data);
      const existing = await library.find(id);
      const metadata = existing
        ? { title: existing.title, author: existing.author }
        : await inspectEpub(data, selected.name);
      const { duplicate } = await library.add({
        id, data, fileName: selected.name, ...metadata,
        legacyProgress: progressStore.get(id),
      });
      // 仅在事务成功后清理旧版位置，迁移失败时不丢失旧记录。
      try { window.localStorage.removeItem(`quiet-reader:progress:${id}`); } catch { /* 已保存在 IndexedDB。 */ }
      protect(() => { setNotebook(undefined); setSelection({ id, file: selected, notice: duplicate ? '这本书已在书架中，已打开已有书籍。' : undefined }); });
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      importLock.current = false;
      setBusy(false);
    }
  }

  function dropBooks(files: File[]) {
    if (!files.length) return;
    if (files.length > 1) {
      setError('每次请拖入一本 EPUB，添加完成后可以继续添加。');
      return;
    }
    void importFile(files[0]);
  }

  async function openGuide() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}books/user-guide.epub`);
      if (!response.ok) throw new Error('无法打开内置使用指南，请重新打开静读或检查应用文件是否完整。');
      const data = await response.arrayBuffer();
      await importFile(new File([data], '静读操作指南.epub', { type: 'application/epub+zip' }));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  async function openDemo() {
    setError('');
    setBusy(true);
    try {
      const response = await fetch('/demo/minimal.epub');
      if (!response.ok) throw new Error('样书不存在，请先运行 npm run demo。');
      const data = await response.arrayBuffer();
      await importFile(new File([data], '静读样书.epub', { type: 'application/epub+zip' }));
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  async function openStored(item: LibraryBook) {
    setBusy(true);
    setError('');
    try {
      const stored = await library.read(item.id);
      protect(() => { setNotebook(undefined); setSelection({ id: item.id, file: new File([stored.data], stored.book.fileName, { type: 'application/epub+zip' }) }); });
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  async function deleteBook() {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await library.remove(deleteTarget.id, clearBookNotes);
      try { window.localStorage.removeItem(`quiet-reader:progress:${deleteTarget.id}`); } catch { /* 不影响本地书架删除。 */ }
      setDeleteTarget(null);
      setNotice('已删除书籍及关联的封面、文件和阅读记录。');
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  function closeBook() {
    protect(() => {
      setNotebook(undefined); setSelection(null); setBook(null); setLocation(null); setPanel(null); setError(''); setNotice('');
    });
  }

  function jump(href: string) {
    protect(() => { setPanel(null); void sessionRef.current?.display(href).catch((reason: unknown) => setError(messageOf(reason))); });
  }

  const activeChapter = book?.chapters.find((chapter) => chapter.href === location?.tocHref)
    ?? book?.chapters.find((chapter) => chapter.href.split('#')[0] === location?.href);
  const showChrome = chrome || !book;
  // 打开/切换书籍时也保留侧栏宽度，避免会话就绪后突然缩窄、打断初始分页定位。
  const docked = !!file && contentsPinned;
  const contents = book && <ContentsPanel chapters={book.chapters} activeChapter={activeChapter} side={contentsSide} pinned={contentsPinned}
    onJump={jump}
    onPin={() => protect(() => { setContentsPinned(!contentsPinned); setPanel(contentsPinned ? 'contents' : null); })}
    onClose={() => protect(() => { setPanel(null); setContentsPinned(false); })} />;

  return (
    <div className={`app theme-${theme}${desktop ? ' is-desktop-app' : ''}${notebook ? ' is-notes-page' : ''}${book && !chrome ? ' is-focus-reading' : ''}`}>
      {desktop && <DesktopTitleBar native={desktop} theme={theme} guard={protect} onError={setNotice} />}
      <input
        ref={inputRef}
        className="file-input"
        type="file"
        accept=".epub,application/epub+zip"
        aria-label="选择 EPUB 文件"
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          if (selected) void importFile(selected);
          event.currentTarget.value = '';
        }}
      />
      <div className={`reader-main${docked ? ` reader-main-docked-${contentsSide}` : ''}`}>
      <header ref={headerRef} data-note-guarded className={`topbar ${file && !notebook ? 'reading-topbar' : ''} ${showChrome || notebook ? '' : 'focus-topbar'}`}>
        <button className="brand" onClick={closeBook} disabled={busy} aria-label="静读，返回首页">
          <img className="brand-mark" src={brandMark} alt="" aria-hidden="true" width={42} height={42} draggable={false} />
          <span>静读<span className="brand-caption">EPUB READER</span></span>
        </button>
        {file && !notebook && <div className="book-heading"><h1><span className="book-title">{book?.title ?? (busy ? '正在打开电子书' : '打开失败')}</span><span className="book-author">{book?.author ?? file.name}</span></h1>{book && <h2 className="reading-chapter" aria-label="当前章节" title={activeChapter?.label || book.title}>{activeChapter?.label || book.title}</h2>}</div>}
        {book && !notebook && <div className="toolbar">
          <button className="reader-action" onClick={() => protect(() => { setPanel(null); notesRef.current?.openNotebook({ bookId: selection?.id }); })}>笔记</button>
          <button className="reader-action contents-trigger" onClick={() => protect(() => { if (contentsPinned) { setContentsPinned(false); setPanel(null); } else setPanel(panel === 'contents' ? null : 'contents'); })} aria-expanded={contentsPinned || panel === 'contents'}>目录</button>
          <button className="reader-action" onClick={() => protect(() => setPanel(panel === 'settings' ? null : 'settings'))} aria-expanded={panel === 'settings'}>设置</button>
        </div>}
      </header>

      {!file && !notebook && libraryReady && <main className="library-page">
        <div className="library-heading"><div><div className="eyebrow">你的文字，留在本机</div><h1>我的书架</h1><p>{shelf.length ? `${shelf.length} 本书 · 最近阅读优先` : '还没有书籍，从下方的空白书位开始。'}</p></div><div className="library-actions"><button className="text-button" disabled={busy || !preferencesReady} onClick={() => void openGuide()}>使用指南</button><button className="text-button" onClick={() => notesRef.current?.openNotebook()}>我的笔记</button></div></div>
        <div className="book-grid" aria-label="书籍列表">
          {shelf.map((item) => <BookCard key={item.id} book={item} disabled={busy} onOpen={(value) => void openStored(value)} onDelete={value => { setClearBookNotes(false); setDeleteTarget(value); }} notes={activeNoteCounts({ annotations: notesSnapshot.annotations.filter(a => a.bookId === item.id), thoughts: notesSnapshot.thoughts.filter(t => t.bookId === item.id) })} onNotes={category => notesRef.current?.openNotebook({ bookId: item.id, category })} />)}
          <ImportCard disabled={busy || !preferencesReady} onChoose={() => inputRef.current?.click()} onFiles={dropBooks} />
        </div>
        {!shelf.length && <div className="empty-shelf-note"><p>给书架添一本书，让阅读回归文字本身。</p><button className="text-button" disabled={busy || !preferencesReady} onClick={() => void openDemo()}>先读一段样书 →</button></div>}
        <p className="library-hint">书籍和进度保存在当前浏览器。清理站点数据会删除书架，请保留原始 EPUB 文件。</p>
      </main>}
      {!file && !notebook && (!libraryReady || busy) && <div className="library-status" role="status">{busy ? '正在处理电子书…' : '正在读取本地书架…'}</div>}

      <section className="reading-space" data-book-id={selection?.id} data-columns={columns} hidden={!file} inert={!!notebook} aria-hidden={notebook ? true : undefined} aria-label="阅读区域">
        <div className="reader-viewport" ref={viewportRef} tabIndex={-1} />
        {busy && <div className="reader-overlay" role="status"><span className="loading-dot" />正在整理书页…</div>}
        {file && !book && !busy && error && <div className="reader-overlay"><p>这本书暂时无法打开</p><button onClick={closeBook}>返回首页</button></div>}
      </section>

      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="关闭错误提示">×</button></div>}
      {notice && <div className="notice" role="status">{notice}</div>}

      {book && !notebook && <>
        <footer data-note-guarded className={`reader-footer ${showChrome ? '' : 'is-hidden'}`}>
          <button onClick={() => turn('prev')} disabled={busy || location?.atStart} aria-label="上一页">← 上一页</button>
          <div className="reading-progress" aria-live="polite"><small>{location ? `第 ${location.chapterIndex} / ${location.chapterCount} 章 · 本章 ${location.page} / ${location.total} 页` : '正在定位…'}</small></div>
          <button onClick={() => turn('next')} disabled={busy || location?.atEnd} aria-label="下一页">下一页 →</button>
        </footer>
        <button data-note-guarded className="focus-toggle" onClick={() => protect(() => { setChrome(!chrome); setPanel(null); })} aria-label={chrome ? '进入专注模式' : '显示工具栏'}>{chrome ? '专注阅读' : '显示工具栏'}</button>
      </>}

      </div>
      {docked && !notebook && contents}
      {panel && book && !notebook && <div className="panel-backdrop" onClick={() => setPanel(null)}>
        {panel === 'contents' ? contents : <aside className="side-panel" aria-label="设置面板" onClick={(event) => event.stopPropagation()}>
          <div className="panel-heading"><h2>设置</h2><button onClick={() => setPanel(null)} aria-label="关闭面板">×</button></div>
          <div className="settings">
            <fieldset><legend>阅读主题</legend><div className="theme-options">{(Object.keys(themeNames) as ReaderTheme[]).map((value) => <button key={value} className={`theme-swatch swatch-${value}`} aria-pressed={theme === value} onClick={() => setTheme(value)}>{themeNames[value]}</button>)}</div></fieldset>
            <fieldset>
              <legend>目录显示位置</legend>
              <div className="position-options">
                <label className={contentsSide === 'left' ? 'is-selected' : ''}><input type="radio" name="contents-side" value="left" checked={contentsSide === 'left'} onChange={() => setContentsSide('left')} />左侧</label>
                <label className={contentsSide === 'right' ? 'is-selected' : ''}><input type="radio" name="contents-side" value="right" checked={contentsSide === 'right'} onChange={() => setContentsSide('right')} />右侧</label>
              </div>
              <p className="position-hint">改变目录弹框与固定目录的位置，目录按钮保持在右侧。点击目录标题前的图钉可固定目录。</p>
            </fieldset>
            <label className="font-label" htmlFor="font-size">文字大小 <output>{fontSize} px</output></label>
            <input id="font-size" type="range" min="14" max="32" step="1" value={fontSize} onChange={(event) => setFontSize(Number(event.currentTarget.value))} />
            <button className="reset-settings" onClick={() => { setTheme(DEFAULT_PREFERENCES.theme); setFontSize(DEFAULT_PREFERENCES.fontSize); setContentsSide(DEFAULT_PREFERENCES.contentsSide); setContentsPinned(DEFAULT_PREFERENCES.contentsPinned); }}>恢复默认设置</button>
            <AiSettings />
            <p className="setting-hint">阅读设置自动保存，下次打开继续使用。<br />← → ↑ ↓ 键翻页 · Esc 关闭面板<br />普通阅读与笔记在本机处理；主动使用 AI 时，仅发送确认的引用、问题与必要会话历史。</p>
          </div>
        </aside>}
      </div>}
      {deleteTarget && <div className="panel-backdrop delete-backdrop">
        <section className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
          <h2 id="delete-title">删除这本书？</h2><p id="delete-description">《{deleteTarget.title}》的本地文件、封面和阅读记录将一并删除。原始文件不受影响。</p>
          <p>默认保留笔记归档：{notesSnapshot.annotations.filter(a => a.bookId === deleteTarget.id).length} 段摘录 · {notesSnapshot.thoughts.filter(t => t.bookId === deleteTarget.id).length} 条思考。</p><label><input type="checkbox" checked={clearBookNotes} onChange={e => setClearBookNotes(e.target.checked)} />一并清理笔记及草稿（建议先导出）</label>
          <div><button disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button><button className="button-danger" disabled={busy} onClick={() => void deleteBook()}>确认删除</button></div>
        </section>
      </div>}
      <AiFeature ref={aiRef} bookId={selection?.id} theme={theme} onSettings={() => protect(() => setPanel('settings'))} onSave={(seed, message, text, onSaved) => notesRef.current?.appendAi(seed, text, message.thoughtId, onSaved)} />
      <NotesExperience ref={notesRef} onAskAi={seed => aiRef.current?.open(seed)} notebook={notebook} onNotebookChange={setNotebook} session={book} bookId={selection?.id} bookSnapshot={selection ? { title: book?.title ?? '', author: book?.author ?? '', fileName: selection.file.name } : undefined} books={shelf} onNotice={setNotice} onLocate={async a => {
        if (a.bookId === selection?.id && book) { await book.locateAnnotation(a); return; }
        const target = shelf.find(b => b.id === a.bookId);
        if (!target) throw new Error('原书未载入，无法回到原文；归档笔记仍可管理。');
        const stored = await library.read(target.id);
        await new Promise<void>((resolve, reject) => {
          pendingLocator.current = { annotation: a, resolve, reject };
          setSelection({ id: target.id, file: new File([stored.data], stored.book.fileName, { type: 'application/epub+zip' }) });
        });
      }} />
      {!file && !notebook && <footer className="landing-footer"><span>静读 / QUIET READER</span><span>离线优先 · 书籍与进度保存在本机</span></footer>}
    </div>
  );
}
