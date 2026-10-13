import { useEffect, useRef, useState } from 'react';
import { NoteDialog } from './notePrimitives';
import { anchorKey } from '../platform/annotationTypes';
import { groupAnnotations } from '../platform/annotationGroups';
import { annotations } from '../platform/annotations';
import { backupOf, makeDownload, markdownOf, MAX_BACKUP_BYTES, hasRestoreChoice, parseBackup, previewRestore, restoreBackup, type NotesBackup, type RestorePreview } from '../platform/noteTransfer';
function errorMessage(error: unknown) { return error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '本机存储或文件处理失败，请检查空间和权限后重试。'; }
export function ExportDialog({ ids, scope, onClose }: { ids: string[]; scope: string; onClose(): void }) {
  const [backup, setBackup] = useState<NotesBackup>(); const [format, setFormat] = useState<'md'|'json'|'zip'>('md');
  const [draftCount, setDraftCount] = useState(0);
  const [error, setError] = useState(''); const [progress, setProgress] = useState<number>(); const abort = useRef<AbortController | null>(null);
  useEffect(() => { let active = true; void annotations.snapshot().then(snapshot => { if (active) { const b = backupOf(snapshot, ids); setBackup(b); const anchors = new Set(b.annotations.map(a => a.anchorKey)); setDraftCount(snapshot.drafts.filter(d => anchors.has(anchorKey(d.seed))).length); } }).catch(e => setError(errorMessage(e))); return () => { active = false; abort.current?.abort(); }; }, []);
  async function download() {
    if (!backup || abort.current) return;
    const controller = new AbortController(); abort.current = controller; setError(''); setProgress(0);
    try {
      const blob = await makeDownload(backup, format, controller.signal, setProgress);
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `静读笔记-${new Date().toISOString().slice(0,10)}.${format}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { setError(errorMessage(e)); } finally { abort.current = null; setProgress(undefined); }
  }
  return <NoteDialog title="导出笔记" className="export-dialog" onClose={() => { abort.current?.abort(); onClose(); }}>
    <p className="export-scope">{scope} · {backup ? groupAnnotations(backup).length : 0} 段摘录 · {backup?.thoughts.length ?? 0} 条思考</p>
    <label className="export-format">导出格式<select aria-label="导出格式" value={format} disabled={progress !== undefined} onChange={e => setFormat(e.target.value as typeof format)}><option value="md">Markdown · 阅读与分享</option><option value="json">JSON · 恢复备份</option><option value="zip">ZIP · 笔记与备份</option></select></label>
    <p className="export-hint">{format === 'md' ? '仅包含原文、出处、标记、备注和你的思考，不含内部编号。' : '备份包含恢复所需的定位数据；阅读版笔记不显示内部编号。'}文件仅下载到本机，不含原书。</p>
    {draftCount > 0 && <p className="export-hint" role="status">有 {draftCount} 份未提交草稿，本次仅导出已保存内容。需要导出草稿时，请先恢复并保存。</p>}
    {backup ? <details className="export-preview-panel"><summary>预览笔记内容</summary><pre className="export-preview">{markdownOf(backup)}</pre></details> : <p role="status">正在读取笔记…</p>}
    {error && <p role="alert">{error}</p>}{progress !== undefined && <p role="status">导出进度 {progress}% <button onClick={() => abort.current?.abort()}>取消导出</button></p>}
    <div className="export-actions"><button disabled={progress !== undefined} onClick={onClose}>取消</button><button className="button-primary" disabled={!backup || !backup.annotations.length || progress !== undefined} onClick={() => void download()}>下载 {format.toUpperCase()}</button></div>
  </NoteDialog>;
}
export function RestoreDialog({ onClose, onBusyChange }: { onClose(): void; onBusyChange(value: boolean): void }) {
  const [backup, setBackup] = useState<NotesBackup>(); const [preview, setPreview] = useState<RestorePreview>(); const [choices, setChoices] = useState<Record<string, 'local'|'incoming'>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  function markBusy(value: boolean) { onBusyChange(value); setBusy(value); }
  async function read(file: File) {
    if (busy) return;
    markBusy(true); setError(''); setBackup(undefined); setPreview(undefined); setChoices({});
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('备份超过 20 MB。');
      const parsed = parseBackup(await file.text()); const result = previewRestore(parsed, await annotations.snapshot()); setBackup(parsed); setPreview(result);
    } catch (e) { setError(errorMessage(e)); } finally { markBusy(false); }
  }
  async function restore() {
    if (!backup || !preview || busy) return; markBusy(true); setError('');
    try { await restoreBackup(backup, preview, choices); onClose(); } catch (e) { setError(errorMessage(e)); } finally { markBusy(false); }
  }
  return <NoteDialog title="恢复 JSON 备份" onClose={() => { if (!busy) onClose(); }}><p>不包含 EPUB；缺书笔记归档，不会按同名书籍自动绑定。确认前不写入。</p><input type="file" accept=".json,application/json" aria-label="选择笔记 JSON 备份" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void read(file); e.target.value = ''; }} />{preview && <><p>新增 {preview.added} · 重复 {preview.duplicate} · 同选区合并 {preview.merged} · 冲突 {preview.conflicts.length}</p><p>思考新增 {preview.addedThoughts} · 思考重复 {preview.duplicateThoughts}</p><p>同选区不同 ID 合并保留全部独立思考；编号冲突会分配新的递增编号。</p>{preview.conflicts.map(c => <section key={c.id} className="restore-conflict"><h3>冲突：{c.id}</h3><div><pre>本机：{c.local}</pre><pre>恢复：{c.incoming}</pre></div><label><input type="radio" disabled={busy} name={c.id} checked={choices[c.id] === 'local'} onChange={() => setChoices({ ...choices, [c.id]: 'local' })} />保留本机</label><label><input type="radio" disabled={busy} name={c.id} checked={choices[c.id] === 'incoming'} onChange={() => setChoices({ ...choices, [c.id]: 'incoming' })} />使用恢复版本</label></section>)}<button disabled={busy || preview.conflicts.some(c => !hasRestoreChoice(choices, c.id))} onClick={() => void restore()}>确认恢复</button></>}{busy && <p role="status">正在校验 / 写入…</p>}{error && <p role="alert">{error}</p>}</NoteDialog>;
}
