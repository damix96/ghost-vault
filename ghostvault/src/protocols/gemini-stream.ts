import { EventSourceMessage } from 'eventsource-parser';
import { GeminiPayload } from './gemini-payload.js';
import { StreamAdapter, StreamContext } from './stream-context.js';
import { Payload } from './types.js';

export class GeminiStream implements StreamAdapter {
  private payload = new GeminiPayload();

  public matches = (body: Payload): boolean => this.payload.matchesResponse(body);

  public handle = (body: Payload, event: EventSourceMessage, context: StreamContext): void => {
    const wrapped = Boolean(body.response);
    const response = wrapped ? body.response : body;
    for (const [candidatePosition, candidate] of response.candidates.entries()) {
      const prefix = 'gemini:' + (candidate.index ?? candidatePosition) + ':';
      for (const [partIndex, part] of (candidate.content?.parts || []).entries()) {
        const emit = (value: string, field: 'text' | 'code' | 'output'): void => {
          const targetPart = structuredClone(part);
          if (field === 'text') targetPart.text = value;
          if (field === 'code') targetPart.executableCode.code = value;
          if (field === 'output') targetPart.codeExecutionResult.output = value;
          const targetCandidate = { ...candidate, content: { ...candidate.content, parts: [targetPart] } };
          delete targetCandidate.finishReason;
          const target = { ...response, candidates: [targetCandidate] };
          delete target.usageMetadata;
          context.write(event, wrapped ? { ...body, response: target } : target);
        };
        if (typeof part.text === 'string' && !part.thought) {
          context.text(prefix + partIndex + ':text', part.text, value => emit(value, 'text'));
          part.text = '';
        }
        if (typeof part.executableCode?.code === 'string') {
          context.text(prefix + partIndex + ':code', part.executableCode.code, value => emit(value, 'code'));
          part.executableCode.code = '';
        }
        if (typeof part.codeExecutionResult?.output === 'string') {
          context.text(prefix + partIndex + ':output', part.codeExecutionResult.output, value => emit(value, 'output'));
          part.codeExecutionResult.output = '';
        }
        this.payload.part(part, context.transform);
      }
      if (candidate.finishReason) context.flush(prefix);
    }
    context.write(event, body);
  };
}
