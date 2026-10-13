import type { AnnotationSeed } from '../annotationTypes';
import type { ReaderTheme } from '../../reader/themes';
export type AiMode = 'expanded' | 'detached' | 'floating';
export interface AiPreferences { version: 1; model: string; preferredMode: AiMode }
export const DEFAULT_AI_PREFERENCES: AiPreferences = { version: 1, model: 'deepseek-chat', preferredMode: 'expanded' };
export interface AiMessage { id: string; question: string; answer: string; model: string; status: 'generating' | 'complete' | 'stopped' | 'error'; error?: string; saved?: boolean; thoughtId: string; seed?: AnnotationSeed; referenceId?: string; thinking?: boolean; firstTokenMs?: number; elapsedMs?: number }
export interface AiReference { id: string; seed: AnnotationSeed }
export interface AiConversation { id: string; seed: AnnotationSeed; input: string; messages: AiMessage[]; references?: AiReference[]; activeReferenceId?: string; scrollTop: number }
export interface AiState { version: number; open: boolean; activeMode: AiMode; preferredMode: AiMode; model: string; configured: boolean; switching: boolean; generating: boolean; notice: string; theme: ReaderTheme; conversation?: AiConversation;  }
export interface WireMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface AiChunk { text?: string; done?: boolean; incomplete?: boolean; error?: string; thinking?: boolean }
export type AiAction = { type: 'input'; text: string } | { type: 'send'; text?: string } | { type: 'stop' | 'close' | 'settings' | 'snapshot' } | { type: 'mode'; mode: AiMode } | { type: 'scroll'; value: number } | { type: 'save'; id: string; text: string } | { type: 'retry'; id: string };
export const PRIVACY_FULL = '按 Enter 或点击快捷提问，将相关选文、问题及必要会话历史发送至 DeepSeek。由你的 API 账户计费 · AI 回答可能有误，请核实。';
export function aiError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return '已停止生成，收到的内容仍保留。';
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // Never display arbitrary upstream bodies, headers or credentials.
  return /^[\u3400-\u9fff]/.test(text) && !/sk-|Bearer|https?:/i.test(text) ? text.slice(0, 200) : '网络异常或跨域限制，请检查网络；网页版不能直连时请使用桌面版。';
}
export function httpError(status: number): Error {
  return new Error(({ 401: '密钥无效，请在设置中重新填写。', 403: '当前密钥没有调用权限。', 402: 'API 余额不足，请前往平台检查账户。', 429: '请求过于频繁，请稍后手动重试。', 404: '所选模型不可用，请在设置中刷新模型。', 400: '请求参数或模型不兼容，请检查设置。' } as Record<number, string>)[status] ?? 'AI 服务暂时不可用，请稍后手动重试。');
}
