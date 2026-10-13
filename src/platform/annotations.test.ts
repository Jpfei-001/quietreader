import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import Dexie from 'dexie';
import { LibraryDatabase, BookRepository } from './library';
import { AnnotationRepository } from './annotations';
import { anchorKey, type AnnotationSeed } from './annotationTypes';
import { backupOf, markdownOf, parseBackup, previewRestore, restoreBackup, compareAnnotations } from './noteTransfer';
let db: LibraryDatabase, repo: AnnotationRepository;
const seed: AnnotationSeed = { bookId: 'a'.repeat(64), bookSnapshot: { title: '书 <script>', author: '作者', fileName: '书.epub' }, locator: { rangeCfi: 'epubcfi(/6/2!/4,/2/1:0,/2/1:5)', href: 'chapter.xhtml', spineIndex: 0 }, quote: { exact: '第一段\n第二段', prefix: '前', suffix: '后' }, source: { tocPath: ['章'], headingPath: ['标题'], paragraphIndex: 1 } };
beforeEach(() => { db = new LibraryDatabase(`notes-${crypto.randomUUID()}`); repo = new AnnotationRepository(db); });
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });
const save = (id: string, text = id) => repo.saveThought({ seed, id, text, mode: 'append' });
async function backup() { return backupOf(await repo.snapshot(), (await db.annotations.toArray()).map(a => a.id)); }
describe('标注事务与 v3 升级', () => {
  it('v2 保全 EPUB、封面、进度和设置，v3 新增索引', async () => {
    const old = new Dexie(db.name); old.version(1).stores({books:'id,lastReadAt,addedAt',files:'bookId',covers:'bookId',progress:'bookId'}); old.version(2).stores({settings:'id'});
    await old.table('books').put({id:seed.bookId,title:'原书'}); await old.table('files').put({bookId:seed.bookId,data:new Uint8Array([1,2]).buffer}); await old.table('covers').put({bookId:seed.bookId,blob:new Blob(['cover'])}); await old.table('progress').put({bookId:seed.bookId,cfi:'epubcfi(/6/2!/4/2:0)'}); await old.table('settings').put({id:'reader',value:{version:1,theme:'dark',fontSize:24,contentsSide:'right'}}); old.close();
    await save('t'); expect(db.verno).toBe(3); expect((await db.files.get(seed.bookId))?.data.byteLength).toBe(2); expect((await db.covers.get(seed.bookId))?.blob.size).toBe(5); expect((await db.progress.get(seed.bookId))?.cfi).toContain('/6/2'); expect((await new BookRepository(db).loadPreferences()).theme).toBe('dark');
    expect(db.annotations.schema.idxByName.anchorKey.unique).toBe(true); expect(db.thoughts.schema.idxByName['[annotationId+ordinal]'].unique).toBe(true);
  });
  it('同 anchor 防重复，CAS 冲突无副作用，标签取消独立', async () => {
    const a = await repo.change(seed,{line:{style:'wavy',color:'#52735c',origin:'user'},highlightColor:'pink',isBookmarked:true});
    const b = await repo.change(seed,{line:null},{id:a.id,revision:a.revision});
    expect(b.highlightColor).toBe('pink'); expect(b.isBookmarked).toBe(true); expect(b.id).toBe(a.id);
    await expect(repo.change(seed,{title:'过期'},{id:a.id,revision:a.revision})).rejects.toThrow('另一窗口'); expect(await db.annotations.count()).toBe(1);
  });
  it('并发追加分配唯一编号，重试 ID 幂等，删除不复用，编辑不覆盖', async () => {
    await Promise.all([save('1'),save('2'),save('3')]); const entries = await db.thoughts.toArray(); expect(entries.map(t=>t.ordinal).sort()).toEqual([1,2,3]);
    await save('2'); expect(await db.thoughts.count()).toBe(3);
    const second = entries.find(t=>t.ordinal===2)!; await repo.saveThought({seed,id:second.id,text:'修改第二次',mode:'edit',revision:second.revision});
    expect((await db.thoughts.get(entries.find(t=>t.ordinal===1)!.id))?.text).not.toBe('修改第二次');
    await expect(repo.saveThought({seed,id:second.id,text:'过期',mode:'edit',revision:second.revision})).rejects.toThrow('另一窗口');
    await repo.removeThought(second.id,2); expect((await save('4')).ordinal).toBe(4);
  });
  it('保存失败原子回滚摘录、编号、自动线和草稿', async () => {
    vi.spyOn(db.thoughts,'put').mockRejectedValueOnce(new Error('写入失败'));
    await expect(save('failed')).rejects.toThrow('写入失败'); expect(await db.annotations.count()).toBe(0); expect(await db.thoughts.count()).toBe(0);
    expect((await save('1')).ordinal).toBe(1);
    const original = await repo.snapshot(); vi.spyOn(db.annotations,'put').mockRejectedValueOnce(new Error('后半失败'));
    await expect(save('2')).rejects.toThrow(); expect(await repo.snapshot()).toEqual(original);
  });
  it('自动线来源、最后条删除与手工取消不补回', async () => {
    const t = await save('1'); let a = (await db.annotations.toArray())[0]; expect(a.line?.origin).toBe('thought');
    const token = await repo.removeThought(t.id,t.revision); expect((await db.annotations.get(a.id))?.line).toBeNull(); await repo.undo(token);
    a = (await db.annotations.toArray())[0]; await repo.change(seed,{line:null},{id:a.id,revision:a.revision}); await save('2'); expect((await db.annotations.get(a.id))?.line).toBeNull();
  });
  it('整段删除与单条撤销恢复原 ID、ordinal、草稿，事务失败回滚', async () => {
    const t = await save('1'); const a = (await db.annotations.toArray())[0];
    await repo.saveDraft({version:1,id:'draft',sessionId:'session',seed,annotationId:a.id,thoughtId:'pending',mode:'append',text:'草稿',updatedAt:1});
    const before = await repo.snapshot(); const token = await repo.removeAnnotation(a.id,a.revision); expect(await db.thoughts.count()).toBe(0); expect(await db.annotationDrafts.count()).toBe(0); await repo.undo(token); expect(await repo.snapshot()).toEqual(before);
    const single = await repo.removeThought(t.id,t.revision); await repo.undo(single); expect((await db.thoughts.get(t.id))?.ordinal).toBe(1);
    vi.spyOn(db.annotationDrafts,'bulkDelete').mockRejectedValueOnce(new Error('失败')); const state = await repo.snapshot(); await expect(repo.removeAnnotation(a.id,(await db.annotations.get(a.id))!.revision)).rejects.toThrow(); expect(await repo.snapshot()).toEqual(state);
  });
  it('删书默认归档，明确清理笔记保持原子事务', async () => {
    const books = new BookRepository(db); await books.add({id:seed.bookId,title:'书',author:'作者',fileName:'书.epub',data:new ArrayBuffer(3)}); await save('1'); await books.remove(seed.bookId); expect(await db.annotations.count()).toBe(1); await books.remove(seed.bookId,true); expect(await db.annotations.count()).toBe(0); expect(await db.thoughts.count()).toBe(0);
  });
  it('空白与超长选文/思考拒绝', async () => { await expect(save('x',' ')).rejects.toThrow('不能为空'); await expect(save('x','x'.repeat(20001))).rejects.toThrow('20,000'); await expect(repo.change({...seed,quote:{...seed.quote,exact:'x'.repeat(10001)}},{isBookmarked:true})).rejects.toThrow('10,000'); });
});
describe('安全导出恢复', () => {
  it('完整往返与重复恢复不增数、CFI 数值顺序、安全 Markdown', async () => {
    await save('1','<img onerror="x"> `code`\n第二段'); const b = await backup(); const parsed = parseBackup(JSON.stringify(b)); expect(parsed.annotations[0].quote.exact).toBe(seed.quote.exact);
    const preview = previewRestore(parsed,await repo.snapshot()); expect(preview.duplicate).toBe(1); expect(preview.conflicts).toHaveLength(0); await restoreBackup(parsed,preview,{},repo); await restoreBackup(parsed,previewRestore(parsed,await repo.snapshot()),{},repo); expect(await db.thoughts.count()).toBe(1);
    expect(markdownOf(b)).toContain('&lt;img'); expect(markdownOf(b)).toContain('\\`code\\`'); expect(markdownOf(b)).toContain('第 1 次思考');
    const a=b.annotations[0]; expect(compareAnnotations({...a,locator:{...a.locator,rangeCfi:'epubcfi(/6/2!/4,/2/1:2,/2/1:3)'}},{...a,locator:{...a.locator,rangeCfi:'epubcfi(/6/2!/4,/2/1:10,/2/1:11)'}})).toBeLessThan(0);
  });
  it('结构、版本、恶意颜色、CFI、路径、ID、编号与体积拒绝且不写库', async () => {
    await save('1'); const b = await backup();
    for (const mutate of [(v:typeof b)=>{v.version=2 as 1;},(v:typeof b)=>{v.annotations[0].line!.color='url(javascript:x)';},(v:typeof b)=>{v.annotations[0].locator.rangeCfi='epubcfi(bad)';},(v:typeof b)=>{v.annotations[0].locator.href='https://example.com';},(v:typeof b)=>{v.thoughts.push(v.thoughts[0]);},(v:typeof b)=>{v.thoughts[0].ordinal=0;},(v:typeof b)=>{v.annotations[0].quote.exact='x'.repeat(10001);},(v:typeof b)=>{v.annotations[0].bookId='same title';}]) {
      const changed=structuredClone(b); mutate(changed); expect(()=>parseBackup(JSON.stringify(changed))).toThrow();
    }
    expect(()=>parseBackup(' '.repeat(20*1024*1024+1))).toThrow('20 MB'); expect(await db.thoughts.count()).toBe(1);
  });
  it('同 ID 文本冲突必须显式选择，过期 preview 拒绝，恢复失败无残留', async () => {
    await save('1'); const b=await backup(); b.thoughts[0].text='恢复版本'; let p=previewRestore(b,await repo.snapshot()); expect(p.conflicts).toHaveLength(1);
    await expect(restoreBackup(b,p,{},repo)).rejects.toThrow('逐项选择'); await restoreBackup(b,p,{'1':'local'},repo); expect((await db.thoughts.get('1'))?.text).toBe('1');
    p=previewRestore(b,await repo.snapshot()); await restoreBackup(b,p,{'1':'incoming'},repo); expect((await db.thoughts.get('1'))?.text).toBe('恢复版本'); expect(previewRestore(b,await repo.snapshot()).conflicts).toHaveLength(0);
    await save('2'); await expect(restoreBackup(b,p,{'1':'incoming'},repo)).rejects.toThrow('另一窗口');
    const extra=structuredClone(b); extra.annotations[0].id='incoming'; extra.thoughts[0].id='new'; extra.thoughts[0].annotationId='incoming'; const preview=previewRestore(extra,await repo.snapshot()); const before=await repo.snapshot(); vi.spyOn(db.thoughts,'add').mockRejectedValueOnce(new Error('恢复失败')); await expect(restoreBackup(extra,preview,{},repo)).rejects.toThrow(); expect(await repo.snapshot()).toEqual(before);
  });
  it('同 anchor 不同 ID 合并保全独立思考，删除序号不复用，重复合并幂等', async () => {
    await save('1'); await save('2'); const b=await backup(); const a=(await db.annotations.toArray())[0]; await repo.removeThought('1',1);
    b.annotations[0].id='other'; b.thoughts=b.thoughts.slice(0,1).map(t=>({...t,id:'other-thought',annotationId:'other'}));
    expect(b.annotations[0].anchorKey).toBe(anchorKey(seed)); const p=previewRestore(b,await repo.snapshot()); const choices=Object.fromEntries(p.conflicts.map(c=>[c.id,'local' as const])); await restoreBackup(b,p,choices,repo);
    expect(await db.annotations.count()).toBe(1); expect((await db.thoughts.get('other-thought'))?.ordinal).toBe(3); expect((await db.annotations.get(a.id))?.nextThoughtOrdinal).toBe(4);
    const again=previewRestore(b,await repo.snapshot()); await restoreBackup(b,again,Object.fromEntries(again.conflicts.map(c=>[c.id,'local' as const])),repo); expect(await db.thoughts.count()).toBe(2);
  });
});

