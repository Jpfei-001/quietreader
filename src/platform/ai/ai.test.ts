import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AnnotationSeed } from '../annotationTypes';
import { normalizeAiPreferences, saveAiPreferences } from './settings';
import { browserCredential, setBrowserCredential } from './browserCredential';
import { SseParser } from './deepseek';
import { AiSessionStore, buildMessages } from './sessionStore';
import { validAiAction } from './windowCoordinator';
import type { AiChunk, AiConversation } from './types';
const mocks = vi.hoisted(() => ({ ask: vi.fn(), configured: vi.fn().mockResolvedValue(true) }));
vi.mock('./deepseek', async original => ({ ...await original<typeof import('./deepseek')>(), askAi: mocks.ask, credentialStatus: mocks.configured }));
const seed: AnnotationSeed = { bookId: 'book-1', bookSnapshot: { title: '示例', author: '作者', fileName: 'example.epub' }, locator: { rangeCfi: 'epubcfi(/6/2!/4/2)', href: 'chapter.xhtml', spineIndex: 0 }, quote: { exact: '认知失调', prefix: '', suffix: '' }, source: { tocPath: ['第一章'], headingPath: [] } };
let storage: Map<string, string>;
beforeEach(() => { storage = new Map(); vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }); mocks.ask.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); });
describe('AI 配置与消息安全', () => {
  it('仅保存非敏感字段，不迁移或覆盖阅读设置', () => {
    storage.set('reader-preferences', 'untouched');
    saveAiPreferences({ version: 1, model: 'deepseek-chat', preferredMode: 'detached', apiKey: 'sk-secret' } as never);
    expect([...storage.values()].join('')).not.toContain('sk-secret'); expect(storage.get('reader-preferences')).toBe('untouched');
    expect(normalizeAiPreferences(null).preferredMode).toBe('expanded'); expect(normalizeAiPreferences({ model: '../ bad', preferredMode: 'popover' })).toEqual({ version: 1, model: 'deepseek-chat', preferredMode: 'expanded' });
  });
  it('只发送明确引用、当前问题与最近完整历史，不发送其他笔记或整本书', () => {
    const c: AiConversation = { id: '1', seed, input: '', scrollTop: 0, messages: Array.from({ length: 5 }, (_, i) => ({ id: String(i), question: `问题${i}`, answer: `回答${i}`, model: 'deepseek-chat', status: 'complete', thoughtId: String(i) })) };
    const output = buildMessages(c, '举例'); expect(output.omitted).toBe(true); expect(output.messages.at(-1)?.content).toBe('举例'); expect(output.messages.some(m => m.content === '回答0')).toBe(false); expect(output.messages.at(-2)?.content).toContain('认知失调'); expect(() => buildMessages(c, 'a'.repeat(4001))).toThrow();
  });
  it('浏览器未记住的密钥仅页面内存，模块更新不丢失，刷新不恢复', async () => {
    vi.stubGlobal('window', {}); setBrowserCredential('sk-hot-update-test'); expect(browserCredential()).toBe('sk-hot-update-test'); expect(JSON.stringify(window)).not.toContain('sk-hot');
    vi.resetModules(); const fresh = await import('./browserCredential'); expect(fresh.browserCredential()).toBe('sk-hot-update-test');
    vi.stubGlobal('window', {}); expect(fresh.browserCredential()).toBe(''); expect([...storage.values()].join('')).not.toContain('sk-hot');
  });
  it('拒绝不合法跨窗口动作', () => { expect(validAiAction({ type: 'mode', mode: 'popover' })).toBe(false); expect(validAiAction({ type: 'input', text: 'a'.repeat(4001) })).toBe(false); expect(validAiAction({ type: 'save', id: '1', text: 'short' })).toBe(true); expect(validAiAction({ type: 'delete-book' })).toBe(false); });
});
describe('流式与会话', () => {
  it('处理任意文本分块、CRLF、多行 data 与结束标志', () => { const parser = new SseParser(); const output: string[] = []; for (const char of 'data: {"content":"中文"}\r\n\r\ndata: [DONE]\n\n') output.push(...parser.push(char)); expect(output).toEqual(['{"content":"中文"}', '[DONE]']); expect(new SseParser().push('data: a\ndata: b\n\n')).toEqual(['a\nb']); });
  it('选文快照不随原对象变化；未配置不请求，已配置直接发送无需额外确认', async () => { mocks.ask.mockImplementation(async (_id, _model, _messages, _signal, callback) => { callback({ text: '解释' }); callback({ done: true }); }); const s = new AiSessionStore(); s.setBook(seed.bookId); const selection = structuredClone(seed); s.select(selection); selection.quote.exact = '改变'; await s.send('解释'); expect(mocks.ask).not.toHaveBeenCalled(); s.patch({ configured: true }); await s.send('解释'); expect(mocks.ask).toHaveBeenCalledTimes(1); expect(s.getSnapshot().conversation?.references?.[0].seed.quote.exact).toBe('认知失调'); });
  it('切换形态不重发请求；停止与换书忽略迟到内容', async () => {
    let emit: (chunk: AiChunk) => void = () => {}, finish: () => void = () => {};
    mocks.ask.mockImplementation((_id, _model, _messages, _signal, callback) => { emit = callback; return new Promise<void>(resolve => { finish = resolve; }); });
    const s = new AiSessionStore(); s.setBook(seed.bookId); s.select(seed); s.patch({ configured: true }); 
    const sending = s.send('解释'); emit({ text: '先收到的内容' }); s.patch({ activeMode: 'detached' }); expect(mocks.ask).toHaveBeenCalledTimes(1); expect(s.getSnapshot().conversation?.messages[0].answer).toBe('先收到的内容');
    s.setBook('book-2'); emit({ text: '迟到文本' }); finish(); await sending; expect(s.getSnapshot().conversation).toBeUndefined(); s.setBook('book-1'); expect(s.getSnapshot().conversation).toBeUndefined();
  });
  it('新选文直接更新当前对话；旧回答保留原选文；关闭后下次创建新会话', async () => {
    mocks.ask.mockImplementation(async (_id, _model, _messages, _signal, callback) => { callback({ text: '原选文回答' }); callback({ done: true }); });
    const s = new AiSessionStore(); s.setBook(seed.bookId); s.select(seed); s.patch({ configured: true }); await s.send('解释原引用'); const id = s.getSnapshot().conversation!.id;
    const next = structuredClone(seed); next.locator.rangeCfi += ':next'; next.quote.exact = '新选文'; s.select(next);
    const c = s.getSnapshot().conversation!; expect(c.id).toBe(id); expect(c.seed.quote.exact).toBe('新选文'); expect(c.messages[0].seed?.quote.exact).toBe('认知失调'); expect(c.references?.map(r => r.seed.quote.exact)).toEqual(['认知失调', '新选文']); expect(c.messages[0].referenceId).toBe(c.references?.[0].id); expect(buildMessages(c, '解释新选文').messages[1].content).toContain('认知失调');
    s.endConversation(); expect(s.getSnapshot().conversation).toBeUndefined(); expect(s.getSnapshot().configured).toBe(true); s.select(next); expect(s.getSnapshot().conversation!.id).not.toBe(id); expect(s.getSnapshot().conversation!.messages).toHaveLength(0);
  });
  it('引用独立追加，重复当前选文不重复添加；未提问的引用也可用于比较', () => {
    const s = new AiSessionStore(); s.setBook(seed.bookId); s.select(seed); s.select(seed); const next = structuredClone(seed); next.locator.rangeCfi += ':next'; next.quote.exact = '第二段引用'; s.select(next); s.select(next); expect(s.getSnapshot().conversation?.references).toHaveLength(2); expect(mocks.ask).not.toHaveBeenCalled();
    const wire = buildMessages(s.getSnapshot().conversation!, '比较这两段'); expect(wire.messages.map(m => m.content).join('')).toContain('认知失调'); expect(wire.messages.map(m => m.content).join('')).toContain('第二段引用');
    s.select(seed); expect(s.getSnapshot().conversation?.references?.map(r => r.seed.quote.exact)).toEqual(['认知失调', '第二段引用', '认知失调']);
  });
  it('追加引用不取消正在生成的原回答，不重复请求，结果仍关联原引用', async () => {
    let emit: (chunk: AiChunk) => void = () => {}, finish: () => void = () => {};
    mocks.ask.mockImplementation((_id, _model, _messages, _signal, callback) => { emit = callback; return new Promise<void>(resolve => { finish = resolve; }); });
    const s = new AiSessionStore(); s.setBook(seed.bookId); s.select(seed); s.patch({ configured: true }); const sending = s.send('解释原文');
    const next = structuredClone(seed); next.locator.rangeCfi += ':second'; next.quote.exact = '第二段'; s.select(next); expect(s.getSnapshot().generating).toBe(true); expect(mocks.ask).toHaveBeenCalledTimes(1);
    emit({ text: '原文回答' }); emit({ done: true }); finish(); await sending; const c = s.getSnapshot().conversation!; expect(c.messages[0].answer).toBe('原文回答'); expect(c.messages[0].referenceId).toBe(c.references?.[0].id); expect(c.activeReferenceId).toBe(c.references?.[1].id);
  });
  it('首字即时显示，后续碎片合并，结束不丢字且记录耗时', async () => {
    vi.useFakeTimers();
    try {
      let emit: (chunk: AiChunk) => void = () => {}, finish: () => void = () => {};
      mocks.ask.mockImplementation((_id, _model, _messages, _signal, callback) => { emit = callback; return new Promise<void>(resolve => { finish = resolve; }); });
      const s = new AiSessionStore(); s.setBook(seed.bookId); s.select(seed); s.patch({ configured: true }); const sending = s.send('解释'); emit({ thinking: true }); expect(s.getSnapshot().conversation!.messages[0].thinking).toBe(true);
      emit({ text: '首' }); const version = s.getSnapshot().version; for (const text of '字立即显示') emit({ text }); expect(s.getSnapshot().version).toBe(version); emit({ done: true }); finish(); await sending;
      const m = s.getSnapshot().conversation!.messages[0]; expect(m.answer).toBe('首字立即显示'); expect(m.firstTokenMs).toBeGreaterThanOrEqual(0); expect(m.elapsedMs).toBeGreaterThanOrEqual(m.firstTokenMs!); expect(m.status).toBe('complete');
    } finally { vi.useRealTimers(); }
  });
  it('保存默认模型之后只影响下一次请求，历史来源保持原模型', async () => {
    mocks.ask.mockImplementation(async (_id, _model, _messages, _signal, callback) => { callback({ text: '解释' }); callback({ done: true }); });
    const s = new AiSessionStore(); s.setBook(seed.bookId); s.select(seed); s.patch({ configured: true }); await s.send('第一问');
    saveAiPreferences({ version: 1, model: 'new-model', preferredMode: 'floating' }); await s.refreshConfiguration(); await s.send('第二问'); expect(s.getSnapshot().conversation?.messages.map(m => m.model)).toEqual(['deepseek-chat', 'new-model']);
  });
});
