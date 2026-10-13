import { useState, type ReactNode } from 'react';
import type { AnnotationDraft } from '../platform/annotationTypes';
import { NoteDialog } from './notePrimitives';

export default function DraftRecoveryDialog({ drafts, busy, error, diagnostic, onClose, onRestore, onNew, onDiscard }: {
  drafts: AnnotationDraft[]; busy: boolean; error: string; diagnostic?: ReactNode;
  onClose(): void; onRestore(id: string): void; onNew(): void;
  onDiscard(id: string): Promise<boolean | undefined>;
}) {
  const [discarding, setDiscarding] = useState<AnnotationDraft>();
  function close() {
    if (busy) return;
    if (discarding) setDiscarding(undefined); else onClose();
  }
  const single = drafts.length === 1;
  return <div onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <NoteDialog key={discarding?.id ?? 'recover'} title={discarding ? '丢弃这份草稿' : '已有本机草稿'} className="draft-choice-dialog" onClose={close}>
      {discarding ? <>
        <p className="draft-choice-description">将永久丢弃这份本机草稿。已保存的正式思考、原书和其他草稿不受影响。</p>
        <p className="draft-choice-preview">{discarding.text || '（空白修改草稿）'}</p>
        <div className="delete-actions">
          <button className="button-secondary" disabled={busy} onClick={() => setDiscarding(undefined)}>取消</button>
          <button className="button-danger" disabled={busy} onClick={() => { void onDiscard(discarding.id).then(success => { if (success) setDiscarding(undefined); }); }}>{busy ? '丢弃中…' : '确认丢弃'}</button>
        </div>
      </> : <>
        <p className="draft-choice-description">这段文字有未提交的本机草稿。恢复后继续写，或另起一条思考；不会覆盖旧草稿。</p>
        <div className="draft-choice-list">
          {drafts.map((draft, index) => <section className="draft-choice-card" key={draft.id} aria-label={`草稿 ${index + 1}`}>
            {!single && <h3>草稿 {index + 1}</h3>}
            <p className="draft-choice-preview">{draft.text || '（空白修改草稿）'}</p>
            <div className="delete-actions">
              {single && <button className="button-secondary" disabled={busy} onClick={onNew}>另起一条思考</button>}
              <button className="button-danger" disabled={busy} onClick={() => setDiscarding(draft)}>丢弃这份草稿</button>
              <button className="button-primary" disabled={busy} onClick={() => onRestore(draft.id)}>恢复这份草稿</button>
            </div>
          </section>)}
        </div>
        {!single && <div className="delete-actions"><button className="button-secondary" disabled={busy} onClick={onNew}>另起一条思考</button></div>}
      </>}
      {error && <><p role="alert">{error}</p>{diagnostic}</>}
    </NoteDialog>
  </div>;
}
