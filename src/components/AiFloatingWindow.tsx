import { useEffect, useRef, useState } from 'react';
import AiQuestionContent from './AiQuestionContent';
import type { AiAction, AiState } from '../platform/ai/types';
export interface FloatingBounds { x: number; y: number; width: number; height: number }
export function clampFloating(bounds: FloatingBounds, viewport: { width: number; height: number; top: number }): FloatingBounds {
  const width = Math.min(Math.max(360, bounds.width), Math.max(120, viewport.width - 24)), height = Math.min(Math.max(400, bounds.height), Math.max(160, viewport.height - viewport.top - 24));
  return { width, height, x: Math.max(12, Math.min(bounds.x, viewport.width - width - 12)), y: Math.max(viewport.top + 12, Math.min(bounds.y, viewport.height - height - 12)) };
}
let remembered: FloatingBounds | undefined;
export default function AiFloatingWindow({ state, action }: { state: AiState; action(action: AiAction): void }) {
  const viewport = () => ({ width: window.visualViewport?.width ?? innerWidth, height: window.visualViewport?.height ?? innerHeight, top: window.__TAURI__ ? 32 : 0 });
  const recommended = () => clampFloating({ x: innerWidth - 520, y: 140, width: 500, height: 640 }, viewport());
  const [bounds, setBounds] = useState(() => clampFloating(remembered ?? recommended(), viewport())), [collapsed, setCollapsed] = useState(false), [dragging, setDragging] = useState(false);
  const value = useRef(bounds); value.current = bounds;
  const drag = useRef<{ startX: number; startY: number; bounds: FloatingBounds; resize: boolean } | undefined>(undefined);
  useEffect(() => { const resize = () => setBounds(b => clampFloating(b, viewport())); window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize); return () => { remembered = value.current; window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); }; }, []);
  function finish() { drag.current = undefined; setDragging(false); remembered = value.current; }
  useEffect(() => { window.addEventListener('blur', finish); return () => window.removeEventListener('blur', finish); }, []);
  return <>
    {dragging && <div className="ai-drag-capture" aria-hidden="true" />}
    <div className={`ai-floating${collapsed ? ' ai-floating-collapsed' : ''}`} style={{ left: bounds.x, top: bounds.y, width: collapsed ? Math.min(320, bounds.width) : bounds.width, height: collapsed ? 46 : bounds.height }} onPointerDown={e => {
      const target = e.target as HTMLElement, resize = !!target.closest('[data-ai-resize]');
      if (!resize && (!target.closest('[data-ai-drag]') || target.closest('button,input,select,textarea,a'))) return;
      e.preventDefault(); e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { startX: e.clientX, startY: e.clientY, bounds: value.current, resize }; setDragging(true);
    }} onPointerMove={e => { const current = drag.current; if (!current) return; const dx = e.clientX - current.startX, dy = e.clientY - current.startY; setBounds(clampFloating(current.resize ? { ...current.bounds, width: current.bounds.width + dx, height: current.bounds.height + dy } : { ...current.bounds, x: current.bounds.x + dx, y: current.bounds.y + dy }, viewport())); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      {collapsed ? <div className="ai-collapsed-bar" data-ai-ui data-ai-drag onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); action({ type: 'close' }); } }}><span>✧ AI 助手 · {state.generating ? '生成中' : '已收起'}</span><button onClick={() => setCollapsed(false)}>展开</button><button aria-label="关闭 AI 助手" onClick={() => action({ type: 'close' })}>×</button></div> : <><AiQuestionContent state={state} action={action} onCollapse={() => setCollapsed(true)} onReset={() => setBounds(recommended())} /><button data-ai-resize className="ai-resize-handle" aria-label="调整悬浮窗大小（方向键）" title="拖动调整大小；方向键也可调整" onKeyDown={e => { if (e.key.startsWith('Arrow')) { e.preventDefault(); e.stopPropagation(); setBounds(b => clampFloating({ ...b, width: b.width + (e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0), height: b.height + (e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0) }, viewport())); } }} /></>}
    </div>
  </>;
}
