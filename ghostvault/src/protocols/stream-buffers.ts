import { VaultStore } from '../vault/store.js';
import { SlidingStreamTransformer } from '../proxy/sliding-buffer.js';
import { ContentFields } from './content-fields.js';
import { ResponseChangeEvidence, RestorationMatch } from '../telemetry/response-change-evidence.js';

interface DeltaBuffer {
  raw: string;
  transformer?: SlidingStreamTransformer;
  emit: (value: string) => void;
  changes: RestorationMatch[];
  fieldId: string;
}

export class StreamBuffers {
  private buffers = new Map<string, DeltaBuffer>();
  private sequence = 0;

  constructor(private vault: Pick<VaultStore, 'getInboundReplacements' | 'unmaskInboundText'>, private windowSize: number, private onValue: (text: string) => void, private evidence?: ResponseChangeEvidence) {}

  public append = (key: string, value: string, emit: (value: string) => void, argumentsMode = false): void => {
    let buffer = this.buffers.get(key);
    if (!buffer) {
      const changes: RestorationMatch[] = [];
      buffer = { raw: '', emit, changes, fieldId: key + '#' + (++this.sequence), transformer: argumentsMode ? undefined : new SlidingStreamTransformer(this.vault.getInboundReplacements(), this.windowSize, match => { if (this.evidence) changes.push(match); }) };
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
      if (buffer.transformer) {
        value = buffer.transformer.flush();
        this.evidence?.stream(buffer.raw, buffer.changes, buffer.fieldId);
      }
      else {
        const argument = { value: buffer.raw };
        let leaf = 0;
        ContentFields.json(argument, 'value', text => this.evidence ? this.evidence.restore(text, 'tool-arguments', buffer.fieldId + ':leaf:' + (++leaf)) : this.vault.unmaskInboundText(text));
        value = argument.value;
      }
      if (value) buffer.emit(value);
    }
  };
}
