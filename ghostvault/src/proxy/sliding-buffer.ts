export class SlidingStreamTransformer {
  private buffer = '';
  private input = '';
  private windowSize: number;
  private values: Map<string, string>;
  private prefixes = new Set<string>();
  private pattern?: RegExp;
  private maxTokenLength: number;

  constructor(replacements: Array<{ from: string; to: string }>, windowSize = 64) {
    const sorted = [...replacements].filter(value => value.from).sort((a, b) => b.from.length - a.from.length);
    this.values = new Map(sorted.map(({ from, to }) => [from, to]));
    this.maxTokenLength = Math.max(...sorted.map(value => value.from.length), 32);
    this.windowSize = Math.max(windowSize, this.maxTokenLength * 2);
    if (sorted.length) this.pattern = new RegExp(sorted.map(({ from }) => from.replace(/\W/g, '\\$&')).join('|'), 'g');
    for (const { from } of sorted) for (let length = 1; length < from.length; length++) this.prefixes.add(from.slice(0, length));
  }

  public push = (chunk: string): string => {
    this.input += chunk;
    let pending = Math.min(this.input.length, this.maxTokenLength - 1);
    while (pending && !this.prefixes.has(this.input.slice(-pending))) pending--;
    const ready = this.input.length - pending;
    this.buffer += this.replace(this.input.slice(0, ready));
    this.input = this.input.slice(ready);

    if (this.buffer.length > this.windowSize) {
      let emitLength = this.buffer.length - this.windowSize;
      const before = this.buffer.charCodeAt(emitLength - 1);
      const after = this.buffer.charCodeAt(emitLength);
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) emitLength--;
      const emitText = this.buffer.slice(0, emitLength);
      this.buffer = this.buffer.slice(emitLength);
      return emitText;
    }

    return '';
  };

  public flush = (): string => {
    const remaining = this.buffer + this.replace(this.input);
    this.buffer = '';
    this.input = '';
    return remaining;
  };

  private replace = (text: string): string => this.pattern ? text.replace(this.pattern, value => this.values.get(value)!) : text;
}
