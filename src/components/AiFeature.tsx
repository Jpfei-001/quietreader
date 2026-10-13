import { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from 'react';
import type { AnnotationSeed } from '../platform/annotationTypes';
import type { ReaderTheme } from '../reader/themes';
import { AiSessionStore } from '../platform/ai/sessionStore';
import { AiWindowCoordinator } from '../platform/ai/windowCoordinator';
import { aiError, type AiAction, type AiMessage } from '../platform/ai/types';
import AiQuestionContent from './AiQuestionContent';
import AiFloatingWindow from './AiFloatingWindow';
import '../ai.css';
export interface AiFeatureHandle { open(seed: AnnotationSeed): void }
export default function AiFeature({ ref, bookId, theme, onSettings, onSave }: { ref: Ref<AiFeatureHandle>; bookId?: string; theme: ReaderTheme; onSettings(): void; onSave(seed: AnnotationSeed, message: AiMessage, text: string, onSaved: () => void): void }) {
  const callbacks = useRef({ onSettings, onSave }); callbacks.current = { onSettings, onSave };
  const [store] = useState(() => new AiSessionStore());
  const managerRef = useRef<AiWindowCoordinator | undefined>(undefined);
  function action(a: AiAction) {
    const manager = managerRef.current;
    if (a.type === 'mode') { void manager?.switchMode(a.mode).catch(e => store.patch({ notice: aiError(e) })); return; }
    if (a.type === 'close') { void manager?.close(); return; }
    if (a.type === 'settings') { callbacks.current.onSettings(); return; }
    if (a.type === 'save') {
      const c = store.getSnapshot().conversation, message = c?.messages.find(m => m.id === a.id);
      if (c && message && !message.saved && message.status !== 'generating') callbacks.current.onSave(message.seed ?? c.seed, message, a.text, () => store.markSaved(message.id));
      return;
    }
    store.handle(a);
  }
  const [manager] = useState(() => new AiWindowCoordinator(store, action)); managerRef.current = manager;
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    // Keep an existing dev-session alive when this store module is replaced by Vite.
    if (import.meta.hot) { Object.setPrototypeOf(store, AiSessionStore.prototype); Object.setPrototypeOf(manager, AiWindowCoordinator.prototype); }
    store.upgradeReferences();
  }, [store, manager, AiSessionStore, AiWindowCoordinator]);
  useImperativeHandle(ref, () => ({ open: seed => { store.select(seed); void manager.open().catch(e => store.patch({ notice: aiError(e) })); } }), [store, manager]);
  useEffect(() => {
    let disposed = false, cleanup: (() => void) | undefined;
    void manager.attach().then(off => { if (disposed) off(); else cleanup = off; }).catch(e => store.patch({ notice: aiError(e) }));
    const unsubscribe = store.subscribe(() => manager.publish());
    const refresh = () => { void store.refreshConfiguration().catch(e => store.patch({ notice: aiError(e) })); };
    refresh(); window.addEventListener('quiet-ai-config-changed', refresh);
    return () => { disposed = true; cleanup?.(); unsubscribe(); window.removeEventListener('quiet-ai-config-changed', refresh); };
  }, [manager, store]);
  useEffect(() => { store.setBook(bookId); if (!bookId) void manager.close(); }, [bookId, manager, store]);
  useEffect(() => store.patch({ theme }), [theme, store]);
  if (!state.open || state.activeMode === 'detached') return null;
  return <div className={`ai-layer theme-${state.theme}`}>
    {state.activeMode === 'floating' ? <AiFloatingWindow state={state} action={action} /> : <aside className="ai-expanded-panel"><AiQuestionContent state={state} action={action} /></aside>}
  </div>;
}
