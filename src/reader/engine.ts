import { Book, type Contents } from 'epubjs';
import { snapshotSelection, screenRects, verifiedRange, type SelectionSnapshot, type ScreenRect } from './selection';
import type { AnnotationRecord } from '../platform/annotationTypes';
import type Rendition from 'epubjs/types/rendition';
import type { Location } from 'epubjs/types/rendition';
import type { NavItem } from 'epubjs/types/navigation';
import { hardenChapter } from './security';
import { applyTheme, type ReaderTheme } from './themes';

export interface Chapter {
  id: string;
  href: string;
  label: string;
  depth: number;
}

export interface ReadingLocation {
  cfi: string;
  href: string;
  /** The current TOC entry, including a fragment for books with nested sections. */
  tocHref?: string;
  chapterIndex: number;
  chapterCount: number;
  page: number;
  total: number;
  atStart: boolean;
  atEnd: boolean;
}

export interface ReaderSession {
  title: string;
  author: string;
  chapters: Chapter[];
  restored: boolean;
  next(): Promise<void>;
  prev(): Promise<void>;
  display(href: string): Promise<void>;
  style(theme: ReaderTheme, fontSize: number, focused?: boolean): void;
  onSelection(callback: (snapshot: SelectionSnapshot) => void): () => void;
  onGeometry(callback: (phase: 'changing' | 'ready') => void): () => void;
  onPointer(callback: (point: { x: number; y: number; dragging: boolean; hasSelection?: boolean } | null) => void): () => void;
  annotationRects(annotation: AnnotationRecord): ScreenRect[];
  locateAnnotation(annotation: AnnotationRecord): Promise<void>;
  destroy(): void;
}