it('两个数据库连接并发追加、单条编辑 CAS、撤销超时与冲突拒绝', async () => {
  const secondDb = new LibraryDatabase(db.name); const second = new AnnotationRepository(secondDb);
  try {
    const entries = await Promise.all([save('one'), second.saveThought({seed,id:'two',text:'two',mode:'append'})]);
    expect(new Set(entries.map(t=>t.ordinal)).size).toBe(2);
    const first=entries[0]; await second.saveThought({seed,id:first.id,text:'另一窗口',mode:'edit',revision:first.revision});
    await expect(repo.saveThought({seed,id:first.id,text:'旧窗口',mode:'edit',revision:first.revision})).rejects.toThrow('另一窗口');
    const token=await repo.removeThought(first.id,2); await save('later'); await expect(repo.undo(token)).rejects.toThrow('另一窗口');
    await expect(repo.undo({...token,expires:0})).rejects.toThrow('时限');
  } finally { secondDb.close(); }
});
it('同一备份内部的同 anchor 不同 ID 预览与合并准确，取消导出不生成文件', async () => {
  const { makeDownload } = await import('./noteTransfer');
  await save('original'); const b=await backup(); await repo.removeAnnotation(b.annotations[0].id,b.annotations[0].revision);
  const extra=structuredClone(b.annotations[0]); extra.id='other-id'; b.annotations.push(extra); b.thoughts.push({...b.thoughts[0],id:'other-thought',annotationId:'other-id'});
  const checked=parseBackup(JSON.stringify(b)); const p=previewRestore(checked,await repo.snapshot()); expect(p.added).toBe(1); expect(p.merged).toBe(1); expect(p.addedThoughts).toBe(2);
  await restoreBackup(checked,p,{},repo); expect(await db.annotations.count()).toBe(1); expect(await db.thoughts.count()).toBe(2);
  const controller=new AbortController(); controller.abort(); await expect(makeDownload(checked,'zip',controller.signal,()=>{})).rejects.toThrow('取消');
});

