export class ContextWindow {
  static around = (text, start, end, cap) => {
    let from = Math.max(0, start - cap);
    let to = Math.min(text.length, end + cap);
    const before = [...text.slice(from, start).matchAll(/\r\n|\r|\n/g)];
    const after = [...text.slice(end, to).matchAll(/\r\n|\r|\n/g)];
    if (before.length > 1) from += before.at(-2).index + before.at(-2)[0].length;
    const tailBreak = end > start && (text[end - 1] === '\n' || (text[end - 1] === '\r' && text[end] !== '\n')) ? 0 : 1;
    if (after.length > tailBreak) to = end + after[tailBreak].index;
    if (from < start && (/[\uDC00-\uDFFF]/.test(text[from]) || (text[from] === '\n' && text[from - 1] === '\r'))) from++;
    if (to > end && (/[\uD800-\uDBFF]/.test(text[to - 1]) || (text[to - 1] === '\r' && text[to] === '\n'))) to--;
    return { start: from, end: to };
  };
}