export function flattenChapters(items: NavItem[], depth = 0): Chapter[] {
  return items.flatMap((item) => [
    { id: item.id, href: item.href, label: item.label.trim(), depth },
    ...flattenChapters(item.subitems ?? [], depth + 1),
  ]);
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('打开超时，文件可能损坏或暂不兼容。')), 20000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function createReader(options: {
  data: ArrayBuffer;
  container: HTMLElement;
  signal: AbortSignal;
  savedCfi?: string;
  theme: ReaderTheme;
  fontSize: number;
  focused?: boolean;
  onLayout?(columns: 1 | 2): void;
  onLocation(location: ReadingLocation): void;
  onKey(event: KeyboardEvent): void;
  onError?(error: unknown): void;
  beforeNavigate?(action: () => void): void;
}): Promise<ReaderSession> {
  const { signal } = options;
  const book = new Book({
    replacements: 'blobUrl',
    requestMethod: () => Promise.reject(new Error('阅读引擎不允许读取书外网络资源。')),
  });
  let rendition: Rendition | undefined;
  let observer: ResizeObserver | undefined;
  let destroyed = false;
  const selectionListeners = new Set<(snapshot: SelectionSnapshot) => void>();
  const geometryListeners = new Set<(phase: 'changing' | 'ready') => void>();
  let navigationDepth = 0;
  const pointerListeners = new Set<(point: { x: number; y: number; dragging: boolean; hasSelection?: boolean } | null) => void>();
  const cleanups: (() => void)[] = [];
  const draggingContents = new Set<Contents>();
  const invalidSelectionContents = new Set<Contents>();
  const geometry = () => {
    if (!destroyed && !navigationDepth) geometryListeners.forEach(fn => fn('ready'));
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    cleanups.forEach(fn => fn());
    selectionListeners.clear(); geometryListeners.clear(); pointerListeners.clear();
    signal.removeEventListener('abort', destroy);
    // book.destroy() 会清理 rendition 与资源 Blob URL。
    book.destroy();
  };
  book.spine.hooks.content.register(hardenChapter);
  try {
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    await bounded(book.open(options.data, 'binary'));
    await bounded(book.opened);
    await bounded(book.ready);
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    const metadata = await book.loaded.metadata;
    if (metadata.layout === 'pre-paginated') throw new Error('暂不支持固定版式 EPUB，请使用可重排版电子书。');
    const chapters = flattenChapters((await book.loaded.navigation).toc);
    rendition = book.renderTo(options.container, {
      width: '100%', height: '100%', spread: 'auto', minSpreadWidth: 960,
      flow: 'paginated', allowScriptedContent: false,
    });
    const renderer = rendition;
    applyTheme(renderer, options.theme, options.fontSize, options.focused);
    renderer.on('keydown', options.onKey);
    // getContents() returns an array at runtime (the locked epub.js declaration is incorrect).
    const contentsList = () => renderer.getContents() as unknown as Contents[];
    const frameOf = (contents: Contents) => Array.from(options.container.querySelectorAll('iframe')).find(f => f.contentDocument === contents.document);
    // 所有导航入口共用同一时序：先使旧坐标失效，再移动正文，最后通知重新绘制。
    // 多步骤定位和并发导航期间不接受中间页面的坐标；失败时也恢复当前页标记。
    const navigate = async (action: () => Promise<unknown>): Promise<void> => {
      navigationDepth++;
      try {
        geometryListeners.forEach(fn => fn('changing'));
        contentsList().forEach(contents => contents.window.getSelection()?.removeAllRanges());
        await action();
      } finally {
        navigationDepth--;
        geometry();
      }
    };
    const captureSelection = (contents: Contents) => {
      if (navigationDepth || draggingContents.has(contents) || invalidSelectionContents.has(contents)) return;
      try {
        if (contentsList().filter(c => !c.window.getSelection()?.isCollapsed).length > 1) throw new Error('不支持跨章节 iframe 选文，请分段摘录。');
        const frame = frameOf(contents);
        const href = book.spine.get(contents.sectionIndex).href;
        if (!frame) return;
        const snapshot = snapshotSelection(contents, frame, href, chapters);
        if (snapshot) selectionListeners.forEach(fn => fn(snapshot));
      } catch (error) { options.onError?.(error); }
    };
    renderer.on('selected', (_cfi: string, contents: Contents) => captureSelection(contents));
    const outsideUp = () => {
      if (!draggingContents.size) return;
      draggingContents.forEach(c => invalidSelectionContents.add(c));
      draggingContents.clear(); options.onError?.(new Error('选文离开章节 iframe，无法可靠保存，请在同一章节内重新选择。'));
    };
    window.addEventListener('pointerup', outsideUp);
    cleanups.push(() => window.removeEventListener('pointerup', outsideUp));
    renderer.hooks.content.register((contents: Contents) => {
      let dragging = false;
      const down = (event: PointerEvent) => {
        invalidSelectionContents.clear(); dragging = true; draggingContents.add(contents); const frame = frameOf(contents); const box = frame?.getBoundingClientRect();
        pointerListeners.forEach(fn => fn(box ? { x: box.x + event.clientX, y: box.y + event.clientY, dragging: true } : null));
      };
      const up = () => {
        dragging = false;
        if (Array.from(draggingContents).some(c => c !== contents)) {
          draggingContents.forEach(c => invalidSelectionContents.add(c)); invalidSelectionContents.add(contents);
          draggingContents.clear(); options.onError?.(new Error('无法可靠保存跨章节 iframe 选文，请分段摘录。')); return;
        }
        draggingContents.delete(contents); captureSelection(contents);
      };
      const move = (event: PointerEvent) => {
        if (navigationDepth) return;
        const frame = frameOf(contents); if (!frame) return;
        const box = frame.getBoundingClientRect();
        pointerListeners.forEach(fn => fn({ x: box.x + event.clientX, y: box.y + event.clientY, dragging, hasSelection: !!contents.window.getSelection()?.toString() }));
      };
      const leave = () => pointerListeners.forEach(fn => fn(null));
      const cancel = () => { dragging = false; draggingContents.delete(contents); };
      // Intercept native chapter links before epub.js to protect dirty editors too.
      const link = (event: MouseEvent) => {
        const target = (event.target as Element)?.closest('a[href]');
        if (!target || !options.beforeNavigate) return;
        const href = target.getAttribute('href'); if (!href) return;
        event.preventDefault(); event.stopImmediatePropagation();
        options.beforeNavigate(() => { void navigate(() => renderer.display(new URL(href, new URL(book.spine.get(contents.sectionIndex).href, 'https://epub.invalid/')).pathname.slice(1) + (href.includes('#') ? '#' + href.split('#')[1] : ''))).catch(options.onError); });
      };
      contents.document.addEventListener('pointerdown', down);
      contents.document.addEventListener('pointerup', up);
      contents.document.addEventListener('pointermove', move);
      contents.document.addEventListener('pointerleave', leave);
      contents.document.addEventListener('pointercancel', cancel);
      contents.document.addEventListener('click', link, true);
      cleanups.push(() => {
        contents.document.removeEventListener('pointerdown', down); contents.document.removeEventListener('pointerup', up);
        contents.document.removeEventListener('pointermove', move); contents.document.removeEventListener('pointerleave', leave); contents.document.removeEventListener('pointercancel', cancel);
        draggingContents.delete(contents); invalidSelectionContents.delete(contents);
        contents.document.removeEventListener('click', link, true);
      });
    });
    renderer.on('rendered', geometry);
    renderer.on('resized', geometry);
    renderer.on('layout', (properties: { divisor: number }) => {
      if (!destroyed && !signal.aborted) options.onLayout?.(properties.divisor === 2 ? 2 : 1);
    });
    // epub.js resize clears its views, and only re-displays when its first location exists.
    // In a pinned/fractional-width shell the initial observer can run before that RAF,
    // leaving a successfully opened book empty forever. Hold only the latest size until ready.
    let located = false, pendingSize: { width: number; height: number } | undefined;
    const resize = (size: { width: number; height: number }) => {
      if (destroyed || signal.aborted) return;
      if (!located) { pendingSize = size; return; }
      renderer.resize(size.width, size.height);
    };
    renderer.on('relocated', (location: Location) => {
      if (destroyed || signal.aborted) return;
      if (!located) {
        located = true;
        const size = pendingSize; pendingSize = undefined;
        if (size) queueMicrotask(() => resize(size));
      }
      geometry();
      const candidates = chapters.filter(chapter => chapter.href.split('#')[0] === location.start.href.split('#')[0]);
      let activeChapter = candidates[0];
      try {
        const contents = contentsList().find(c => c.sectionIndex === location.start.index);
        const range = contents?.range(location.start.cfi);
        if (contents && range) for (const chapter of candidates) {
          const fragment = chapter.href.split('#')[1];
          if (!fragment) { activeChapter = chapter; continue; }
          const anchor = contents.document.getElementById(decodeURIComponent(fragment));
          if (anchor && !(anchor.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_PRECEDING)) activeChapter = chapter;
        }
      } catch { /* Missing or malformed anchors fall back to the resource's first TOC entry. */ }
      options.onLocation({
        cfi: location.start.cfi,
        href: location.start.href,
        tocHref: activeChapter?.href,
        chapterIndex: location.start.index + 1,
        chapterCount: book.packaging.spine.length,
        page: location.start.displayed.page,
        total: location.start.displayed.total,
        atStart: location.atStart,
        atEnd: location.atEnd,
      });
    });
    let restored = false;
    if (options.savedCfi) {
      try {
        await bounded(renderer.display(options.savedCfi));
        restored = true;
      } catch {
        if (signal.aborted) throw new DOMException('已取消', 'AbortError');
        await bounded(renderer.display());
      }
    } else {
      await bounded(renderer.display());
    }
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    observer = new ResizeObserver(([entry]) => {
      if (!destroyed && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        resize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
      }
    });
    observer.observe(options.container);
    signal.addEventListener('abort', destroy, { once: true });
    return {
      title: metadata.title || '未命名书籍',
      author: metadata.creator || '未知作者',
      chapters, restored,
      next: () => navigate(() => renderer.next()),
      prev: () => navigate(() => renderer.prev()),
      display: (href) => navigate(() => renderer.display(href)),
      style: (theme, fontSize, focused = false) => { applyTheme(renderer, theme, fontSize, focused); requestAnimationFrame(geometry); },
      onSelection: callback => { selectionListeners.add(callback); return () => { selectionListeners.delete(callback); }; },
      onGeometry: callback => { geometryListeners.add(callback); return () => { geometryListeners.delete(callback); }; },
      onPointer: callback => { pointerListeners.add(callback); return () => { pointerListeners.delete(callback); }; },
      annotationRects: annotation => {
        if (destroyed || navigationDepth) return [];
        const contents = contentsList().find(c => c.sectionIndex === annotation.locator.spineIndex);
        const frame = contents && frameOf(contents);
        if (!contents || !frame) return [];
        try {
          const rects = screenRects(verifiedRange(contents, annotation), frame);
          const box = options.container.getBoundingClientRect();
          return rects.filter(r => r.x < box.right && r.x + r.width > box.left && r.y < box.bottom && r.y + r.height > box.top).map(r => ({ x: Math.max(r.x, box.left), y: Math.max(r.y, box.top), width: Math.min(r.x + r.width, box.right) - Math.max(r.x, box.left), height: Math.min(r.y + r.height, box.bottom) - Math.max(r.y, box.top) }));
        } catch { return []; }
      },
      locateAnnotation: annotation => navigate(async () => {
        await renderer.display(annotation.locator.href);
        const contents = contentsList().find(c => c.sectionIndex === annotation.locator.spineIndex);
        if (!contents) throw new Error('未找到原文资源。');
        const range = verifiedRange(contents, annotation);
        await renderer.display(contents.cfiFromRange(range));
      }),
      destroy,
    };
  } catch (error) {
    destroy();
    throw error;
  }
}
