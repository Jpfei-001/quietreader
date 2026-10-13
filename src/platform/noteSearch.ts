export interface SearchRange { start: number; end: number }
export interface SearchTerm { text: string; approximate: boolean }

// 搜索时忽略全角、大小写、重音、空白与标点；映射仍指向原始 UTF-16 位置，
// 仅用于显示高亮，绝不修改保存的原文或用 HTML 注入搜索结果。
function normalized(text: string) {
  let value = '';
  const starts: number[] = [], ends: number[] = [];
  let offset = 0;
  for (const char of text) {
    const folded = char.normalize('NFKD').toLowerCase().replace(/[\p{M}\p{P}\s]/gu, '');
    value += folded;
    for (let i = 0; i < folded.length; i++) { starts.push(offset); ends.push(offset + char.length); }
    offset += char.length;
  }
  return { value, starts, ends };
}
export function searchTerms(query: string): SearchTerm[] {
  return [...new Set(query.normalize('NFKC').trim().split(/\s+/u).map(term => normalized(term).value).filter(Boolean))]
    .map(text => ({ text, approximate: Array.from(text).length >= 4 && text.length <= 64 }));
}

// 一次编辑距离的子串匹配：支持一个错字、漏字或多字，不进行任意跨段跳字匹配。
// 每个字段单独匹配，O(字段长度 × 关键词长度)，内存为 O(关键词长度)。
function approximateRange(value: string, term: string): SearchRange | undefined {
  let costs = Array.from({ length: term.length + 1 }, (_, i) => i);
  let starts = new Array<number>(term.length + 1).fill(0);
  let best: SearchRange | undefined;
  for (let i = 0; i < value.length; i++) {
    const next = new Array<number>(term.length + 1).fill(0), nextStarts = new Array<number>(term.length + 1).fill(i + 1);
    for (let j = 1; j <= term.length; j++) {
      const substitution = costs[j - 1] + (value[i] === term[j - 1] ? 0 : 1);
      const insertion = costs[j] + 1, deletion = next[j - 1] + 1;
      next[j] = Math.min(substitution, insertion, deletion);
      nextStarts[j] = next[j] === substitution ? starts[j - 1] : next[j] === insertion ? starts[j] : nextStarts[j - 1];
    }
    if (next[term.length] <= 1) {
      const range = { start: nextStarts[term.length], end: i + 1 };
      if (!best || Math.abs(range.end - range.start - term.length) < Math.abs(best.end - best.start - term.length)) best = range;
    }
    costs = next; starts = nextStarts;
  }
  return best;
}
export function searchRanges(text: string, terms: readonly SearchTerm[]): SearchRange[] {
  if (!terms.length) return [];
  const { value, starts, ends } = normalized(text), ranges: SearchRange[] = [];
  for (const term of terms) {
    if (!term.text) continue;
    let found = false, from = 0, index: number;
    while ((index = value.indexOf(term.text, from)) >= 0) {
      ranges.push({ start: starts[index], end: ends[index + term.text.length - 1] });
      found = true; from = index + term.text.length;
    }
    if (!found && term.approximate) {
      const range = approximateRange(value, term.text);
      if (range) ranges.push({ start: starts[range.start], end: ends[range.end - 1] });
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: SearchRange[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}
export function matchesNote(fields: readonly string[], terms: readonly SearchTerm[]): boolean {
  // 多关键词为 AND，同一个关键词可命中原文、思考、章节或标题等不同字段。
  return terms.every(term => fields.some(field => searchRanges(field, [term]).length > 0));
}
