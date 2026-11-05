interface PreviewPrefix {
  value: string;
  failure: Uint32Array;
}

export class SecretPreview {
  private prefixes: PreviewPrefix[];

  constructor(forms: Iterable<string>) {
    this.prefixes = [...forms].filter(value => value.length > 1).map(this.prefix);
  }

  private prefix = (value: string): PreviewPrefix => {
    const failure = new Uint32Array(value.length);
    for (let index = 1, matched = 0; index < value.length; index++) {
      while (matched && value[index] !== value[matched]) matched = failure[matched - 1];
      if (value[index] === value[matched]) matched++;
      failure[index] = matched;
    }
    return { value, failure };
  };

  public trim = (text: string): string => {
    let tokenStart = text.length;
    for (const token of text.matchAll(/\$\$\{<[A-Z0-9_]+>\}/g)) if (token.index + token[0].length === text.length) tokenStart = token.index;
    let hidden = 0;
    for (const { value, failure } of this.prefixes) {
      let matched = 0;
      for (let index = Math.max(0, text.length - value.length + 1); index < text.length; index++) {
        while (matched && text[index] !== value[matched]) matched = failure[matched - 1];
        if (text[index] === value[matched]) matched++;
      }
      if (text.length - matched < tokenStart) hidden = Math.max(hidden, matched);
    }
    return text.slice(0, text.length - hidden);
  };
}
