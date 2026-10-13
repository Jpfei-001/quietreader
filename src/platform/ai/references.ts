import type { AnnotationSeed } from '../annotationTypes';
import type { AiConversation, AiReference } from './types';
export function sameReference(a: AnnotationSeed, b: AnnotationSeed) { return a.bookId === b.bookId && a.locator.rangeCfi === b.locator.rangeCfi && a.quote.exact === b.quote.exact; }
/** Upgrade existing in-memory chats without discarding input/answers during development refresh. */
export function withReferences(conversation: AiConversation): AiConversation & { references: AiReference[]; activeReferenceId: string } {
  if (conversation.references?.length && conversation.activeReferenceId) return conversation as AiConversation & { references: AiReference[]; activeReferenceId: string };
  const references: AiReference[] = [];
  function append(seed: AnnotationSeed) {
    const last = references.at(-1);
    if (last && sameReference(last.seed, seed)) return last;
    const reference = { id: `${conversation.id}:reference-${references.length + 1}`, seed: structuredClone(seed) }; references.push(reference); return reference;
  }
  const messages = conversation.messages.map(message => { const reference = append(message.seed ?? conversation.seed); return { ...message, seed: message.seed ?? reference.seed, referenceId: reference.id }; });
  const current = append(conversation.seed);
  return { ...conversation, references, activeReferenceId: current.id, messages };
}
