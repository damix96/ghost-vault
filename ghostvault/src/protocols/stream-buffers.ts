import { VaultStore } from '../vault/store.js';
import { SlidingStreamTransformer } from '../proxy/sliding-buffer.js';
import { ContentFields } from './content-fields.js';

interface DeltaBuffer {
  raw: string;
  transformer?: SlidingStreamTransformer;
  emit: (value: string) => void;
}

export class StreamBuffers {
  private buffers = new Map<string, DeltaBuffer>();

  constructor(private vault: Pick<VaultStore, 'getInboundReplacements' | 'unmaskInboundText'>, private windowSize: number, private onValue: (text: string) => void) {}

  public append = (key: string, value: string, emit: (value: string) => void, argumentsMode = false): void => {
    let buffer = this.buffers.get(key);
    if (!buffer) {
      buffer = { raw: '', emit, transformer: argumentsMode ? undefined : new SlidingStreamTransformer(this.vault.getInboundReplacements(), this.windowSize) };
      this.buffers.set(key, buffer);
    }
    buffer.raw += value;
    const ready = buffer.transformer?.push(value);
    if (ready) buffer.emit(ready);
  };

  public flush = (prefix = '', includeArguments = true): void => {
    for (const [key, buffer] of this.buffers) {
      if (!key.startsWith(prefix)) continue;
      this.buffers.delete(key);
      if (!buffer.transformer && !includeArguments) continue;
      this.onValue(buffer.raw);
      let value: string;
      if (buffer.transformer) value = buffer.transformer.flush();
      else {
        const argument = { value: buffer.raw };
        ContentFields.json(argument, 'value', text => this.vault.unmaskInboundText(text));
        value = argument.value;
      }
      if (value) buffer.emit(value);
    }
  };
}
