// Public Tauri global API, enabled by app.withGlobalTauri. No IPC internals or extra npm dependency.
export type DesktopUnlisten = () => void | Promise<void>;
export interface DesktopWindow {
  isMaximized(): Promise<boolean>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  destroy(): Promise<void>;
  setBackgroundColor(color: string): Promise<void>;
  onResized(handler: () => void): Promise<DesktopUnlisten>;
  onCloseRequested(handler: (event: { preventDefault(): void }) => void): Promise<DesktopUnlisten>;
}
declare global {
  interface Window {
    __TAURI__?: { window: { getCurrentWindow(): DesktopWindow }; webviewWindow?: { getCurrentWebviewWindow(): DesktopWindow } };
  }
}
export function getDesktopWindow(): DesktopWindow | undefined {
  return typeof window === 'undefined' ? undefined :
    // WebviewWindow.setBackgroundColor updates BOTH the native window and WebView canvas.
    // Window.setBackgroundColor alone leaves the renderer's default backing color unchanged.
    window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow?.() ?? window.__TAURI__?.window?.getCurrentWindow?.();
}
