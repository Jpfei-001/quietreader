import { LINE_NAMES, type AnnotationRecord } from '../platform/annotationTypes';
const colorNames = { yellow: '黄色', green: '绿色', blue: '蓝色', pink: '粉色' };
export default function AnnotationTags({ members, thoughtCount }: { members: AnnotationRecord[]; thoughtCount: number }) {
  const lines = [...new Set(members.flatMap(a => a.line ? [a.line.style] : []))];
  const highlights = [...new Set(members.flatMap(a => a.highlightColor ? [a.highlightColor] : []))];
  return <div className="annotation-tags" aria-label="摘录标签">
    {lines.length ? lines.map(style => <span key={style} className="note-tag tag-line">标注 · {LINE_NAMES[style]}</span>) : <span className="note-tag tag-muted">无标注</span>}
    {highlights.length ? highlights.map(color => <span key={color} className={`note-tag tag-highlight tag-${color}`}>高亮 · {colorNames[color]}</span>) : <span className="note-tag tag-muted">无高亮</span>}
    <span className={`note-tag ${thoughtCount ? 'tag-thought' : 'tag-muted'}`}>思考 {thoughtCount} 条</span>
  </div>;
}
