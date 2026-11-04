import { ContextWindow } from './context-window.js';

export class RestorationFragments {
  static group = items => {
    const fields = new Map();
    for (const original of items) {
      const item = RestorationFragments.clip(original);
      const key = JSON.stringify([item.source, item.fieldId]);
      if (!fields.has(key)) fields.set(key, []);
      fields.get(key).push(item);
    }
    return [...fields.values()].map(items => ({ id: items[0].id, source: items[0].source, fieldId: items[0].fieldId, windows: RestorationFragments.merge(items) }));
  };

  static clip = item => {
    const field = item.after;
    const { start: from, end: to } = ContextWindow.around(field.text, field.start, field.end, 96);
    return { ...item, after: { ...field, text: field.text.slice(from, to), start: field.start - from, end: field.end - from, contextStart: field.contextStart + from } };
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
