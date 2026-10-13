import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createReader, type ReaderSession } from './engine';
import type { AnnotationRecord } from '../platform/annotationTypes';

const fake = vi.hoisted(() => {
  const events = new Map<string, (...args: unknown[]) => void>();
  const renderer = {
    on: vi.fn((name: string, callback: (...args: unknown[]) => void) => { events.set(name, callback); }),
    getContents: vi.fn(() => []),
    hooks: { content: { register: vi.fn() } },
    display: vi.fn(async (_href?: string) => {}),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    resize: vi.fn(),
  };
  const book = {
    open: vi.fn(async () => {}), opened: Promise.resolve(), ready: Promise.resolve(),
    loaded: { metadata: Promise.resolve({ title: '测试书', creator: '作者' }), navigation: Promise.resolve({ toc: [] }) },
    spine: { hooks: { content: { register: vi.fn() } } }, packaging: { spine: [{}] },
    renderTo: vi.fn(() => renderer), destroy: vi.fn(),
  };
  return { events, renderer, book };
});
vi.mock('epubjs', () => ({ Book: class { constructor() { return fake.book; } } }));
vi.mock('./themes', () => ({ applyTheme: vi.fn() }));

let session: ReaderSession;
let resizeCallback: ResizeObserverCallback;
beforeEach(async () => {
  vi.clearAllMocks(); fake.events.clear();
  fake.renderer.next.mockImplementation(async () => {});
  fake.renderer.prev.mockImplementation(async () => {});
  fake.renderer.display.mockImplementation(async () => {});
  fake.renderer.getContents.mockReturnValue([]);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resizeCallback = callback; } observe() {} disconnect() {} });
  session = await createReader({ data: new ArrayBuffer(0), container: {} as HTMLElement, signal: new AbortController().signal, theme: 'light', fontSize: 18, onLocation: vi.fn(), onKey: vi.fn() });
});
afterEach(() => { session?.destroy(); vi.unstubAllGlobals(); });

function observedSize(width: number, height: number) { resizeCallback([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver); }
function firstLocation() { fake.events.get('relocated')?.({ start: { href: 'chapter.xhtml', index: 0, cfi: 'epubcfi(/6/2!/4/2)', displayed: { page: 1, total: 3 } }, atStart: true, atEnd: false }); }
it('首次定位前的分数尺寸不会清空正文，只在定位后应用最后一个有效尺寸', async () => {
  observedSize(496.68, 701.25); observedSize(497.32, 702.25); observedSize(0, 0);
  expect(fake.renderer.resize).not.toHaveBeenCalled(); firstLocation(); await Promise.resolve();
  expect(fake.renderer.resize).toHaveBeenCalledExactlyOnceWith(497, 702);
  observedSize(520.7, 800.3); expect(fake.renderer.resize).toHaveBeenLastCalledWith(520, 800);
});
it('首次定位后的延迟尺寸任务不会在销毁后重绘旧书', async () => {
  observedSize(496.68, 701.25); firstLocation(); session.destroy(); await Promise.resolve();
  expect(fake.renderer.resize).not.toHaveBeenCalled();
});
function pending() {
  let resolve!: () => void, reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

for (const method of ['next', 'prev', 'display'] as const) it(`${method} 在正文移动之前通知坐标失效，完成后才重新绘制`, async () => {
  const operation = pending(), phases: string[] = [];
  session.onGeometry(phase => phases.push(phase));
  fake.renderer[method].mockImplementation(() => {
    expect(phases).toEqual(['changing']);
    return operation.promise;
  });
  const navigation = method === 'display' ? session.display('chapter.xhtml') : session[method]();
  expect(phases).toEqual(['changing']);
  // 即使持久化或布局事件触发重新计算，导航途中也不能读取旧坐标。
  expect(session.annotationRects({} as AnnotationRecord)).toEqual([]);
  fake.events.get('rendered')?.(); fake.events.get('resized')?.();
  expect(phases).toEqual(['changing']);
  operation.resolve(); await navigation;
  expect(phases).toEqual(['changing', 'ready']);
});

it('导航失败时仍解除坐标失效状态并恢复当前页绘制', async () => {
  const phases: string[] = [];
  session.onGeometry(phase => phases.push(phase));
  fake.renderer.next.mockRejectedValueOnce(new Error('模拟导航失败'));
  await expect(session.next()).rejects.toThrow('模拟导航失败');
  expect(phases).toEqual(['changing', 'ready']);
  await session.prev();
  expect(phases).toEqual(['changing', 'ready', 'changing', 'ready']);
});

it('重叠导航只在最后一项完成后恢复绘制，取消订阅后不再通知', async () => {
  const first = pending(), second = pending(), phases: string[] = [];
  const off = session.onGeometry(phase => phases.push(phase));
  fake.renderer.next.mockReturnValueOnce(first.promise);
  fake.renderer.prev.mockReturnValueOnce(second.promise);
  const next = session.next(), prev = session.prev();
  first.resolve(); await next;
  expect(phases).toEqual(['changing', 'changing']);
  second.resolve(); await prev;
  expect(phases).toEqual(['changing', 'changing', 'ready']);
  off(); await session.next();
  expect(phases).toHaveLength(3);
});

it('摘录定位失败时也恢复绘制，销毁中的导航不再回调', async () => {
  const phases: string[] = [];
  session.onGeometry(phase => phases.push(phase));
  await expect(session.locateAnnotation({ locator: { href: 'missing.xhtml', spineIndex: 0 } } as AnnotationRecord)).rejects.toThrow('未找到原文资源');
  expect(phases).toEqual(['changing', 'ready']);
  const operation = pending(); fake.renderer.next.mockReturnValueOnce(operation.promise);
  const navigation = session.next(); session.destroy(); operation.resolve(); await navigation;
  expect(phases).toEqual(['changing', 'ready', 'changing']);
});
