import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { sourceLabel } from '../platform/annotationTypes';
import { buildMessages } from '../platform/ai/sessionStore';
import { withReferences } from '../platform/ai/references';
import { PRIVACY_FULL, type AiAction, type AiMessage, type AiReference, type AiState } from '../platform/ai/types';
import { tauriBridge } from '../platform/ai/bridge';
import { useAiComposer } from './useAiComposer';
const paths = { copy: <><rect x="4" y="8" width="12" height="13" rx="3" /><path d="M9 8V6a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-1" /></>, save: <><path d="M6 4h12v17l-6-4-6 4V4Z" /><path d="M9 9h6m-3-3v6" /></>, send: <path d="m14 4 7 6-7 6v-4c-5 0-8 2-11 7 1-8 4-11 11-11V4Z" />, close: <path d="m6 6 12 12M18 6 6 18" />, collapse: <path d="M5 12h14" />, stop: <rect x="6" y="6" width="12" height="12" rx="2" />, retry: <><path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6" /></> };
export function AiIconButton({ icon, label, onClick, disabled }: { icon: keyof typeof paths; label: string; onClick(): void; disabled?: boolean }) { return <button type="button" className="ai-icon" title={label} aria-label={label} onClick={onClick} disabled={disabled}><svg viewBox="0 0 24 24" aria-hidden="true">{paths[icon]}</svg></button>; }
function inline(text: string): ReactNode[] { return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part); }
/** Safe Markdown subset. React escapes HTML; images/remote content are never fetched. */
export function AiAnswer({ text }: { text: string }) { return <div className="ai-answer-text">{text.split('```').map((part, i) => i % 2 ? <pre key={i}>{part.replace(/^[a-zA-Z]+\n/, '')}</pre> : part.split('\n').map((line, j) => line.trim() ? <p key={`${i}-${j}`}>{inline(line.replace(/^#{1,6}\s+/, ''))}</p> : null))}</div>; }
function ReferenceQuote({ reference, number, active }: { reference: AiReference; number: number; active: boolean }) {
  const [open, setOpen] = useState(true), seed = reference.seed;
  return <div className="ai-quote" role="group" aria-label={`引用 ${number}`}><div><span>引用 {number} · 原文{active ? ' · 当前提问' : ''}</span><button onClick={() => setOpen(!open)} aria-label={`${open ? '收起' : '展开'}引用 ${number}`} aria-expanded={open}>{open ? '收起 ⌃' : '展开 ⌄'}</button></div>{open && <><p>{seed.quote.exact}</p><small>《{seed.bookSnapshot.title}》· {sourceLabel(seed)}</small></>}</div>;
}
function MessageTurn({ message, generating, action, copy }: { message: AiMessage; generating: boolean; action(action: AiAction): void; copy(text: string): Promise<void> }) {
  return <article className="ai-turn" data-message-id={message.id}>
    <div className="ai-message-label"><span className="ai-avatar">你</span><span>你的问题</span><AiIconButton icon="copy" label="复制问题" onClick={() => void copy(message.question)} /></div><div className="ai-user-message">{message.question}</div>
    <div className="ai-message-label"><span className="ai-avatar ai-avatar-assistant">AI</span><span>AI 回答</span></div><div className="ai-answer"><AiAnswer text={message.answer} />{message.status === 'generating' && <p role="status">{message.answer ? '正在生成…' : message.thinking ? '模型正在思考，等待正式回答…' : '正在等待正式回答…'}</p>}{message.error && <p role="alert">{message.error}</p>}<div className="ai-answer-actions"><AiIconButton icon="copy" label="复制回答" disabled={!message.answer} onClick={() => void copy(message.answer)} /><AiIconButton icon="save" label={message.saved ? '已保存为思考' : '保存为思考'} disabled={!message.answer || message.status === 'generating' || !!message.saved} onClick={() => action({ type: 'save', id: message.id, text: `问题：${message.question}\n\nAI 回答：${message.answer}\n\n来源：DeepSeek · ${message.model}${message.status !== 'complete' ? '\n回答未完成' : ''}\nAI 辅助生成，请核实重要信息。` })} /><small title={`本次实际模型：${message.model}${message.firstTokenMs === undefined ? '' : ` · 首字等待 ${(message.firstTokenMs / 1000).toFixed(1)} 秒`}${message.elapsedMs === undefined ? '' : ` · 总耗时 ${(message.elapsedMs / 1000).toFixed(1)} 秒`}`}>{message.model} · {message.status === 'complete' ? '已完成' : message.status === 'generating' ? '生成中' : '未完成'}</small>{(message.status === 'error' || message.status === 'stopped') && <AiIconButton icon="retry" label="重试此问题（可能再次计费）" disabled={generating} onClick={() => action({ type: 'retry', id: message.id })} />}</div></div>
  </article>;
}
export default function AiQuestionContent({ state, action, onCollapse, onReset }: { state: AiState; action(action: AiAction): void; onCollapse?(): void; onReset?(): void }) {
  const shortcutId = useId();
  const [inspect, setInspect] = useState(false), [feedback, setFeedback] = useState('');
  const messagesRef = useRef<HTMLDivElement>(null), bottom = useRef(true), [newContent, setNewContent] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null), conversation = state.conversation ? withReferences(state.conversation) : undefined;
  const composer = useAiComposer(conversation, action), references = conversation?.references ?? [], previousCount = useRef(references.length);
  useEffect(() => { inputRef.current?.focus(); const el = messagesRef.current; if (el) { el.scrollTop = conversation?.scrollTop ?? 0; bottom.current = !conversation?.messages.length || el.scrollHeight - el.scrollTop - el.clientHeight < 45; } }, [conversation?.id]);
  useEffect(() => { const input = inputRef.current; if (input) { input.style.height = '64px'; input.style.height = `${Math.min(110, Math.max(64, input.scrollHeight))}px`; } }, [composer.draft]);
  useEffect(() => { if (references.length > previousCount.current) { bottom.current = true; setNewContent(false); if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight; inputRef.current?.focus(); } previousCount.current = references.length; }, [references.length]);
  const lastAnswer = conversation?.messages.at(-1)?.answer;
  useEffect(() => { const el = messagesRef.current; if (!el) return; if (bottom.current) el.scrollTop = el.scrollHeight; else setNewContent(true); }, [lastAnswer, conversation?.messages.length]);
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); setFeedback('已复制。'); } catch { setFeedback('剪贴板不可用，请手动选择文字复制。'); } }
  let outgoing = '';
  if (inspect && conversation) { try { const built = buildMessages(conversation, composer.draft || '（待输入问题）'); outgoing = built.messages.map(m => `${m.role}: ${m.content}`).join('\n\n'); } catch { outgoing = '选文或问题超过上限，请缩短后发送。'; } }
  const activeNumber = references.findIndex(r => r.id === conversation?.activeReferenceId) + 1;
  return <section className="ai-question" data-ai-ui data-note-guarded role="region" aria-label="AI 阅读助手" onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (inspect) setInspect(false); else action({ type: 'close' }); } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.stopPropagation(); }}>
    <header className="ai-heading" data-ai-drag><h2>✧ AI 阅读助手</h2><div className="ai-heading-actions"><label>模式<select aria-label="助手呈现模式" value={state.activeMode} disabled={state.switching} onChange={e => action({ type: 'mode', mode: e.target.value as AiState['activeMode'] })}><option value="expanded" disabled={!tauriBridge()}>向右扩展</option><option value="detached">独立窗口</option><option value="floating">悬浮窗</option></select></label>{onReset && <button className="ai-reset-position" title="重置位置与大小" aria-label="重置悬浮窗位置与大小" onClick={onReset}>↺</button>}{onCollapse && <AiIconButton icon="collapse" label="收起悬浮窗" onClick={onCollapse} />}<AiIconButton icon="close" label="关闭 AI 助手" onClick={() => action({ type: 'close' })} /></div></header>
    {state.switching && <p className="ai-inline-notice" role="status">正在切换模式，问答继续保留…</p>}
    {state.notice && <p className="ai-inline-notice" role="status">{state.notice}</p>}
    <div className="ai-messages" ref={messagesRef} onScroll={e => { const el = e.currentTarget; bottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 45; if (bottom.current) setNewContent(false); if (conversation && Math.abs(el.scrollTop - conversation.scrollTop) > 1) action({ type: 'scroll', value: el.scrollTop }); }}>
      {!conversation ? <p className="ai-empty">在原文中选中术语或段落，再点击“问 AI”。</p> : <>
        {!state.configured && <div className="ai-inline-notice">请先配置自己的 API Key。<button onClick={() => action({ type: 'settings' })}>前往设置</button></div>}
        {references.map((reference, index) => <section className="ai-reference-group" data-reference-id={reference.id} key={reference.id}>
          <ReferenceQuote reference={reference} number={index + 1} active={reference.id === conversation.activeReferenceId} />
          {reference.id === conversation.activeReferenceId && <div className="ai-quick">{['解释术语', '通俗解读', '举例说明'].map(text => <button key={text} disabled={state.generating || !state.configured} onClick={() => composer.send(text)}>{text}</button>)}</div>}
          {conversation.messages.filter(m => (m.referenceId ?? references[0].id) === reference.id).map(message => <MessageTurn key={message.id} message={message} generating={state.generating} action={action} copy={copy} />)}
        </section>)}
      </>}
    </div>
    {newContent && <button className="ai-new-content" onClick={() => { bottom.current = true; setNewContent(false); if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight; }}>查看新内容 ↓</button>}
    {feedback && <p className="ai-inline-notice" role="status">{feedback}<button onClick={() => setFeedback('')}>×</button></p>}
    <div className="ai-composer"><div className="ai-composer-top"><span>继续提问{activeNumber > 0 ? ` · 引用 ${activeNumber}` : ''}</span><div className="ai-composer-tools"><button onClick={() => setInspect(!inspect)} aria-expanded={inspect}>查看发送内容</button>{state.generating && <AiIconButton icon="stop" label="停止生成" onClick={() => action({ type: 'stop' })} />}</div></div>{inspect && <pre className="ai-outgoing" tabIndex={0}>{outgoing}</pre>}<div className="ai-input-box"><textarea ref={inputRef} aria-label="向 AI 提问" aria-describedby={shortcutId} enterKeyHint="send" placeholder="还想了解什么？" value={composer.draft} disabled={!conversation} maxLength={4000} onChange={e => composer.edit(e.target.value)} onCompositionStart={composer.compositionStart} onCompositionEnd={e => composer.compositionEnd(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Escape' && !composer.isImeConfirm(e.nativeEvent)) return; e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !composer.isImeConfirm(e.nativeEvent)) { e.preventDefault(); if (!state.generating) composer.send(); } }} /></div><div className="ai-composer-footer"><small id={shortcutId}>Enter 发送 · Shift + Enter 换行</small><p className="ai-privacy" tabIndex={0} aria-label={PRIVACY_FULL}><span>API 计费 · 回答请核实</span><span className="ai-privacy-full" aria-hidden="true">{PRIVACY_FULL}</span></p></div></div>
  </section>;
}
