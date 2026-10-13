import { useEffect, useRef, useState } from 'react';
import brandMark from '../assets/brand-pine-seal.png';
import type { DesktopUnlisten, DesktopWindow } from '../platform/desktop';
import { palette, type ReaderTheme } from '../reader/themes';

export default function DesktopTitleBar({ native, theme, guard, onError, title = '静读 · EPUB 阅读器', closeAction }: {
  native: DesktopWindow; theme: ReaderTheme; guard(action: () => void): void; onError(message: string): void;
  title?: string; closeAction?(): void;
}) {
  const [maximized, setMaximized] = useState(false);
  const [ready, setReady] = useState(false);
  const callbacks = useRef({ guard, onError, closeAction }); callbacks.current = { guard, onError, closeAction };
  const customClose = !!closeAction;
  const closing = useRef(false);
  const backgroundWrites = useRef(Promise.resolve());
  const fail = () => callbacks.current.onError('窗口操作失败，请稍后重试。');
  useEffect(() => {
    let disposed = false;
    const cleanups: DesktopUnlisten[] = [];
    const unlisten = (cleanup: DesktopUnlisten) => { void Promise.resolve().then(cleanup).catch(() => {}); };
    const retain = (cleanup: DesktopUnlisten) => { if (disposed) unlisten(cleanup); else cleanups.push(cleanup); };
    const updateMaximized = () => {
      void native.isMaximized().then(value => { if (!disposed) setMaximized(value); }).catch(() => { if (!disposed) fail(); });
    };
    updateMaximized();
    void native.onResized(updateMaximized).then(retain).catch(() => { if (!disposed) fail(); });
    // Covers our close button and native close requests (Alt+F4 / taskbar close).
    // Destroy only after the existing note guard has persisted drafts / resolved pending adjustments.
    // Assistant OS close requests are already routed to its owner by Rust. Do not destroy that view.
    if (customClose) setReady(true);
    else void native.onCloseRequested(event => {
      event.preventDefault();
      if (closing.current) return;
      callbacks.current.guard(() => {
        if (closing.current) return;
        closing.current = true;
        void native.destroy().catch(() => { closing.current = false; fail(); });
      });
    }).then(cleanup => { retain(cleanup); if (!disposed) setReady(true); }).catch(() => { if (!disposed) fail(); });
    return () => { disposed = true; cleanups.forEach(unlisten); };
  }, [native, customClose]);
  useEffect(() => {
    backgroundWrites.current = backgroundWrites.current.then(() => native.setBackgroundColor(palette[theme].background)).catch(fail);
  }, [native, theme]);
  return <div className="desktop-titlebar" role="toolbar" aria-label="桌面窗口标题栏" data-note-guarded>
    <div className="desktop-title-drag" data-tauri-drag-region="deep" title="拖动移动窗口，双击最大化或还原">
      <img src={brandMark} alt="" aria-hidden="true" draggable={false} />
      <span>{title}</span>
    </div>
    <div className="desktop-window-actions">
      <button aria-label="最小化窗口" title="最小化" onClick={() => { void native.minimize().catch(fail); }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg></button>
      <button aria-label={maximized ? '还原窗口' : '最大化窗口'} title={maximized ? '还原' : '最大化'} onClick={() => { void native.toggleMaximize().then(() => native.isMaximized()).then(setMaximized).catch(fail); }}><svg viewBox="0 0 16 16" aria-hidden="true">{maximized ? <><path d="M5 3h8v8M3 5h8v8H3z" /></> : <path d="M3 3h10v10H3z" />}</svg></button>
      <button className="desktop-window-close" aria-label="关闭窗口" title="关闭" disabled={!ready} onClick={() => { if (callbacks.current.closeAction) callbacks.current.guard(callbacks.current.closeAction); else void native.close().catch(fail); }}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" /></svg></button>
    </div>
  </div>;
}
