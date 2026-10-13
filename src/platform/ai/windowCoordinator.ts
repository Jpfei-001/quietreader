import { invokeAi, tauriBridge } from './bridge';
import { isAiMode } from './settings';
import type { AiAction, AiMode } from './types';
import { aiError } from './types';
import type { AiSessionStore } from './sessionStore';
import { browserAssistantPlacement, browserPopupFeatures, browserWorkArea, mainBrowserGeometry, currentBrowserFrameInset } from './browserWindowLayout';
import { followBrowserWindows } from './browserWindowFollow';
import { BrowserWindowSizing } from './browserWindowSizing';
export const AI_ACTION_EVENT = 'quiet-ai-action', AI_STATE_EVENT = 'quiet-ai-state';
export function validAiAction(value: unknown): value is AiAction {
  if (!value || typeof value !== 'object') return false;
  const a = value as Record<string, unknown>;
  if (['stop', 'close', 'settings', 'snapshot'].includes(String(a.type))) return true;
  if (a.type === 'retry') return typeof a.id === 'string' && a.id.length <= 100;
  if (a.type === 'input') return typeof a.text === 'string' && a.text.length <= 4000;
  if (a.type === 'send') return a.text === undefined || typeof a.text === 'string' && a.text.length <= 4000;
  if (a.type === 'mode') return isAiMode(a.mode);
  if (a.type === 'scroll') return typeof a.value === 'number' && Number.isFinite(a.value);
  return a.type === 'save' && typeof a.id === 'string' && typeof a.text === 'string' && a.text.length <= 20000;
}
/** All reading changes are opt-in and restored; no existing preferences are rewritten. */
export function freezeReadingShell() {
  const app = document.querySelector<HTMLElement>('.app');
  if (!app) throw new Error('阅读窗口尚未就绪。');
  const originals: { el: HTMLElement; style: string | null }[] = [];
  const originalExpanded = app.getAttribute('data-ai-reading-expanded');
  const retain = (el: HTMLElement) => originals.push({ el, style: el.getAttribute('style') });
  retain(app);
  app.style.width = `${innerWidth}px`;
  const dock = app.querySelector<HTMLElement>('.contents-dock');
  // Freeze the pre-expansion vw width even if the user pins the directory later.
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;width:var(--contents-dock-width);height:0;visibility:hidden;pointer-events:none';
  app.appendChild(probe);
  const dockWidth = dock?.getBoundingClientRect().width ?? probe.getBoundingClientRect().width;
  probe.remove();
  if (dock) { retain(dock); dock.style.width = 'var(--contents-dock-width)'; }
  let expanded = false;
  const resize = (width: number) => {
    // Painting/layout must track the viewport immediately; only native fallback is debounced.
    const shellWidth = expanded ? 'max(240px, calc(100vw - 420px))' : `${Math.max(240, width)}px`;
    app.style.width = shellWidth; app.style.setProperty('--ai-reading-shell-width', shellWidth);
    app.style.setProperty('--contents-dock-width', `min(${dockWidth}px, calc(${shellWidth} * 0.42))`);
    app.style.setProperty('--ai-divider-width', `${1 / (window.devicePixelRatio || 1)}px`);
  };
  resize(innerWidth);
  // Preserve viewport-breakpoint sizing, not state-dependent visibility. Focus mode must
  // remain free to hide/show the brand and toolbar; EPUB dimensions stay container-based.
  app.querySelectorAll<HTMLElement>('.topbar,.brand,.brand-mark,.brand-caption,.toolbar,.reader-action,.book-heading,.book-heading h1,.reading-chapter,.reader-footer,.focus-toggle').forEach(el => {
    retain(el); const computed = getComputedStyle(el);
    for (const property of ['font-size', 'padding', 'gap', 'flex-wrap', 'flex-direction', 'min-height', 'max-width']) {
      // Footer padding also changes with focus mode, so it must stay under the stylesheet's control.
      if (property === 'padding' && el.matches('.reader-footer')) continue;
      el.style.setProperty(property, computed.getPropertyValue(property));
    }
  });
  // React updates App's className on focus/theme changes. A dedicated attribute survives
  // those renders and keeps the directory/backdrop at the reading shell's right edge.
  app.setAttribute('data-ai-reading-expanded', 'true');
  app.classList.add('ai-reading-expanded');
  return { resize, expand() { expanded = true; resize(innerWidth - 420); }, restore() { originals.forEach(({ el, style }) => style === null ? el.removeAttribute('style') : el.setAttribute('style', style)); originalExpanded === null ? app.removeAttribute('data-ai-reading-expanded') : app.setAttribute('data-ai-reading-expanded', originalExpanded); app.classList.remove('ai-reading-expanded'); } };
}
export class AiWindowCoordinator {
  private frozen?: ReturnType<typeof freezeReadingShell>;
  private browserWindow: Window | null = null;
  private channel?: BroadcastChannel;
  private channelId = crypto.randomUUID();
  private readyResolve?: () => void;
  private ready = false;
  private browserGeometry = '';
  private observedBrowserGeometry = '';
  private browserSizing = new BrowserWindowSizing();
  private browserMoveSuspended = false;
  private browserSizeMismatchSince?: number;
  private alignmentCheck?: ReturnType<typeof setTimeout>;
  private checkExpansion?: () => void;
  private cancelExpansionCheck?: () => void;
  constructor(private store: AiSessionStore, private onAction: (action: AiAction) => void) {}
  async attach() {
    this.browserSizing = new BrowserWindowSizing(); this.browserMoveSuspended = false; this.browserSizeMismatchSince = undefined;
    this.observedBrowserGeometry = '';
    this.browserGeometry = ''; // Re-apply updated spacing to an already open browser assistant after hot reload.
    const native = tauriBridge();
    const incoming = (payload: unknown) => { if (!validAiAction(payload)) return; if (payload.type === 'snapshot') { this.ready = true; this.readyResolve?.(); this.publish(); } else this.onAction(payload); };
    let disposeNative: (() => void) | undefined, channel: BroadcastChannel | undefined;
    if (native) disposeNative = await native.event.listen<unknown>(AI_ACTION_EVENT, e => incoming(e.payload));
    else if (typeof BroadcastChannel !== 'undefined') { channel = new BroadcastChannel(`quiet-ai-${this.channelId}`); this.channel = channel; channel.onmessage = e => incoming(e.data); }
    let fitRevision = 0, disposed = false, fitTimer: ReturnType<typeof setTimeout> | undefined;
    const validFit = (revision: number, frozen: typeof this.frozen) => {
      const current = this.store.getSnapshot();
      return !disposed && revision === fitRevision && this.frozen === frozen && current.open && !current.switching && current.activeMode === 'expanded';
    };
    const checkFit = async (revision: number, frozen: typeof this.frozen, confirm = false) => {
      if (!validFit(revision, frozen)) return;
      try {
        const fits = await invokeAi<boolean>('ai_expansion_fits');
        if (!validFit(revision, frozen)) return;
        if (fits) frozen?.resize(innerWidth - 420);
        // Native resize/DPI/work-area reads can be transitional. A single false must
        // never open another window; require a second failure after a quiet interval.
        else if (!confirm) fitTimer = setTimeout(() => { void checkFit(revision, frozen, true); }, 250);
        else void this.switchMode('detached', false, '阅读窗口已最大化、全屏或横向工作区不足，已切换独立助手。');
      } catch { /* A failed measurement is not proof that expansion does not fit. */ }
    };
    const cancelFit = () => { ++fitRevision; clearTimeout(fitTimer); };
    const resize = () => {
      cancelFit();
      const state = this.store.getSnapshot();
      if (!state.open || state.switching) return;
      if (!native && state.activeMode === 'detached') { this.observeBrowserWindow(); return; }
      if (!native || state.activeMode !== 'expanded') return;
      const revision = fitRevision, frozen = this.frozen;
      fitTimer = setTimeout(() => { void checkFit(revision, frozen); }, 200);
    };
    this.checkExpansion = resize; this.cancelExpansionCheck = cancelFit;
    window.addEventListener('resize', resize);
    const pagehide = () => { if (!native) { try { this.browserWindow?.close(); } catch { /* The browser may already be tearing down the child. */ } } };
    window.addEventListener('pagehide', pagehide);
    let followed: Window | null = null, stopFollowing: (() => void) | undefined;
    const synchronizeFollowing = () => {
      const state = this.store.getSnapshot(), target = !native && state.open && state.activeMode === 'detached' && !state.switching ? this.browserWindow : null;
      if (target === followed) return;
      stopFollowing?.(); stopFollowing = undefined; followed = target; this.observedBrowserGeometry = '';
      if (target) stopFollowing = followBrowserWindows(window, target, () => this.observeBrowserWindow());
    };
    const unsubscribeFollowing = this.store.subscribe(synchronizeFollowing); synchronizeFollowing();
    return () => { disposed = true; ++fitRevision; clearTimeout(fitTimer); if (this.checkExpansion === resize) { this.checkExpansion = undefined; this.cancelExpansionCheck = undefined; } unsubscribeFollowing(); stopFollowing?.(); disposeNative?.(); channel?.close(); if (this.channel === channel) this.channel = undefined; window.removeEventListener('resize', resize); window.removeEventListener('pagehide', pagehide); clearTimeout(this.alignmentCheck); };
  }
  publish() {
    const state = this.store.getSnapshot();
    if (tauriBridge()) void tauriBridge()!.event.emitTo('ai-assistant', AI_STATE_EVENT, state).catch(() => {});
    else this.channel?.postMessage({ type: 'state', state });
  }
  private observeBrowserWindow() {
    const state = this.store.getSnapshot(), child = this.browserWindow;
    if (!state.open || state.activeMode !== 'detached' || state.switching || !child) return;
    if (child.closed) { this.browserWindow = null; void this.close(); return; }
    if (this.browserMoveSuspended) return;
    try {
      const target = this.browserSizing.target;
      if (target && (Math.abs(child.outerWidth - target.width) > 2 || Math.abs(child.outerHeight - target.height) > 2)) {
        this.browserSizeMismatchSince ??= performance.now();
        if (performance.now() - this.browserSizeMismatchSince > 120) { this.browserMoveSuspended = true; this.store.patch({ notice: '浏览器移动会改变助手尺寸，已暂停自动跟随以防继续放大；请手动并排或使用桌面扩展模式。' }); return; }
      } else this.browserSizeMismatchSince = undefined;
      const main = mainBrowserGeometry();
      const key = [main.x, main.y, main.width, main.height, innerWidth, child.screenX, child.screenY, child.outerWidth, child.outerHeight, child.innerWidth].join('|');
      if (key === this.observedBrowserGeometry) return;
      this.observedBrowserGeometry = key;
      const notice = this.alignBrowserWindow(); if (notice && notice !== this.store.getSnapshot().notice) this.store.patch({ notice });
    } catch { const notice = '无法读取助手窗口位置，浏览器可能限制了访问；主阅读器未改变。'; if (notice !== this.store.getSnapshot().notice) this.store.patch({ notice }); }
  }
  private alignBrowserWindow(): string {
    const child = this.browserWindow;
    if (!child || child.closed || tauriBridge()) return '';
    if (this.browserMoveSuspended) return '浏览器移动会改变助手尺寸，已暂停自动跟随以防继续放大；请手动并排或使用桌面扩展模式。';
    const main = mainBrowserGeometry(); this.browserGeometry = JSON.stringify(main);
    const placement = browserAssistantPlacement(main, browserWorkArea(), this.browserSizing.targetWidth(child), { main: currentBrowserFrameInset(), assistant: currentBrowserFrameInset(child) });
    // Some browsers open a new tab instead. Never risk resizing/moving its shared reading window.
    if (document.visibilityState === 'hidden' && Math.abs(child.outerWidth - main.width) < 32 && Math.abs(child.screenX - main.x) < 16) return '浏览器可能将助手作为标签页打开，无法安全自动定位；主窗口未调整，请允许独立弹窗后重试。';
    try {
      const x = Math.round(placement.x), y = Math.round(placement.y);
      if (!placement.fitsRight) return '右侧可用空间不足，已打开独立助手；主阅读器未缩小，请手动安排窗口位置。';
      const moveNeeded = Math.abs(child.screenX - x) > 2 || Math.abs(child.screenY - y) > 2;
      if (moveNeeded) child.moveTo(x, y);
      const resized = this.browserSizing.restore(child, placement.height, moveNeeded, /Win/i.test(navigator.platform) && /Chrome|Edg/.test(navigator.userAgent));
      if (!moveNeeded && !resized) return '';
      clearTimeout(this.alignmentCheck);
      this.alignmentCheck = setTimeout(() => {
        const state = this.store.getSnapshot();
        if (this.browserWindow !== child || child.closed || !state.open || state.activeMode !== 'detached' || state.switching || JSON.stringify(mainBrowserGeometry()) !== this.browserGeometry) return;
        const target = this.browserSizing.target;
        if (target && (Math.abs(child.outerWidth - target.width) > 2 || Math.abs(child.outerHeight - target.height) > 2)) { this.browserMoveSuspended = true; const notice = '浏览器移动会改变助手尺寸，已暂停自动跟随以防继续放大；请手动并排或使用桌面扩展模式。'; if (notice !== state.notice) this.store.patch({ notice }); return; }
        if (Math.abs(child.screenX - placement.x) > 16 || Math.abs(child.screenY - placement.y) > 16) { const notice = '浏览器限制了助手的位置或尺寸，可手动调整；主阅读器未改变。'; if (notice !== state.notice) this.store.patch({ notice }); }
      }, 150);
      return '';
    } catch { return '浏览器不允许自动调整助手位置或尺寸，请手动并排；主阅读器未改变。'; }
  }
  private async detached() {
    this.ready = false;
    const native = tauriBridge(), wasDetached = this.store.getSnapshot().open && this.store.getSnapshot().activeMode === 'detached';
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('独立助手窗口加载超时，原问答已保留。')), 10000); });
    const waiting = new Promise<void>(resolve => { this.readyResolve = () => { this.readyResolve = undefined; resolve(); }; });
    try {
      if (native) {
        // The deadline covers BOTH IPC and readiness, even if a snapshot arrives before IPC completes.
        await Promise.race([Promise.all([invokeAi('ai_detached_open'), waiting]), deadline]);
        await Promise.race([invokeAi('ai_detached_show'), deadline]);
      } else {
        if (!this.channel) throw new Error('浏览器不支持独立问答通道，请使用悬浮窗。');
        if (!this.browserWindow || this.browserWindow.closed) { this.browserSizing.reset(); this.browserMoveSuspended = false; this.browserSizeMismatchSince = undefined; this.browserWindow = window.open(`?ai-assistant=1&channel=${encodeURIComponent(this.channelId)}`, `quiet-ai-assistant-${this.channelId}`, browserPopupFeatures(browserAssistantPlacement(mainBrowserGeometry(), browserWorkArea(), 440, { main: currentBrowserFrameInset(), assistant: currentBrowserFrameInset() }))); }
        if (!this.browserWindow) throw new Error('独立窗口被浏览器拦截，请允许弹窗或选择悬浮窗。');
        this.browserWindow.focus(); this.publish();
        this.channel.postMessage({ type: 'ping' });
        if (this.ready) this.readyResolve?.();
        await Promise.race([waiting, deadline]);
      }
      return this.alignBrowserWindow();
    } catch (error) {
      if (native && !wasDetached) void invokeAi('ai_detached_hide').catch(() => {});
      throw error;
    } finally { clearTimeout(timer!); this.readyResolve = undefined; }
  }
  async open() {
    const state = this.store.getSnapshot();
    if (state.switching) { this.publish(); return; }
    if (state.open) {
      this.publish();
      if (state.activeMode === 'detached') { if (tauriBridge()) await this.detached(); else { this.browserWindow?.focus(); const notice = this.alignBrowserWindow(); if (notice) this.store.patch({ notice }); } }
      return;
    }
    // A fresh desktop conversation always tries the reading-preserving expansion first.
    // Saved detached/floating choices still apply to browsers; an open session keeps its current mode.
    await this.switchMode(tauriBridge() ? 'expanded' : state.preferredMode, false);
  }
  async switchMode(preferred: AiMode, remember = true, notice = '') {
    const before = this.store.getSnapshot();
    if (before.switching) return;
    if (before.open && before.activeMode === preferred) { if (remember) this.store.rememberMode(preferred); return; }
    this.cancelExpansionCheck?.();
    this.store.patch({ switching: true });
    let target = preferred, newlyExpanded = false;
    try {
      if (preferred === 'expanded') {
        if (!tauriBridge()) { target = 'detached'; notice = ''; }
        else {
          this.frozen = freezeReadingShell();
          const result = await invokeAi<{ expanded: boolean; reason?: string }>('ai_window_expand');
          if (!result.expanded) { this.frozen.restore(); this.frozen = undefined; target = 'detached'; notice = result.reason || '当前不能扩展，使用独立助手，主窗口不变。'; }
          else { newlyExpanded = true; this.frozen.expand(); }
        }
      }
      if (target === 'detached') {
        try { const layoutNotice = await this.detached(); if (layoutNotice) notice = [notice, layoutNotice].filter(Boolean).join(' '); } catch (error) {
          if (!before.open && (tauriBridge() || preferred === 'expanded')) { target = 'floating'; notice = `${aiError(error)} 已使用悬浮窗，默认偏好不变。`; }
          else throw error;
        }
      }
      if (before.open && before.activeMode === 'expanded' && target !== 'expanded') { await invokeAi('ai_window_restore'); this.frozen?.restore(); this.frozen = undefined; }
      this.store.patch({ open: true, activeMode: target, notice });
      if (remember) this.store.rememberMode(preferred);
      if (before.open && before.activeMode === 'detached' && target !== 'detached') { if (tauriBridge()) await invokeAi('ai_detached_hide'); else this.browserWindow?.close(); }
    } catch (error) {
      if (newlyExpanded) { try { await invokeAi('ai_window_restore'); } catch { this.store.patch({ notice: '扩窗恢复失败，请检查窗口；会话仍保留。' }); } }
      if (before.activeMode !== 'expanded' || !before.open) { this.frozen?.restore(); this.frozen = undefined; }
      this.store.patch({ notice: aiError(error) });
    } finally { this.store.patch({ switching: false }); this.publish(); if (newlyExpanded) this.checkExpansion?.(); }
  }
  async close() {
    if (this.store.getSnapshot().switching) return;
    this.cancelExpansionCheck?.();
    clearTimeout(this.alignmentCheck);
    this.store.stop();
    const state = this.store.getSnapshot();
    try {
      if (state.activeMode === 'expanded') { await invokeAi('ai_window_restore'); this.frozen?.restore(); this.frozen = undefined; }
      if (state.activeMode === 'detached') { if (tauriBridge()) await invokeAi('ai_detached_hide'); else this.browserWindow?.close(); }
      this.store.endConversation();
    } catch (error) { this.store.patch({ notice: aiError(error) }); }
  }
}
