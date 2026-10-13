/** A fixed target, never a size measured after moveTo, is used for correction.
 * Windows Chromium on fractional DPI may enlarge bounds by 1 CSS px per native
 * move/resize. The 1px request bias is verified with real Edge at 175% DPI.
 * Other environments are protected by one request per target and a host fuse.
 */
export class BrowserWindowSizing {
  private width?: number;
  private requestKey = '';
  target?: { width: number; height: number };
  reset() { this.width = undefined; this.requestKey = ''; this.target = undefined; }
  targetWidth(child: Pick<Window, 'outerWidth'>): number {
    return this.width ??= child.outerWidth >= 240 && child.outerWidth <= 880 ? Math.round(child.outerWidth) : 440;
  }
  restore(child: Pick<Window, 'outerWidth' | 'outerHeight' | 'resizeTo' | 'devicePixelRatio'>, height: number, moved: boolean, windowsChromium: boolean): boolean {
    if (!Number.isFinite(height) || !Number.isFinite(child.outerWidth) || !Number.isFinite(child.outerHeight)) return false;
    const width = this.targetWidth(child); this.target ??= { width, height: Math.max(1, Math.round(height)) };
    const fractional = windowsChromium && Math.abs(child.devicePixelRatio - Math.round(child.devicePixelRatio)) > 0.01;
    const bias = fractional ? 1 : 0;
    const key = [width, this.target.height, bias].join('|');
    const differs = Math.abs(child.outerWidth - width) >= 1 || Math.abs(child.outerHeight - this.target.height) >= 1;
    if (!(moved && fractional) && (!differs || this.requestKey === key)) return false;
    this.requestKey = key;
    child.resizeTo(width - bias, this.target.height - bias);
    return true;
  }
}
