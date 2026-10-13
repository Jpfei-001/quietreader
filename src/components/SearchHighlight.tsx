import { Fragment } from 'react';
import { searchRanges, type SearchTerm } from '../platform/noteSearch';

export default function SearchHighlight({ text, terms }: { text: string; terms: readonly SearchTerm[] }) {
  const ranges = searchRanges(text, terms);
  if (!ranges.length) return <>{text}</>;
  let offset = 0;
  const parts = ranges.map(range => {
    const before = text.slice(offset, range.start);
    offset = range.end;
    return <Fragment key={`${range.start}-${range.end}`}>{before}<mark className="search-hit">{text.slice(range.start, range.end)}</mark></Fragment>;
  });
  return <>{parts}{text.slice(offset)}</>;
}
