import { expect, it } from 'vitest';
import { matchesNote, searchRanges, searchTerms } from './noteSearch';

it('部分词、大小写、全角、重音与标点兼容，位置仍对应原始文本', () => {
  const text = 'Ｃafé，经济改革';
  const ranges = searchRanges(text, searchTerms('CAFE经济'));
  expect(ranges).toEqual([{ start: 0, end: 7 }]);
  expect(text.slice(ranges[0].start, ranges[0].end)).toBe('Ｃafé，经济');
});
it('多个关键词全部命中，可分布在不同字段，不凭空连接不同字段', () => {
  expect(matchesNote(['原文讨论供给侧改革', '我的思考：宏观经济'], searchTerms('供给 经济'))).toBe(true);
  expect(matchesNote(['供给侧改革'], searchTerms('供给 宇宙'))).toBe(false);
  expect(matchesNote(['供给', '侧改革'], searchTerms('供给侧改革'))).toBe(false);
});
it('四字以上关键词允许一次替换、删除或插入，并高亮实际命中的完整范围', () => {
  for (const query of ['供给测改革', '供给改革', '供给侧的改革']) {
    expect(searchRanges('前文：供给侧改革。后文', searchTerms(query))).toEqual([{ start: 3, end: 8 }]);
  }
});
it('精确命中优先并标出所有重复位置，不额外标记近似词', () => {
  expect(searchRanges('经济改革、经济改个、经济改革', searchTerms('经济改革'))).toEqual([{ start: 0, end: 4 }, { start: 10, end: 14 }]);
});
it('短词不使用纠错，不把两个错字或任意跳字匹配当作命中', () => {
  expect(matchesNote(['经济'], searchTerms('经齐'))).toBe(false);
  expect(matchesNote(['供给侧改革'], searchTerms('供需测改革'))).toBe(false);
  expect(matchesNote(['供很多给其他侧文字改革'], searchTerms('供给侧改革'))).toBe(false);
});
it('空输入、纯空白与标点不筛掉所有笔记，空关键词不导致无限循环', () => {
  for (const query of ['', '   ', '，。']) expect(searchTerms(query)).toEqual([]);
  expect(matchesNote(['任意正文'], searchTerms(' '))).toBe(true);
  expect(searchRanges('任意正文', [{ text: '', approximate: false }])).toEqual([]);
});
it('合并重叠高亮，但原文中的换行、空格与符号保持原样', () => {
  const text = '供给\n侧 改革';
  expect(searchRanges(text, searchTerms('供给侧 侧改革'))).toEqual([{ start: 0, end: text.length }]);
  expect(text).toBe('供给\n侧 改革');
});
it('代理对与全角折叠仍返回完整 UTF-16 范围', () => {
  const text = '😀ＡＢＣＤ🚀';
  expect(searchRanges(text, searchTerms('abcd'))).toEqual([{ start: 2, end: 6 }]);
  expect(searchRanges(text, searchTerms('🚀'))).toEqual([{ start: 6, end: 8 }]);
});
it('过长关键词只允许精确匹配，不进入纠错算法', () => {
  const query = '甲'.repeat(65);
  expect(searchTerms(query)[0].approximate).toBe(false);
  expect(matchesNote([query], searchTerms(query))).toBe(true);
  expect(matchesNote(['甲'.repeat(64) + '乙'], searchTerms(query))).toBe(false);
});
