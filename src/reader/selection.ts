import type { Contents } from 'epubjs';
import type { AnnotationSeed, AnnotationRecord } from '../platform/annotationTypes';
import type { Chapter } from './engine';
export interface ScreenRect { x: number; y: number; width: number; height: number }
export interface SelectionSnapshot { seed: Omit<AnnotationSeed, 'bookId' | 'bookSnapshot'>; rects: ScreenRect[] }
function block(node: Node): Element | null { return (node.nodeType === 1 ? node as Element : node.parentElement)?.closest('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td') ?? null; }
function textNodes(range: Range) {
  const root = range.commonAncestorContainer;
  const walker = root.ownerDocument!.createTreeWalker(root, 4);
  const nodes: Text[] = root.nodeType === 3 ? [root as Text] : [];
  let node: Node | null;
  while ((node = walker.nextNode())) if (range.intersectsNode(node) && !node.parentElement?.closest('script,style,head')) nodes.push(node as Text);
  return nodes;
}
export function rangeText(range: Range): string {
  let previous: Element | null = null;
  let text = '';
  const root = range.commonAncestorContainer;
  const walker = root.ownerDocument!.createTreeWalker(root, 5);
  const nodes: Node[] = root.nodeType === 3 ? [root] : [];
  let next: Node | null;
  while ((next = walker.nextNode())) if (range.intersectsNode(next) && (next.nodeType === 3 || (next as Element).tagName === 'BR') && !next.parentElement?.closest('script,style,head')) nodes.push(next);
  for (const node of nodes) {
    if (node.nodeType === 1) { text += '\n'; previous = block(node); continue; }
    const content = node as Text;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : content.length;
    const value = content.data.slice(start, end);
    const current = block(node);
    if (text && current !== previous && value.trim()) text += '\n';
    text += value;
    previous = current;
  }
  return text;
}
export function screenRects(range: Range, frame: HTMLIFrameElement): ScreenRect[] {
  const box = frame.getBoundingClientRect();
  const pieces = textNodes(range).flatMap(node => {
    const part = node.ownerDocument.createRange();
    part.setStart(node, node === range.startContainer ? range.startOffset : 0);
    part.setEnd(node, node === range.endContainer ? range.endOffset : node.length);
    return Array.from(part.getClientRects());
  });
  return pieces.map(r => ({ x: box.x + r.x, y: box.y + r.y, width: r.width, height: r.height })).filter(r => r.width > 0 && r.height > 0 && r.x + r.width > box.left && r.x < box.right && r.y + r.height > box.top && r.y < box.bottom).map(r => {
    const x = Math.max(r.x, box.left), y = Math.max(r.y, box.top);
    return { x, y, width: Math.min(r.x + r.width, box.right) - x, height: Math.min(r.y + r.height, box.bottom) - y };
  });
}
export function snapshotSelection(contents: Contents, frame: HTMLIFrameElement, href: string, chapters: Chapter[]): SelectionSnapshot | null {
  const selection = contents.window.getSelection();
  if (!selection || !selection.rangeCount || selection.isCollapsed) return null;
  if (selection.rangeCount !== 1) throw new Error('无法可靠保存多选区，请在同一章节内分段摘录。');
  const range = selection.getRangeAt(0);
  if (range.startContainer.ownerDocument !== contents.document || range.endContainer.ownerDocument !== contents.document) throw new Error('不支持跨章节选文，请分段摘录。');
  const exact = rangeText(range);
  if (!exact.trim()) throw new Error('请选择正文文字，空白或图片不能保存为摘录。');
  if (exact.length > 10000) throw new Error('选文超过 10,000 字，请分段摘录。');
  const before = contents.document.createRange(); before.selectNodeContents(contents.document.body); before.setEnd(range.startContainer, range.startOffset);
  const after = contents.document.createRange(); after.selectNodeContents(contents.document.body); after.setStart(range.endContainer, range.endOffset);
  const headings: string[] = [];
  for (const h of Array.from(contents.document.querySelectorAll('h1,h2,h3'))) {
    if (h.compareDocumentPosition(range.startContainer) & 2) break;
    const level = Number(h.tagName.slice(1)); headings.length = level - 1; headings[level - 1] = h.textContent?.trim() || '';
  }
  let activeIndex = -1;
  chapters.forEach((chapter, index) => {
    if (chapter.href.split('#')[0] !== href.split('#')[0]) return;
    const fragment = chapter.href.split('#')[1];
    if (!fragment) activeIndex = index;
    else {
      const element = contents.document.getElementById(decodeURIComponent(fragment));
      if (element && !(element.compareDocumentPosition(range.startContainer) & 2)) activeIndex = index;
    }
  });
  const tocPath: string[] = [];
  if (activeIndex >= 0) {
    let depth = chapters[activeIndex].depth;
    tocPath.unshift(chapters[activeIndex].label);
    for (let i = activeIndex - 1; i >= 0; i--) if (chapters[i].depth < depth) { tocPath.unshift(chapters[i].label); depth = chapters[i].depth; }
  }
  const paragraphs = Array.from(contents.document.querySelectorAll('p,li,blockquote,pre'));
  const paragraph = block(range.startContainer);
  const paragraphIndex = paragraph ? paragraphs.indexOf(paragraph) + 1 : 0;
  return { seed: { locator: { rangeCfi: contents.cfiFromRange(range), href, spineIndex: contents.sectionIndex }, quote: { exact, prefix: before.toString().slice(-100), suffix: after.toString().slice(0, 100) }, source: { tocPath, headingPath: headings.filter(Boolean), ...(paragraphIndex > 0 ? { paragraphIndex } : {}) } }, rects: screenRects(range, frame) };
}
export function verifiedRange(contents: Contents, annotation: AnnotationRecord): Range {
  try {
    const range = contents.range(annotation.locator.rangeCfi);
    if (range && rangeText(range) === annotation.quote.exact) return range;
  } catch { /* Use only unique quote plus context matches in this resource. */ }
  const walker = contents.document.createTreeWalker(contents.document.body, 4);
  const nodes: Text[] = []; let node: Node | null; let text = '';
  while ((node = walker.nextNode())) { if (node.parentElement?.closest('style,script')) continue; nodes.push(node as Text); text += node.textContent; }
  // Normalize structural AND literal newlines for candidate search, then verify the exact Range text.
  // Boundary newlines in rangeText are literal text, not synthetic block separators.
  const leadingNewlines = annotation.quote.exact.match(/^\n*/)?.[0] ?? '';
  const trailingNewlines = annotation.quote.exact.match(/\n*$/)?.[0] ?? '';
  const quote = annotation.quote.exact.replace(/\n/g, '');
  const normalized = text.replace(/\n/g, '');
  const breaks: number[] = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') breaks.push(i - breaks.length);
  const originalOffset = (offset: number, start: boolean) => {
    let low = 0, high = breaks.length;
    while (low < high) { const mid = (low + high) >>> 1; if (breaks[mid] < offset || start && breaks[mid] === offset) low = mid + 1; else high = mid; }
    return offset + low;
  };
  const candidateRange = (from: number, to: number): Range | null => {
    const range = contents.document.createRange(); let offset = 0;
    for (const n of nodes) {
      if (from >= offset && from < offset + n.length) range.setStart(n, from - offset);
      if (to > offset && to <= offset + n.length) {
        range.setEnd(n, to - offset);
        return rangeText(range) === annotation.quote.exact ? range : null;
      }
      offset += n.length;
    }
    return null;
  };
  const matches: Range[] = [];
  let start = normalized.indexOf(quote);
  while (start >= 0) {
    const coreStart = originalOffset(start, true), coreEnd = originalOffset(start + quote.length, false);
    const from = coreStart - leadingNewlines.length, to = coreEnd + trailingNewlines.length;
    if (from >= 0 && text.slice(from, coreStart) === leadingNewlines && text.slice(coreEnd, to) === trailingNewlines && text.slice(Math.max(0, from - annotation.quote.prefix.length), from).endsWith(annotation.quote.prefix) && text.slice(to).startsWith(annotation.quote.suffix)) {
      // Count only complete, exact Range/context matches; normalized lookalikes are not locations.
      const range = candidateRange(from, to);
      if (range) matches.push(range);
      if (matches.length > 1) break;
    }
    start = normalized.indexOf(quote, start + 1);
  }
  if (matches.length !== 1) throw new Error(matches.length > 1 ? '原文与上下文存在多个匹配，无法唯一定位，请在目录中手动确认。' : '无法验证原文位置，可能文件内容已变化，请在目录中手动确认。');
  return matches[0];
}
