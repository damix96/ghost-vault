import { ContentFields } from './content-fields.js';
import { Payload, PayloadAdapter, TextTransform } from './types.js';

export class GeminiPayload implements PayloadAdapter {
  public matchesRequest = (body: Payload): boolean => Array.isArray(body.contents) || Array.isArray(body.request?.contents);
  public matchesResponse = (body: Payload): boolean => Array.isArray(body.candidates) || Array.isArray(body.response?.candidates);

  public part = (part: Payload, transform: TextTransform): void => {
    if (!part || typeof part !== 'object') return;
    if (!part.thought) ContentFields.text(part, 'text', transform);
    if (part.functionCall?.args) part.functionCall.args = ContentFields.values(part.functionCall.args, transform);
    if (part.functionResponse?.response) part.functionResponse.response = ContentFields.values(part.functionResponse.response, transform);
    if (part.executableCode) ContentFields.text(part.executableCode, 'code', transform);
    if (part.codeExecutionResult) ContentFields.text(part.codeExecutionResult, 'output', transform);
  };

  private content = (content: Payload | undefined, transform: TextTransform): void => {
    for (const part of content?.parts || []) this.part(part, transform);
  };

  public request = (body: Payload, transform: TextTransform): void => {
    const request = body.request || body;
    this.content(request.systemInstruction, transform);
    for (const content of request.contents || []) this.content(content, transform);
  };

  public response = (body: Payload, transform: TextTransform): void => {
    for (const candidate of (body.response || body).candidates || []) this.content(candidate.content, transform);
  };
}
