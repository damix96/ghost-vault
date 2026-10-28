export type CopyState = 'idle' | 'pending' | 'copied' | 'failed';
export type ClipboardWriter = (value: string) => Promise<void>;

export class ClipboardTask {
  state: CopyState = 'idle';
  source = '';
  private generation = 0;

  constructor(private readonly write: ClipboardWriter) {}

  copy = async (source: string, value: string) => {
    if (this.state === 'pending') throw new Error('A copy is already pending');
    const token = ++this.generation;
    this.source = source;
    this.state = 'pending';
    try {
      await this.write(value);
      if (token !== this.generation) return false;
      this.state = 'copied';
    } catch {
      if (token !== this.generation) return false;
      this.state = 'failed';
    }
    return this.state === 'copied';
  };

  dispose = () => {
    this.generation++;
    this.state = 'idle';
    this.source = '';
  };
}
