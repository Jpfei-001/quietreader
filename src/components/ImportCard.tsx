import { useRef, useState } from 'react';

export default function ImportCard({ disabled, onChoose, onFiles }: {
  disabled: boolean;
  onChoose(): void;
  onFiles(files: File[]): void;
}) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  return (
    <button
      type="button"
      className={`import-card ${dragging && !disabled ? 'is-dragging' : ''}`}
      aria-label="添加书籍"
      disabled={disabled}
      onClick={onChoose}
      onDragEnter={(event) => {
        event.preventDefault();
        if (disabled || !event.dataTransfer.types.includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (!disabled) onFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <span className="import-symbol" aria-hidden="true">＋</span>
      <strong>{disabled ? '正在处理…' : dragging ? '松开即可添加' : '添加书籍'}</strong>
      <span className="import-hint">点击选择，或拖入 EPUB</span>
      <span className="import-limit">单本不超过 20 MB</span>
    </button>
  );
}
