import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { sourceLabel, type AnnotationSeed } from '../platform/annotationTypes';
import { useFloatingPosition } from './notePrimitives';

export default function ThoughtPopoverEditor({ seed, mode, text, status, busy, error, diagnostic, point, onText, onSave, onClose, onDiscard, onKeepDraft }: {
  seed: AnnotationSeed; mode: 'append' | 'edit'; text: string; status: string; busy: boolean; error: string;
  diagnostic?: ReactNode; point: { x: number; y: number }; onText(text: string): void;
  onSave(): void; onClose(): void; onDiscard(): void; onKeepDraft(): void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const more = useRef<HTMLSpanElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const discardButton = useRef<HTMLButtonElement>(null);
  const moreId = useId();
  const [fullSource, setFullSource] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [movedPoint, setMovedPoint] = useState<{ x: number; y: number }>();
  const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const { ref, style, measure } = useFloatingPosition(movedPoint ?? point, 628, movedPoint ? 'absolute' : 'after');
  const measureRef = useRef(measure); measureRef.current = measure;
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  function resize() {
    const area = textarea.current; if (!area) return;
    const scroll = area.scrollTop;
    area.style.height = '0px';
    const overhead = (ref.current?.offsetHeight ?? 100) - area.offsetHeight;
    const available = Math.max(40, (window.visualViewport?.height ?? innerHeight) - 24 - overhead);
    area.style.height = `${Math.min(available, Math.max(100, area.scrollHeight + 2))}px`;
    area.style.overflowY = area.scrollHeight > available ? 'auto' : 'hidden';
    area.scrollTop = scroll;
    measureRef.current();
  }
  useLayoutEffect(() => { resize(); }, [text, fullSource, error]);
  useLayoutEffect(() => {
    textarea.current?.focus();
    const observer = new ResizeObserver(resize);
    if (textarea.current) observer.observe(textarea.current);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); };
  }, []);
  useEffect(() => {
    if (!moreOpen) return;
    discardButton.current?.focus();
    const outside = (event: PointerEvent) => { if (!more.current?.contains(event.target as Node)) setMoreOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [moreOpen]);
  const source = `${seed.bookSnapshot.title} · ${seed.bookSnapshot.author} · ${sourceLabel(seed)}`;
  return <section ref={ref} style={style} className="note-popover thought-editor" role="dialog" aria-busy={busy} aria-label={mode === 'append' ? '写思考' : '编辑思考'} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && moreOpen) {
      event.preventDefault(); event.stopPropagation(); setMoreOpen(false); moreButton.current?.focus(); return;
    }
    if (event.key === 'Tab' && moreOpen) setMoreOpen(false);
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      if (event.key === 'Enter') { event.preventDefault(); if (!busy && !event.repeat) onSave(); }
      else if (event.key.toLowerCase() === 's') { event.preventDefault(); if (!busy && !event.repeat) onKeepDraft(); }
    }
  }}>
    <header className="thought-drag-handle" tabIndex={0} aria-label="移动思考窗口" title="拖动标题栏移动；方向键微调位置" onPointerDown={event => {
      if (event.button !== 0 || (event.target as Element).closest('button')) return;
      const box = ref.current?.getBoundingClientRect(); if (!box) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, left: box.left, top: box.top };
    }} onPointerMove={event => {
      const start = drag.current; if (!start) return;
      setMovedPoint({ x: start.left + event.clientX - start.x, y: start.top + event.clientY - start.y });
    }} onPointerUp={event => { drag.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = undefined; }} onKeyDown={event => {
      if (event.target !== event.currentTarget || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const box = ref.current?.getBoundingClientRect(); if (!box) return;
      setMovedPoint({ x: box.left + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0), y: box.top + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0) });
    }}>
      <span className="thought-drag-grip" aria-hidden="true">⠿</span>
      <h2>{mode === 'append' ? '写思考' : '编辑思考'}</h2>
      <span className="thought-source" title={source}>摘自：{sourceLabel(seed)}</span>
      <button className="thought-source-toggle" aria-label="查看完整出处" aria-expanded={fullSource} onClick={() => setFullSource(!fullSource)}>出处</button>
      <button className="thought-icon-btn thought-save" aria-label="保存并收起" aria-keyshortcuts="Control+Enter Meta+Enter" title={`保存并收起 (${modifier}+Enter)`} disabled={busy || !text.trim()} onClick={onSave}>✓</button>
      <span ref={more} className="thought-more" onPointerDown={event => event.stopPropagation()}>
        <button ref={moreButton} className="thought-icon-btn" aria-label="更多操作" aria-expanded={moreOpen} aria-controls={moreId} title="更多操作" disabled={busy} onClick={() => setMoreOpen(value => !value)}>⋯</button>
        {moreOpen && <span id={moreId} className="thought-more-menu" role="group" aria-label="更多操作">
          <button ref={discardButton} disabled={busy} onClick={() => {
            setMoreOpen(false);
            if (!text.trim() || window.confirm(mode === 'edit' ? '放弃本次修改及草稿？正式思考不受影响。' : '丢弃本次草稿？草稿内容将丢失。')) onDiscard();
            else moreButton.current?.focus();
          }}>丢弃本次草稿</button>
        </span>}
      </span>
      <button className="thought-icon-btn" aria-label="关闭思考" aria-keyshortcuts="Escape" title="关闭并保留草稿 (Esc)" onClick={onClose} disabled={busy}>×</button>
    </header>
    {fullSource && <small className="full-source">{source}</small>}
    <textarea ref={textarea} aria-label="思考正文" value={text} maxLength={20000} disabled={busy} onChange={e => onText(e.target.value)} onPaste={event => {
      const incoming = event.clipboardData.getData('text'); const area = event.currentTarget;
      if (text.length - (area.selectionEnd - area.selectionStart) + incoming.length > 20000) { event.preventDefault(); window.alert('思考超过 20,000 字，请分次记录；未截断粘贴内容。'); }
    }} />
    {error && <><p role="alert">{error}</p>{diagnostic}</>}
    <footer className="thought-statusbar">
      <span role="status" className={status === '草稿保存失败' ? 'thought-status-error' : undefined}>{status}</span>
      {status === '草稿保存失败' ? <button className="thought-retry" disabled={busy} onClick={onKeepDraft}>重试</button> : <span className="thought-shortcut-hint" aria-hidden="true">{modifier}+Enter 保存 · Esc 关闭</span>}
    </footer>
  </section>;
}
