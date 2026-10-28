import assert from 'node:assert/strict';
import { createParser } from 'eventsource-parser';
import { SseTransformer } from './proxy/sse-transformer.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';

export class ProtocolStreamTests {
  private db = new VaultDatabase(':memory:');
  private vault = new VaultStore(this.db);
  private alpha = 'STREAM-ALPHA-"q"-\\line\n雪';
  private beta = 'STREAM-BETA-🔐-value';
  private alphaAlias = '$${<STREAM_ALPHA>}';
  private betaAlias = '$${<STREAM_BETA>}';

  private read = (input: string): any[] => {
    const events: any[] = [];
    createParser({ onEvent: event => {
      if (event.data === '[DONE]') return;
      try { events.push(JSON.parse(event.data)); } catch {}
    } }).feed(input);
    return events;
  };

  private frame = (payload: unknown, eventName?: string): string => (eventName ? 'event: ' + eventName + '\n' : '') + 'data: ' + (payload === '[DONE]' ? '[DONE]' : JSON.stringify(payload)) + '\n\n';

  private verifyOpenAiChatStream = (): void => {
    const transformer = new SseTransformer(this.vault, 32, () => {});
    const frames = [
      this.frame({ id: this.alphaAlias, model: this.betaAlias, choices: [{ index: 0, delta: { content: 'text=' + this.alphaAlias.slice(0, 9) }, finish_reason: null }] }),
      this.frame({ id: this.alphaAlias, model: this.betaAlias, choices: [{ index: 0, delta: { content: this.alphaAlias.slice(9) + '; tools follow' }, finish_reason: null }] }),
      this.frame({ id: this.alphaAlias, model: this.betaAlias, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: this.alphaAlias, type: 'function', function: { name: this.alphaAlias, arguments: '{"password":"' + this.alphaAlias.slice(0, 8) } }] }, finish_reason: null }] }),
      this.frame({ id: this.alphaAlias, model: this.betaAlias, choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: this.betaAlias, type: 'function', function: { name: this.betaAlias, arguments: '{"password":"' + this.betaAlias.slice(0, 8) } }] }, finish_reason: null }] }),
      this.frame({ id: this.alphaAlias, model: this.betaAlias, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: this.alphaAlias.slice(8) + '"}' } }] }, finish_reason: null }] }),
      this.frame({ id: this.alphaAlias, model: this.betaAlias, choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: this.betaAlias.slice(8) + '"}' } }] }, finish_reason: null }] }),
      this.frame({ id: this.alphaAlias, model: this.betaAlias, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], signature: this.alphaAlias }),
      this.frame('[DONE]'),
    ];
    const input = frames.join('');
    let output = '';
    for (let index = 0; index < input.length; index += 11) output += transformer.push(input.slice(index, index + 11));
    output += transformer.flush();
    const events = this.read(output);
    const text = events.map(event => event.choices?.[0]?.delta?.content || '').join('');
    const args = new Map<number, string>();
    for (const event of events) for (const call of event.choices?.[0]?.delta?.tool_calls || []) args.set(call.index, (args.get(call.index) || '') + (call.function?.arguments || ''));
    assert.equal(text, 'text=' + this.alpha + '; tools follow');
    assert.deepEqual(JSON.parse(args.get(0) || '{}'), { password: this.alpha });
    assert.deepEqual(JSON.parse(args.get(1) || '{}'), { password: this.beta });
    const completed = events.find(event => event.choices?.[0]?.finish_reason === 'tool_calls');
    assert.ok(completed);
    assert.equal(completed.id, this.alphaAlias);
    assert.equal(completed.model, this.betaAlias);
    assert.equal(completed.signature, this.alphaAlias);
  };

  private verifyAnthropicStream = (): void => {
    const transformer = new SseTransformer(this.vault, 32, () => {});
    const input = [
      this.frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' }, signature: this.alphaAlias }, 'content_block_start'),
      this.frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: this.alphaAlias.slice(0, 7) }, signature: this.alphaAlias }, 'content_block_delta'),
      this.frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: this.alphaAlias.slice(7) }, signature: this.alphaAlias }, 'content_block_delta'),
      this.frame({ type: 'content_block_stop', index: 0, signature: this.alphaAlias }, 'content_block_stop'),
      this.frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, signature: this.alphaAlias }, 'message_delta'),
      this.frame({ type: 'message_stop', signature: this.alphaAlias }, 'message_stop'),
    ].join('');
    let output = '';
    for (let index = 0; index < input.length; index += 13) output += transformer.push(input.slice(index, index + 13));
    output += transformer.flush();
    const events = this.read(output);
    const text = events.filter(event => event.type === 'content_block_delta').map(event => event.delta?.text || '').join('');
    assert.equal(text, this.alpha);
    for (const event of events) assert.equal(event.signature, this.alphaAlias);
    assert.equal(events.find(event => event.type === 'message_delta')?.delta.stop_reason, 'end_turn');
  };

  private verifyResponsesStream = (): void => {
    const transformer = new SseTransformer(this.vault, 32, () => {});
    const input = [
      this.frame({ type: 'response.output_text.delta', item_id: 'item-' + this.alphaAlias, output_index: 0, content_index: 0, delta: this.alphaAlias.slice(0, 10), sequence_number: 41, signature: this.alphaAlias }),
      this.frame({ type: 'response.output_text.delta', item_id: 'item-' + this.alphaAlias, output_index: 0, content_index: 0, delta: this.alphaAlias.slice(10), sequence_number: 42, signature: this.alphaAlias }),
      this.frame({ type: 'response.function_call_arguments.delta', item_id: 'call-' + this.alphaAlias, output_index: 1, delta: '{"password":"' + this.alphaAlias.slice(0, 9), sequence_number: 43, signature: this.alphaAlias }),
      this.frame({ type: 'response.function_call_arguments.delta', item_id: 'call-' + this.alphaAlias, output_index: 1, delta: this.alphaAlias.slice(9) + '"}', sequence_number: 44, signature: this.alphaAlias }),
      this.frame({ type: 'response.function_call_arguments.done', item_id: 'call-' + this.alphaAlias, output_index: 1, name: this.alphaAlias, arguments: '{"password":"' + this.alphaAlias + '"}', sequence_number: 45, signature: this.alphaAlias }),
      this.frame({ type: 'response.completed', sequence_number: 46, response: { id: this.alphaAlias, object: 'response', output: [{ type: 'message', id: this.alphaAlias, content: [{ type: 'output_text', text: this.alphaAlias }] }], metadata_signature: this.alphaAlias } }),
    ].join('');
    let output = '';
    for (let index = 0; index < input.length; index += 17) output += transformer.push(input.slice(index, index + 17));
    output += transformer.flush();
    const events = this.read(output);
    const text = events.filter(event => event.type === 'response.output_text.delta').map(event => event.delta || '').join('');
    assert.equal(text, this.alpha);
    const done = events.find(event => event.type === 'response.function_call_arguments.done');
    assert.deepEqual(JSON.parse(done.arguments), { password: this.alpha });
    assert.equal(done.name, this.alphaAlias);
    const completed = events.find(event => event.type === 'response.completed');
    assert.equal(completed.response.output[0].content[0].text, this.alpha);
    assert.equal(completed.response.output[0].id, this.alphaAlias);
    assert.equal(completed.response.metadata_signature, this.alphaAlias);
    const sequence = events.map(event => event.sequence_number).filter((value): value is number => typeof value === 'number');
    assert.ok(sequence.length > 0);
    assert.ok(sequence.every((value, index) => index === 0 || value > sequence[index - 1]));
  };

  private verifySurrogateSafeDeltas = (): void => {
    const secret = '🔐'.repeat(80);
    const expected = 'start😀=' + secret + '; end🧩';
    this.vault.setManualSecret('STREAM_EMOJI', secret);
    for (const chunkSize of [1, 7, 13, 31]) {
      const transformer = new SseTransformer(this.vault, 64, () => {});
      const input = [
        this.frame({ id: 'emoji-stream', model: 'test', choices: [{ index: 0, delta: { content: 'start😀=$${<STREAM_EMOJI>}' }, finish_reason: null }] }),
        this.frame({ id: 'emoji-stream', model: 'test', choices: [{ index: 0, delta: { content: '; end🧩' }, finish_reason: null }] }),
        this.frame({ id: 'emoji-stream', model: 'test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
        this.frame('[DONE]'),
      ].join('');
      let output = '';
      for (let index = 0; index < input.length; index += chunkSize) output += transformer.push(input.slice(index, index + chunkSize));
      output += transformer.flush();
      const deltas = this.read(output).map(event => event.choices?.[0]?.delta?.content).filter((value): value is string => typeof value === 'string' && value.length > 0);
      assert.ok(deltas.length > 1, 'emoji-stream-was-not-split-into-deltas');
      assert.ok(deltas.every(value => Buffer.from(value, 'utf8').toString('utf8') === value), 'delta-contains-unpaired-surrogate');
      assert.deepEqual(Buffer.concat(deltas.map(value => Buffer.from(value, 'utf8'))), Buffer.from(expected, 'utf8'));
    }
  };

  private verifyGeminiAndAntigravityStream = (): void => {
    const transformer = new SseTransformer(this.vault, 32, () => {});
    const standard = [
      this.frame({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text: 'text=' + this.alphaAlias.slice(0, 8) }, { text: this.alphaAlias, thought: true, signature: this.alphaAlias }] } }], modelVersion: this.alphaAlias, usageMetadata: { signature: this.alphaAlias } }),
      this.frame({ candidates: [{ index: 0, content: { role: 'model', parts: [{ text: this.alphaAlias.slice(8) + ';' }, { functionCall: { name: this.betaAlias, args: { password: this.betaAlias } } }, { functionResponse: { name: this.betaAlias, response: { result: this.betaAlias } } }, { executableCode: { language: 'PYTHON', code: this.alphaAlias } }, { codeExecutionResult: { outcome: 'OUTCOME_OK', output: this.betaAlias } }] }, finishReason: 'STOP' }], modelVersion: this.alphaAlias, usageMetadata: { signature: this.alphaAlias } }),
    ].join('');
    let standardOutput = '';
    for (let index = 0; index < standard.length; index += 19) standardOutput += transformer.push(standard.slice(index, index + 19));
    standardOutput += transformer.flush();
    const standardEvents = this.read(standardOutput);
    const standardText = standardEvents.map(event => event.candidates?.[0]?.content?.parts?.filter((part: any) => !part.thought).map((part: any) => part.text || '').join('') || '').join('');
    const standardParts = standardEvents.flatMap(event => event.candidates?.flatMap((candidate: any) => candidate.content?.parts || []) || []);
    assert.equal(standardText, 'text=' + this.alpha + ';');
    const terminal = standardEvents.find(event => event.candidates?.[0]?.finishReason === 'STOP');
    assert.equal(terminal.modelVersion, this.alphaAlias);
    assert.equal(terminal.usageMetadata.signature, this.alphaAlias);
    assert.equal(standardParts.find((part: any) => part.thought)?.text, this.alphaAlias);
    assert.deepEqual(terminal.candidates[0].content.parts.find((part: any) => part.functionCall)?.functionCall.args, { password: this.beta });
    assert.deepEqual(terminal.candidates[0].content.parts.find((part: any) => part.functionResponse)?.functionResponse.response, { result: this.beta });
    assert.ok(standardParts.some((part: any) => part.executableCode?.code === this.alpha));
    const codeResultShape = standardParts.map((part: any) => ({ keys: Object.keys(part), outputType: typeof part.codeExecutionResult?.output, outputLength: part.codeExecutionResult?.output?.length }));
    assert.ok(standardParts.some((part: any) => part.codeExecutionResult?.output === this.beta), JSON.stringify(codeResultShape));

    const envelope = { response: { candidates: [{ index: 0, content: { role: 'model', parts: [{ text: this.alphaAlias }] }, finishReason: 'STOP' }], modelVersion: this.alphaAlias, usageMetadata: { signature: this.alphaAlias } }, traceId: this.alphaAlias };
    let envelopeOutput = '';
    const serializedEnvelope = this.frame(envelope);
    for (let index = 0; index < serializedEnvelope.length; index += 13) envelopeOutput += transformer.push(serializedEnvelope.slice(index, index + 13));
    envelopeOutput += transformer.flush();
    const envelopeEvents = this.read(envelopeOutput);
    assert.equal(envelopeEvents.some(event => event.response?.candidates?.[0]?.content?.parts?.[0]?.text === this.alpha), true);
    const envelopeTerminal = envelopeEvents.find(event => event.response?.candidates?.[0]?.finishReason === 'STOP');
    assert.equal(envelopeTerminal.response.modelVersion, this.alphaAlias);
    assert.equal(envelopeTerminal.response.usageMetadata.signature, this.alphaAlias);
    assert.equal(envelopeTerminal.traceId, this.alphaAlias);
  };

  public run = async (): Promise<void> => {
    try {
      this.vault.setManualSecret('STREAM_ALPHA', this.alpha);
      this.vault.setManualSecret('STREAM_BETA', this.beta);
      this.verifyOpenAiChatStream();
      this.verifyAnthropicStream();
      this.verifyResponsesStream();
      this.verifySurrogateSafeDeltas();
      this.verifyGeminiAndAntigravityStream();
      console.log('Protocol stream tests passed: Chat, Anthropic, Responses, Gemini/Antigravity fragments, parallel tools, terminal metadata and signatures.');
    } finally { this.db.close(); }
  };
}

new ProtocolStreamTests().run().catch(error => { console.error(error); process.exitCode = 1; });
