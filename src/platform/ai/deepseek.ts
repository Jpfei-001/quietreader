import { invokeAi, tauriBridge } from './bridge';
import { httpError, type AiChunk, type WireMessage } from './types';
import { browserCredential, browserCredentialInfo, loadBrowserCredential, saveBrowserCredential, setBrowserCredentialPersistence, clearBrowserCredential } from './browserCredential';
const API = 'https://api.deepseek.com';

export async function credentialStatus(): Promise<boolean> { if (tauriBridge()) return invokeAi<boolean>('ai_key_status'); await loadBrowserCredential(); return !!browserCredential(); }
export async function credentialInfo(): Promise<{ configured: boolean; remembered: boolean }> { return tauriBridge() ? invokeAi('ai_key_info') : browserCredentialInfo(); }
export async function setCredentialPersistence(remember: boolean) { if (tauriBridge()) await invokeAi('ai_set_persistence', { remember }); else await setBrowserCredentialPersistence(remember); }
export async function setCredential(key: string, remember: boolean) {
  if (!/^\S{8,512}$/.test(key)) throw new Error('请输入有效的 API Key，不应含空白字符。');
  if (tauriBridge()) await invokeAi('ai_set_key', { key, remember }); else await saveBrowserCredential(key, remember);
}
export async function clearCredential() { if (tauriBridge()) await invokeAi('ai_clear_key'); else await clearBrowserCredential(); }
async function request(path: string, body?: unknown, signal?: AbortSignal, key?: string) {
  if (!key) { await loadBrowserCredential(); key = browserCredential(); }
  if (!key) throw new Error('请先在设置中填写 API Key。');
  const response = await fetch(`${API}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal, redirect: 'error' });
  if (!response.ok) throw httpError(response.status);
  return response;
}
export async function listModels(key?: string): Promise<string[]> {
  if (tauriBridge()) return invokeAi<string[]>('ai_models', { key: key || null });
  const timeout = AbortSignal.timeout(20000);
  const value = await (await request('/models', undefined, timeout, key || browserCredential())).json();
  if (!Array.isArray(value.data)) throw new Error('服务返回的模型列表格式异常。');
  const models = value.data.map((m: { id?: unknown }) => m.id).filter((id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9._:/-]{1,100}$/.test(id));
  if (!models.length) throw new Error('当前账户没有可用模型。');
  return [...new Set<string>(models)];
}
export async function testConnection(model: string, key?: string): Promise<number> {
  const start = performance.now();
  if (tauriBridge()) { await invokeAi('ai_test', { model, key: key || null }); return Math.round(performance.now() - start); }
  const response = await request('/chat/completions', { model, messages: [{ role: 'user', content: '只回答：连接成功' }], stream: false, thinking: { type: 'disabled' }, max_tokens: 64 }, AbortSignal.timeout(30000), key || browserCredential());
  const data = await response.json();
  if (typeof data.choices?.[0]?.message?.content !== 'string' || !data.choices[0].message.content.trim()) throw new Error('模型没有返回有效正式回答，请换模型后测试。');
  return Math.round(performance.now() - start);
}
/** Stateful SSE parser: complete lines only, CRLF/multiline data and chunk boundaries supported. */
export class SseParser {
  private buffer = ''; private data: string[] = [];
  push(text: string): string[] {
    this.buffer += text;
    const result: string[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).replace(/\r$/, ''); this.buffer = this.buffer.slice(end + 1);
      if (!line) { if (this.data.length) result.push(this.data.join('\n')); this.data = []; }
      else if (line.startsWith('data:')) this.data.push(line.slice(5).replace(/^ /, ''));
    }
    if (this.buffer.length > 1024 * 1024 || this.data.join('').length > 1024 * 1024) throw new Error('服务返回的流式事件过大。');
    return result;
  }
}
export async function askAi(requestId: string, model: string, messages: WireMessage[], signal: AbortSignal, onChunk: (chunk: AiChunk) => void): Promise<void> {
  const native = tauriBridge();
  if (native) {
    await new Promise<void>((resolve, reject) => {
      let off: (() => void) | undefined, settled = false;
      const finish = (error?: Error) => { if (settled) return; settled = true; off?.(); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
      const abort = () => { void invokeAi('ai_cancel', { requestId }).catch(() => {}); finish(new DOMException('已取消', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      void native.event.listen<AiChunk & { requestId: string }>('quiet-ai-stream', ({ payload }) => {
        if (settled || payload.requestId !== requestId) return;
        if (payload.error) { finish(new Error(payload.error)); return; }
        onChunk(payload); if (payload.done) finish();
      }).then(unlisten => {
        off = unlisten;
        if (settled || signal.aborted) { unlisten(); abort(); return; }
        return invokeAi('ai_chat', { requestId, model, messages }).catch(e => finish(new Error(typeof e === 'string' ? e : 'AI 请求失败，请重试。')));
      }).catch(() => finish(new Error('无法建立桌面 AI 事件连接。')));
    });
    return;
  }
  const response = await request('/chat/completions', { model, messages, stream: true, thinking: { type: 'disabled' }, max_tokens: 2048 }, signal);
  if (!response.body) throw new Error('浏览器不支持流式响应，请使用桌面版。');
  const reader = response.body.getReader(), decoder = new TextDecoder(), parser = new SseParser();
  let reason = '', received = false, done = false, thinkingReported = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      for (const data of parser.push(decoder.decode(chunk.value, { stream: true }))) {
        if (data === '[DONE]') { done = true; break; }
        let value: { choices?: { delta?: { content?: string; reasoning_content?: string }; finish_reason?: string }[]; error?: unknown };
        try { value = JSON.parse(data); } catch { throw new Error('服务返回的流式格式异常。'); }
        if (value.error) throw new Error('AI 服务返回错误，请手动重试。');
        const choice = value.choices?.[0];
        if (choice?.finish_reason) reason = choice.finish_reason;
        if (choice?.delta?.reasoning_content && !thinkingReported) { thinkingReported = true; onChunk({ thinking: true }); }
        if (typeof choice?.delta?.content === 'string') { received = true; onChunk({ text: choice.delta.content }); }
      }
      if (done) break;
    }
    if (!received) throw new Error('模型没有返回正式回答。');
    if (!done && !reason) throw new Error('连接中断，回答可能未完成。');
    onChunk({ done: true, incomplete: reason !== 'stop' });
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
