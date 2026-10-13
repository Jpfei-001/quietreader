import { StyleButtons, useFloatingPosition } from './notePrimitives';
import type { AnnotationRecord, HighlightColor, LineStyle } from '../platform/annotationTypes';
export default function SelectionToolbar({ annotation, busy, point, onLine, onHighlight, onThought, onAi, onClose }: {
  annotation?: AnnotationRecord; busy: boolean; point: { x: number; y: number };
  onLine(value: LineStyle): void; onHighlight(value: HighlightColor): void; onThought(): void; onAi?(): void; onClose(): void;
}) {
  const { ref, style } = useFloatingPosition(point, 460, 'before', 6);
  return <section ref={ref} style={style} className="selection-toolbar note-popover" aria-label="选文工具条">
    <div className="selection-actions"><StyleButtons annotation={annotation} disabled={busy} onLine={onLine} onHighlight={onHighlight} /><button disabled={busy} onClick={onThought}>思考</button>{onAi && <button disabled={busy} onClick={onAi}>问 AI</button>}<button aria-label="关闭选文工具条" onClick={onClose}>×</button></div>
  </section>;
}
