import { useEffect, useRef } from 'react';
import type { Chapter } from '../reader/engine';
import type { ContentsSide } from '../platform/preferences';

interface Props {
  chapters: Chapter[];
  activeChapter?: Chapter;
  side: ContentsSide;
  pinned: boolean;
  onJump(href: string): void;
  onPin(): void;
  onClose(): void;
}

export default function ContentsPanel({ chapters, activeChapter, side, pinned, onJump, onPin, onClose }: Props) {
  const listRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      const current = list?.querySelector<HTMLElement>('[aria-current="location"]');
      if (!list || !current) return;
      // 只滚动章节列表，不移动固定标题，也不滚动整张阅读页面。
      list.scrollTop += current.getBoundingClientRect().top - list.getBoundingClientRect().top
        - (list.clientHeight - current.offsetHeight) / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeChapter, pinned]);

  return <aside data-note-guarded className={`side-panel contents-panel contents-panel-${side}${pinned ? ' contents-dock' : ''}`} aria-label="章节目录" onClick={event => event.stopPropagation()}>
    <div className="panel-heading">
      <button className="contents-pin" aria-label={pinned ? '取消固定目录' : '固定目录'} aria-pressed={pinned} title={pinned ? '取消固定目录' : '固定目录'} onClick={onPin}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1 7 4 4v2H5v-2l4-4-1-7Z" /><path d="M12 16v6" /></svg>
      </button>
      <h2>章节目录</h2>
      <button onClick={onClose} aria-label="关闭面板">×</button>
    </div>
    <nav ref={listRef} className="chapter-list" aria-label="章节导航" tabIndex={0}>
      {chapters.length ? chapters.map((chapter, index) => <button key={`${chapter.id}-${index}`} style={{ paddingInlineStart: 8 + chapter.depth * 12 }} onClick={() => onJump(chapter.href)} aria-current={chapter === activeChapter ? 'location' : undefined}>{chapter.label || '未命名章节'}</button>) : <p>这本书没有提供目录。</p>}
    </nav>
  </aside>;
}
