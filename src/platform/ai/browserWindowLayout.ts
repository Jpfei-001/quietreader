export const BROWSER_ASSISTANT_GAP = 4;
export const BROWSER_ASSISTANT_WIDTH = 440;
export interface BrowserWindowGeometry { x: number; y: number; width: number; height: number }
export interface BrowserWorkArea { x: number; y: number; width: number; height: number }
export interface BrowserAssistantPlacement extends BrowserWindowGeometry { fitsRight: boolean }
/** Estimate Windows' invisible resize frame, not viewport/DevTools/zoom space; cap each side. */
export function browserFrameInset(outerWidth: number, viewportWidth: number, windows: boolean): number { return windows ? Math.min(8, Math.max(0, (outerWidth - viewportWidth) / 2)) : 0; }
export function currentBrowserFrameInset(target: Window = window): number { return browserFrameInset(target.outerWidth, target.innerWidth, /Win/i.test(navigator.platform)); }
/** Window/screen coordinates are CSS pixels. Only invisible frames may overlap; reading stays unchanged. */
export function browserAssistantPlacement(main: BrowserWindowGeometry, work: BrowserWorkArea, width = BROWSER_ASSISTANT_WIDTH, frames = { main: 0, assistant: 0 }): BrowserAssistantPlacement {
  const targetWidth = Math.min(Math.max(240, width), Math.max(240, work.width));
  const x = main.x + main.width + BROWSER_ASSISTANT_GAP - frames.main - frames.assistant;
  return { x, y: main.y, width: targetWidth, height: Math.max(1, main.height), fitsRight: x >= work.x && x + targetWidth <= work.x + work.width && main.y >= work.y - 16 && main.y + main.height <= work.y + work.height + 16 };
}
export function mainBrowserGeometry(): BrowserWindowGeometry { return { x: window.screenX, y: window.screenY, width: window.outerWidth || innerWidth, height: window.outerHeight || innerHeight }; }
export function browserWorkArea(): BrowserWorkArea {
  const display = window.screen as Screen & { availLeft?: number; availTop?: number };
  return { x: display.availLeft ?? 0, y: display.availTop ?? 0, width: display.availWidth || window.outerWidth, height: display.availHeight || window.outerHeight };
}
export function browserPopupFeatures(placement: BrowserAssistantPlacement): string { return `popup,width=${Math.round(placement.width)},height=${Math.round(placement.height)},left=${Math.round(placement.x)},top=${Math.round(placement.y)}`; }
