export class RestorationFragments {
  static group = items => {
    const fields = new Map();
    for (const item of items) {
      const key = JSON.stringify([item.source, item.fieldId]);
      if (!fields.has(key)) fields.set(key, []);
      fields.get(key).push(item);
    }
    return [...fields.values()].flatMap(RestorationFragments.merge);
  };

  static merge = items => {
    const result = [];
    for (const item of [...items].sort((a, b) => (a.after.contextStart ?? 0) - (b.after.contextStart ?? 0))) {
      const start = item.after.contextStart;
      const text = item.after.text;
      const previous = result.at(-1);
      const overlap = previous && Number.isInteger(start) && Number.isInteger(previous.start) ? previous.start + previous.text.length - start : -1;
      if (previous && overlap >= 0 && previous.text.slice(start - previous.start, start - previous.start + Math.min(overlap, text.length)) === text.slice(0, overlap)) {
        previous.text += text.slice(overlap);
        previous.matches.push({ ...item, start: start + item.after.start - previous.start, end: start + item.after.end - previous.start });
      } else result.push({ id: item.id, source: item.source, start, totalLength: item.after.totalLength, text, matches: [{ ...item, start: item.after.start, end: item.after.end }] });
    }
    return result;
  };
}