it('thought ID retries cannot silently bind the same text to a different anchor', async () => {
  await save('stable-id', 'same text');
  const elsewhere = { ...seed, locator: { ...seed.locator, rangeCfi: 'epubcfi(/6/2!/4,/2/1:6,/2/1:9)' } };
  const before = await repo.snapshot();
  await expect(repo.saveThought({ seed: elsewhere, id: 'stable-id', text: 'same text', mode: 'append' })).rejects.toThrow('另一窗口');
  expect(await repo.snapshot()).toEqual(before);
});
it('draft CAS preserves legacy data, rejects stale/cross-session/deleted writes, and rolls back failures', async () => {
  const legacy = { version: 1 as const, id: 'draft-cas', sessionId: 'session', seed, thoughtId: 'pending', mode: 'append' as const, text: 'legacy text', updatedAt: 1 };
  await db.annotationDrafts.add(legacy);
  const first = await repo.saveDraft({ ...legacy, text: 'first edit' }); expect(first.revision).toBe(1);
  await expect(repo.saveDraft({ ...legacy, text: 'stale edit' })).rejects.toThrow('另一窗口');
  await expect(repo.saveDraft({ ...first, sessionId: 'another', text: 'foreign edit' })).rejects.toThrow('另一窗口');
  vi.spyOn(db.annotationDrafts, 'put').mockRejectedValueOnce(new Error('failed write'));
  await expect(repo.saveDraft({ ...first, text: 'failed edit' })).rejects.toThrow('failed write');
  expect((await db.annotationDrafts.get(first.id))?.text).toBe('first edit');
  const second = await repo.saveDraft({ ...first, text: 'second edit' }); expect(second.revision).toBe(2);
  await repo.discardDraft(second.id);
  await expect(repo.saveDraft({ ...second, text: 'resurrection' })).rejects.toThrow('另一窗口');
  expect(await db.annotationDrafts.count()).toBe(0);
});

