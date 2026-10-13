import { useEffect, useState } from 'react';
import { tauriBridge } from '../platform/ai/bridge';
import { AI_ACTION_EVENT, AI_STATE_EVENT } from '../platform/ai/windowCoordinator';
import type { AiAction, AiState } from '../platform/ai/types';
import AiQuestionContent from './AiQuestionContent';
import DesktopTitleBar from './DesktopTitleBar';
import { getDesktopWindow } from '../platform/desktop';
import '../ai.css';
export default function AiDetachedPage() {
  const [state, setState] = useState<AiState>();
  const [desktop] = useState(getDesktopWindow), [windowError, setWindowError] = useState('');
  const [channel, setChannel] = useState<BroadcastChannel>();
  useEffect(() => {
    let disposed = false; const cleanup: (() => void)[] = [];
    const native = tauriBridge();
    const receive = (value: AiState) => { if (!disposed && value && typeof value.version === 'number') setState(current => !current || value.version >= current.version ? value : current); };
    if (native) {
      void (async () => {
        const off = await native.event.listen<AiState>(AI_STATE_EVENT, e => receive(e.payload));
        if (disposed) { off(); return; } cleanup.push(off);
        const ping = await native.event.listen('quiet-ai-ping', () => { void native.event.emitTo('main', AI_ACTION_EVENT, { type: 'snapshot' }); });
        if (disposed) { ping(); return; } cleanup.push(ping);
        await native.event.emitTo('main', AI_ACTION_EVENT, { type: 'snapshot' });
      })().catch(() => {});
    } else {
      const id = new URLSearchParams(location.search).get('channel');
      if (!id || !/^[a-f0-9-]{36}$/.test(id) || typeof BroadcastChannel === 'undefined') return;
      const c = new BroadcastChannel(`quiet-ai-${id}`); setChannel(c);
      c.onmessage = e => { if (e.data?.type === 'state') receive(e.data.state); else if (e.data?.type === 'ping') c.postMessage({ type: 'snapshot' }); };
      c.postMessage({ type: 'snapshot' }); cleanup.push(() => c.close());
    }
    return () => { disposed = true; cleanup.forEach(fn => fn()); };
  }, []);
  function action(a: AiAction) { const native = tauriBridge(); if (native) void native.event.emitTo('main', AI_ACTION_EVENT, a).catch(() => {}); else channel?.postMessage(a); }
  return <div className={`app ai-detached-page theme-${state?.theme ?? 'light'}${desktop ? ' is-desktop-app' : ''}`}>
    {desktop && <DesktopTitleBar native={desktop} theme={state?.theme ?? 'light'} title="静读 · AI 阅读助手" guard={run => run()} closeAction={() => action({ type: 'close' })} onError={setWindowError} />}
    <div className="ai-detached-body">{windowError && <p className="ai-inline-notice" role="status">{windowError}</p>}{state ? <AiQuestionContent state={{ ...state, activeMode: 'detached' }} action={action} /> : <p className="ai-empty" role="status">正在连接阅读主窗口…</p>}</div>
  </div>;
}
