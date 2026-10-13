import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HIGHLIGHTS, LINE_NAMES, type AnnotationRecord, type HighlightColor, type LineStyle } from '../platform/annotationTypes';
export function useFloatingPosition(point: { x: number; y: number }, width: number, placement: 'after' | 'before' | 'absolute' = 'after', gap = 8) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ x: 12, y: 120, width: innerWidth - 24, height: innerHeight - 24 });
  function measure() {
    const box = ref.current?.getBoundingClientRect();
    const viewport = window.visualViewport;
    const w = viewport?.width ?? innerWidth, h = viewport?.height ?? innerHeight;
    const titlebar = parseFloat(getComputedStyle(ref.current ?? document.documentElement).getPropertyValue('--desktop-titlebar-height')) || 0;
    const left = viewport?.offsetLeft ?? 0, top = (viewport?.offsetTop ?? 0) + titlebar;
    const availableWidth = Math.max(1, w - 24), availableHeight = Math.max(1, h - titlebar - 24);
    const x = Math.max(left + 12, Math.min(point.x, left + w - Math.min(box?.width ?? width, availableWidth) - 12));
    const height = Math.min(box?.height ?? 100, availableHeight);
    const preferred = placement === 'absolute' ? point.y : placement === 'before' && point.y - height - gap >= top + 12 ? point.y - height - gap : point.y + gap;
    const y = Math.max(top + 12, Math.min(preferred, top + h - titlebar - height - 12));
    setPosition(previous => previous.x === x && previous.y === y && previous.width === availableWidth && previous.height === availableHeight ? previous : { x, y, width: availableWidth, height: availableHeight });
  }
  useLayoutEffect(() => {
    measure(); const observer = new ResizeObserver(measure); if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', measure); window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure); };
  }, [point.x, point.y, width, placement, gap]);
  return { ref, measure, style: { left: position.x, top: position.y, width: Math.min(width, position.width), maxWidth: position.width, maxHeight: position.height } as CSSProperties };
}
export function NoteDialog({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose(): void; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => { const previous = document.activeElement as HTMLElement; ref.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  return <div className="notes-modal-backdrop" onClick={onClose}><section ref={ref} tabIndex={-1} className={`notes-dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]')).filter(el => el.getClientRects().length > 0);
    if (!items.length) return;
    if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === ref.current)) { event.preventDefault(); items.at(-1)?.focus(); }
    if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus(); }
  }}><header><h2>{title}</h2><button onClick={onClose} aria-label={`关闭${title}`}>×</button></header>{children}</section></div>;
}
export function StyleButtons({ annotation, disabled, onLine, onHighlight }: { annotation?: AnnotationRecord; disabled: boolean; onLine(value: LineStyle): void; onHighlight(value: HighlightColor): void }) {
  const [compact, setCompact] = useState(false);
  const [palette, setPalette] = useState(false);
  useLayoutEffect(() => {
    const query = window.matchMedia('(max-width:350px), (max-width:600px) and (pointer:coarse)');
    const update = () => setCompact(query.matches); update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const colors = Object.keys(HIGHLIGHTS) as HighlightColor[];
  const colorNames = ['黄色','绿色','蓝色','粉色'];
  return <><span className="style-group"><small>标注</small>{(Object.keys(LINE_NAMES) as LineStyle[]).map(style => <button key={style} title={`${LINE_NAMES[style]}${annotation?.line?.style === style ? '，再次点击取消' : ''}`} aria-label={LINE_NAMES[style]} aria-pressed={annotation?.line?.style === style} disabled={disabled} onClick={() => onLine(style)}><svg width="20" height="16" aria-hidden="true">{style === 'wavy' ? <path d="M1 9 Q4 3 7 9 T13 9 T19 9" stroke="currentColor" fill="none" /> : <line x1="1" y1="9" x2="19" y2="9" stroke="currentColor" strokeWidth="2" strokeDasharray={style === 'dashed' ? '4 3' : undefined} />}</svg></button>)}</span><span className={`style-group ${compact ? 'compact-highlights' : ''}`}><small>高亮</small>{compact && <><button aria-label={annotation?.highlightColor ? `${colorNames[colors.indexOf(annotation.highlightColor)]}高亮` : '选择高亮颜色'} aria-pressed={!!annotation?.highlightColor} disabled={disabled} title={annotation?.highlightColor ? '再次点击取消当前高亮' : '选择高亮颜色'} onClick={() => { if (annotation?.highlightColor) onHighlight(annotation.highlightColor); else setPalette(!palette); }}><span className="highlight-dot" style={{ background: annotation?.highlightColor ? HIGHLIGHTS[annotation.highlightColor] : 'transparent', border: '1px solid currentColor' }} /></button><button aria-label="展开高亮色板" aria-expanded={palette} disabled={disabled} onClick={() => setPalette(!palette)}>⌄</button></>}{(!compact || palette) && <span className="highlight-palette">{colors.map((color, index) => <button key={color} aria-label={`${colorNames[index]}高亮${compact ? '选项' : ''}`} title={annotation?.highlightColor === color ? '再次点击取消高亮' : '设置高亮'} aria-pressed={annotation?.highlightColor === color} disabled={disabled} onClick={() => { onHighlight(color); setPalette(false); }}><span className="highlight-dot" style={{ background: HIGHLIGHTS[color] }} /></button>)}</span>}</span></>;
}
