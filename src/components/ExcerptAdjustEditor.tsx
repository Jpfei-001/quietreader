import { useLayoutEffect, useRef, useState } from 'react';
import { sourceLabel, type AnnotationRecord, type AnnotationSeed } from '../platform/annotationTypes';
import type { AnnotationChanges } from '../platform/annotations';
import { StyleButtons, useFloatingPosition } from './notePrimitives';

export default function ExcerptAdjustEditor({ annotation, seed, changes, busy, onChange, onSave, onCancel, onThoughts }: {
  annotation: AnnotationRecord; seed?: AnnotationSeed; changes: AnnotationChanges; busy: boolean;
  onChange(changes: AnnotationChanges): void; onSave(): void; onCancel(): void; onThoughts(): void;
}) {
  const [point, setPoint] = useState<{ x: number; y: number }>();
  const width = 560;
  const drag = useRef<{ x: number; y: number; left: number; top: number } | undefined>(undefined);
  const { ref, style } = useFloatingPosition(point ?? { x: innerWidth - width - 20, y: 110 }, width, 'absolute');
  useLayoutEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  const current = seed ?? annotation;
  return <section ref={ref} style={style} tabIndex={-1} className="note-popover excerpt-adjust-editor" role="dialog" aria-modal="false" aria-label="调整已有摘录" data-note-guarded>
    <header className="thought-drag-handle" tabIndex={0} aria-label="移动摘录调整窗口" title="拖动标题栏移动，方向键微调" onPointerDown={event => {
      if (event.button !== 0 || (event.target as Element).closest('button')) return;
      const box = ref.current?.getBoundingClientRect(); if (!box) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, left: box.left, top: box.top };
    }} onPointerMove={event => {
      const start = drag.current; if (start) setPoint({ x: start.left + event.clientX - start.x, y: start.top + event.clientY - start.y });
    }} onPointerUp={event => { drag.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = undefined; }} onKeyDown={event => {
      if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const box = ref.current?.getBoundingClientRect(); if (!box) return;
      setPoint({ x: box.left + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0), y: box.top + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0) });
    }}><span className="thought-drag-grip" aria-hidden="true">⠿</span><h2>调整已有摘录</h2><button disabled={busy} aria-label="关闭调整已有摘录" onClick={onCancel}>×</button></header>
    <p className="adjust-hint">直接在正文中拖选，替换这段摘录；保存前不会改变原笔记。</p>
    <details className="adjust-preview"><summary>{seed ? '已重新选文 · 查看摘录' : '查看当前摘录'}</summary><blockquote>{current.quote.exact}</blockquote><small>摘录自：{sourceLabel(current)}</small></details>
    <label className="adjust-title">自拟标题<input aria-label="摘录标题" disabled={busy} maxLength={500} value={changes.title} onChange={e => onChange({ ...changes, title: e.target.value })} /></label>
    <div className="adjust-styles" aria-label="摘录标注样式">
      <StyleButtons annotation={{ ...annotation, ...changes }} disabled={busy}
        onLine={style => onChange({ ...changes, line: changes.line?.style === style ? null : { style, color: changes.line?.color ?? '#52735c', origin: 'user' } })}
        onHighlight={color => onChange({ ...changes, highlightColor: color === changes.highlightColor ? null : color })} />
      <label className="adjust-line-color">线色<input aria-label="划线颜色" type="color" value={changes.line?.color ?? '#52735c'} disabled={busy || !changes.line} onChange={e => { if (changes.line) onChange({ ...changes, line: { ...changes.line, color: e.target.value, origin: 'user' } }); }} /></label>
    </div>
    <div className="adjust-actions"><button className="button-primary" disabled={busy} onClick={onSave}>保存调整</button><button disabled={busy} onClick={onCancel}>取消</button><button className="button-secondary" disabled={busy} onClick={onThoughts}>查看 / 逐条编辑思考</button></div>
  </section>;
}
