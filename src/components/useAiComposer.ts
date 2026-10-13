import { useEffect, useRef, useState } from 'react';
import type { AiAction, AiConversation } from '../platform/ai/types';
/** Local editing must never be replaced by a delayed cross-window echo, especially during IME. */
export function useAiComposer(conversation: AiConversation | undefined, action: (value: AiAction) => void) {
  const [draft, setDraft] = useState(conversation?.input ?? '');
  const value = useRef(draft); value.current = draft;
  const session = useRef(conversation?.id);
  const pending = useRef<string | undefined>(undefined);
  const composing = useRef(false), compositionEndedAt = useRef(-Infinity);
  const sent = useRef<{ question: string; draft: string; previous?: string } | undefined>(undefined);
  const last = conversation?.messages.at(-1);
  function edit(text: string) { value.current = text; setDraft(text); pending.current = text; action({ type: 'input', text }); }
  useEffect(() => {
    if (session.current !== conversation?.id) {
      session.current = conversation?.id; pending.current = undefined; composing.current = false; sent.current = undefined;
      value.current = conversation?.input ?? ''; setDraft(value.current); return;
    }
    if (!conversation || composing.current) return;
    if (sent.current && last && last.id !== sent.current.previous && last.question === sent.current.question) {
      // Clear only the text actually sent; preserve anything the user typed while awaiting acknowledgement.
      const unchanged = value.current === sent.current.draft; sent.current = undefined;
      if (unchanged) { pending.current = undefined; value.current = ''; setDraft(''); return; }
    }
    if (conversation.input === value.current) { pending.current = undefined; return; }
    if (pending.current !== undefined) return;
    value.current = conversation.input; setDraft(conversation.input);
  }, [conversation?.id, conversation?.input, last?.id, last?.question]);
  function send(question = value.current) {
    if (composing.current) return;
    sent.current = { question: question.trim(), draft: value.current, previous: last?.id };
    action({ type: 'send', text: question });
  }
  return { draft, edit, send,
    compositionStart() { composing.current = true; },
    compositionEnd(text: string) { composing.current = false; compositionEndedAt.current = performance.now(); edit(text); },
    isImeConfirm(event: { isComposing?: boolean; keyCode?: number }) { return composing.current || event.isComposing || event.keyCode === 229 || performance.now() - compositionEndedAt.current < 100; },
  };
}