it('restore additions/numbering invalidate old undo, duplicate restore leaves parent CAS unchanged', async () => {
  const first = await save('deleted'); const token = await repo.removeThought(first.id, first.revision);
  const incoming = await backup(); const parent = incoming.annotations[0];
  incoming.thoughts = [{ ...first, id: 'restored', ordinal: 2 }]; parent.nextThoughtOrdinal = 3;
  await restoreBackup(parseBackup(JSON.stringify(incoming)), previewRestore(incoming, await repo.snapshot()), {}, repo);
  const restored = await repo.snapshot();
  expect(restored.annotations[0].revision).toBeGreaterThan(token.afterRevision!);
  expect(restored.annotations[0].nextThoughtOrdinal).toBe(3);
  await expect(repo.undo(token)).rejects.toThrow('另一窗口'); expect(await repo.snapshot()).toEqual(restored);
  const again = previewRestore(incoming, restored); expect(again.conflicts).toHaveLength(0);
  await restoreBackup(incoming, again, {}, repo); expect(await repo.snapshot()).toEqual(restored);
  expect((await save('later')).ordinal).toBe(3);
});
it('restoring an existing thought invalidates undo/parent CAS, restores times and remains idempotent', async () => {
  const removed = await save('removed'); await save('kept'); const token = await repo.removeThought(removed.id, removed.revision);
  const before = await repo.snapshot(); const incoming = await backup(); incoming.thoughts[0].createdAt = 1; incoming.thoughts[0].updatedAt = 2;
  const p = previewRestore(incoming, before); expect(p.conflicts.map(c => c.id)).toEqual(['kept']);
  await restoreBackup(incoming, p, { kept: 'incoming' }, repo);
  const after = await repo.snapshot(); expect(after.thoughts[0]).toMatchObject({ createdAt: 1, updatedAt: 2, ordinal: 2, annotationId: before.annotations[0].id, revision: 2 });
  expect(after.annotations[0].revision).toBeGreaterThan(before.annotations[0].revision);
  await expect(repo.undo(token)).rejects.toThrow('另一窗口');
  await expect(repo.change(seed, { title: 'stale' }, { id: before.annotations[0].id, revision: before.annotations[0].revision })).rejects.toThrow('另一窗口');
  const again = previewRestore(incoming, after); expect(again.conflicts).toHaveLength(0); await restoreBackup(incoming, again, {}, repo); expect(await repo.snapshot()).toEqual(after);
  incoming.annotations[0].title = 'real parent change';
  const changed = previewRestore(incoming, after); expect(changed.conflicts.map(c => c.id)).toEqual([incoming.annotations[0].id]);
  await expect(restoreBackup(incoming, changed, {}, repo)).rejects.toThrow('逐项选择');
  // Fingerprint still observes system timestamps, even though semantic equality ignores parent updatedAt.
  await db.annotations.update(after.annotations[0].id, { updatedAt: after.annotations[0].updatedAt + 1 });
  await expect(restoreBackup(incoming, changed, { [incoming.annotations[0].id]: 'incoming' }, repo)).rejects.toThrow('另一窗口');
});
it('restore rejects cross-table IDs in preview AND transaction recheck; full own export parses', async () => {
  await save('thought-id'); const state = await repo.snapshot(); const incoming = await backup();
  incoming.annotations[0].id = 'thought-id'; incoming.annotations[0].locator.rangeCfi = 'epubcfi(/6/2!/4,/2/1:6,/2/1:9)'; incoming.annotations[0].anchorKey = anchorKey(incoming.annotations[0]); incoming.thoughts = [];
  const checked = parseBackup(JSON.stringify(incoming)); expect(() => previewRestore(checked, state)).toThrow('跨表');
  await expect(restoreBackup(checked, { ...previewRestore(await backup(), state), fingerprint: JSON.stringify([state.annotations, state.thoughts]) }, {}, repo)).rejects.toThrow('跨表');
  const reverse = await backup(); reverse.thoughts[0].id = state.annotations[0].id; reverse.annotations[0].id = 'other-annotation'; reverse.thoughts[0].annotationId = 'other-annotation';
  expect(() => previewRestore(parseBackup(JSON.stringify(reverse)), state)).toThrow('跨表');
  expect(await repo.snapshot()).toEqual(state); expect(parseBackup(JSON.stringify(await backup())).thoughts).toHaveLength(1);
});
it.each(['constructor', '__proto__', 'toString'])('special conflict ID %s requires own valid choice', async id => {
  await save(id, 'local'); const incoming = await backup(); incoming.thoughts[0].text = 'incoming'; const p = previewRestore(incoming, await repo.snapshot()); const before = await repo.snapshot();
  for (const choices of [{}, Object.create({ [id]: 'incoming' }), { [id]: 'invalid' }]) {
    await expect(restoreBackup(incoming, p, choices, repo)).rejects.toThrow('逐项选择'); expect(await repo.snapshot()).toEqual(before);
  }
  await restoreBackup(incoming, p, { [id]: 'incoming' }, repo); expect((await db.thoughts.get(id))?.text).toBe('incoming');
});
it('restore enum validation rejects coercible arrays/objects/numbers rather than storing malformed labels', async () => {
  await save('one'); const incoming = await backup();
  for (const [field, value] of [['style','solid'], ['origin','thought'], ['color','#52735c'], ['highlightColor','yellow']]) {
    for (const malformed of [[value], { toString: value }, 1]) {
      const b = JSON.parse(JSON.stringify(incoming));
      if (field === 'highlightColor') b.annotations[0][field] = malformed; else b.annotations[0].line[field] = malformed;
      expect(() => parseBackup(JSON.stringify(b))).toThrow('颜色');
    }
  }
});
it('export and import share exact record limits and refuse unrecoverable files before progress', async () => {
  const { MAX_BACKUP_ANNOTATIONS, MAX_BACKUP_THOUGHTS, makeDownload } = await import('./noteTransfer');
  await save('one'); const b = await backup(); const a = b.annotations[0], t = b.thoughts[0];
  b.annotations = Array.from({ length: MAX_BACKUP_ANNOTATIONS }, (_, i) => {
    const rangeCfi = `epubcfi(/6/2!/4,/2/1:${i * 2},/2/1:${i * 2 + 1})`;
    return { ...a, id: `a${i}`, locator: { ...a.locator, rangeCfi }, anchorKey: `${a.bookId}|${rangeCfi}`, nextThoughtOrdinal: MAX_BACKUP_THOUGHTS + 1 };
  });
  b.thoughts = Array.from({ length: MAX_BACKUP_THOUGHTS }, (_, i) => ({ ...t, id: `t${i}`, annotationId: 'a0', ordinal: i + 1 }));
  // Minimal text/metadata keep both formats below the separate 20MB byte limit at the count boundary.
  b.annotations = b.annotations.map(a => ({ ...a, bookSnapshot: { title: '', author: '', fileName: '' }, quote: { exact: 'x', prefix: '', suffix: '' }, source: { tocPath: [], headingPath: [] } }));
  b.thoughts = b.thoughts.map(t => ({ ...t, text: 'x' }));
  for (const boundary of [{ ...b, thoughts: [] }, { ...b, annotations: b.annotations.slice(0, 1) }]) {
    const blob = await makeDownload(boundary, 'json', new AbortController().signal, () => {});
    const parsed = parseBackup(await blob.text());
    expect(parsed.annotations).toHaveLength(boundary.annotations.length);
    expect(parsed.thoughts).toHaveLength(boundary.thoughts.length);
  }
  for (const excess of [{ ...b, annotations: [...b.annotations, b.annotations[0]] }, { ...b, thoughts: [...b.thoughts, b.thoughts[0]] }]) {
    const progress = vi.fn(); await expect(makeDownload(excess, 'json', new AbortController().signal, progress)).rejects.toThrow('分批'); expect(progress).not.toHaveBeenCalled(); expect(() => parseBackup(JSON.stringify(excess))).toThrow('记录数');
  }
}, 20000);
it('numbering-only restore bumps parent once, stale incoming choices on duplicates cannot mutate it', async () => {
  await save('one'); const before = await repo.snapshot(); const b = await backup(); b.annotations[0].nextThoughtOrdinal += 5;
  const preview = previewRestore(b, before); expect(preview.conflicts).toHaveLength(0);
  await restoreBackup(b, preview, {}, repo); const after = await repo.snapshot(); expect(after.annotations[0].revision).toBe(before.annotations[0].revision + 1); expect(after.annotations[0].nextThoughtOrdinal).toBe(7);
  await restoreBackup(b, previewRestore(b, after), { [b.annotations[0].id]: 'incoming' }, repo); expect(await repo.snapshot()).toEqual(after);
});
