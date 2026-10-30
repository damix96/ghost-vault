import assert from 'node:assert/strict';
import { PayloadCodec } from './protocols/payload-codec.js';
import { StreamContent } from './protocols/stream-content.js';
import { ResponseNormalizer } from './proxy/response-normalizer.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { ProtocolAliasAssertions } from './test-protocol-alias-assertions.js';

export class ProtocolTests {
  private db = new VaultDatabase(':memory:');
  private vault = new VaultStore(this.db);
  private codec = new PayloadCodec();
  private secret = 'PROTO-"quote"-\\slash\n雪🔐';
  private alias = '$${<PROTO_CANARY>}';
  private transform = (text: string): string => this.vault.maskOutboundText(text);
  private unmask = (text: string): string => this.vault.unmaskInboundText(text);
  private url = (path: string): string => 'https://gateway.invalid' + path;

  private variants = () => ({
    raw: this.secret,
    url: encodeURIComponent(this.secret),
    json: JSON.stringify(this.secret).slice(1, -1),
    base64: Buffer.from(this.secret).toString('base64'),
  });

  private verifyRequestFixtures = (): void => {
    const variants = this.variants();
    const chat = {
      model: 'model-' + this.alias,
      id: 'request-' + this.alias,
      messages: [
        { role: 'system', content: 'system ' + variants.raw },
        { role: 'user', content: [{ type: 'text', text: variants.raw }, { type: 'input_text', text: variants.url }, { type: 'output_text', text: variants.json }, { type: 'text', text: variants.base64 }, { type: 'image_url', image_url: { url: 'data:image/png;base64,' + variants.base64 } }, { type: 'input_audio', input_audio: { data: variants.base64, format: 'wav' } }] },
        { role: 'assistant', tool_calls: [{ id: 'call-' + this.alias, type: 'function', function: { name: 'tool-' + this.alias, arguments: JSON.stringify({ raw: variants.raw, url: variants.url, json: variants.json, base64: variants.base64 }) } }] },
        { role: 'tool', tool_call_id: 'call-' + this.alias, name: 'tool-' + this.alias, content: 'tool result ' + variants.raw },
      ],
      tools: [{ type: 'function', function: { name: 'schema-' + this.alias, description: variants.raw, parameters: { type: 'object', properties: { password: { type: 'string', enum: [variants.raw] } } } } }],
      cache_signature: this.alias,
    };
    const maskedChat = this.codec.request(chat, this.url('/v1/chat/completions?key=' + variants.url), this.transform) as any;
    assert.notEqual(maskedChat, chat);
    assert.equal(chat.messages[0].content, 'system ' + variants.raw);
    assert.equal(maskedChat.messages[0].content, 'system ' + this.alias);
    const chatTextAliases = maskedChat.messages[1].content.slice(0, 4).map((block: any) => block.text);
    assert.equal(chatTextAliases[0], this.alias);
    ProtocolAliasAssertions.verifyEncoded(this.vault, chatTextAliases[1], variants.url);
    ProtocolAliasAssertions.verifyEncoded(this.vault, chatTextAliases[2], variants.json);
    ProtocolAliasAssertions.verifyEncoded(this.vault, chatTextAliases[3], variants.base64);
    ProtocolAliasAssertions.verifyDistinct(chatTextAliases);
    assert.equal(maskedChat.messages[1].content[4].image_url.url, 'data:image/png;base64,' + variants.base64);
    assert.equal(maskedChat.messages[1].content[5].input_audio.data, variants.base64);
    const chatArguments = JSON.parse(maskedChat.messages[2].tool_calls[0].function.arguments);
    assert.equal(chatArguments.raw, this.alias);
    ProtocolAliasAssertions.verifyEncoded(this.vault, chatArguments.url, variants.url);
    ProtocolAliasAssertions.verifyEncoded(this.vault, chatArguments.json, variants.json);
    ProtocolAliasAssertions.verifyEncoded(this.vault, chatArguments.base64, variants.base64);
    ProtocolAliasAssertions.verifyDistinct([chatArguments.raw, chatArguments.url, chatArguments.json, chatArguments.base64]);
    assert.equal(maskedChat.messages[2].tool_calls[0].function.name, 'tool-' + this.alias);
    assert.equal(maskedChat.messages[3].content, 'tool result ' + this.alias);
    assert.deepEqual(maskedChat.tools, chat.tools);
    assert.equal(maskedChat.model, chat.model);
    assert.equal(maskedChat.id, chat.id);
    assert.equal(maskedChat.cache_signature, this.alias);

    const anthropic = {
      model: 'claude-' + this.alias,
      system: [{ type: 'text', text: variants.raw, cache_control: { type: 'ephemeral', signature: this.alias } }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: variants.raw }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: variants.base64 } }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-id-' + this.alias, name: 'fetch-' + this.alias, input: { raw: variants.raw, json: variants.json } }, { type: 'thinking', thinking: variants.raw, signature: this.alias }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-id-' + this.alias, content: 'tool result ' + variants.raw }] },
      ],
      tools: [{ name: 'schema-' + this.alias, input_schema: { properties: { password: { type: 'string', description: variants.raw } } } }],
    };
    const maskedAnthropic = this.codec.request(anthropic, this.url('/v1/messages'), this.transform) as any;
    assert.equal(maskedAnthropic.system[0].text, this.alias);
    assert.equal(maskedAnthropic.system[0].cache_control.signature, this.alias);
    assert.equal(maskedAnthropic.messages[0].content[0].text, this.alias);
    assert.equal(maskedAnthropic.messages[0].content[1].source.data, variants.base64);
    assert.equal(maskedAnthropic.messages[1].content[0].input.raw, this.alias);
    ProtocolAliasAssertions.verifyEncoded(this.vault, maskedAnthropic.messages[1].content[0].input.json, variants.json);
    assert.equal(maskedAnthropic.messages[1].content[0].name, 'fetch-' + this.alias);
    assert.equal(maskedAnthropic.messages[1].content[1].thinking, variants.raw);
    assert.equal(maskedAnthropic.messages[1].content[1].signature, this.alias);
    assert.equal(maskedAnthropic.messages[2].content[0].content, 'tool result ' + this.alias);
    assert.deepEqual(maskedAnthropic.tools, anthropic.tools);
    assert.equal(maskedAnthropic.model, anthropic.model);

    const responses = {
      model: 'response-model-' + this.alias,
      instructions: 'instructions ' + variants.raw,
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: variants.raw }, { type: 'output_text', text: variants.url }] },
        { type: 'function_call', call_id: 'call-' + this.alias, name: 'lookup-' + this.alias, arguments: JSON.stringify({ password: variants.json }) },
        { type: 'function_call_output', call_id: 'call-' + this.alias, output: { result: variants.base64 } },
      ],
      tools: [{ type: 'function', name: 'schema-' + this.alias, parameters: { description: variants.raw } }],
      prompt_cache_key: this.alias,
    };
    const maskedResponses = this.codec.request(responses, this.url('/v1/responses'), this.transform) as any;
    assert.equal(maskedResponses.instructions, 'instructions ' + this.alias);
    assert.equal(maskedResponses.input[0].content[0].text, this.alias);
    ProtocolAliasAssertions.verifyEncoded(this.vault, maskedResponses.input[0].content[1].text, variants.url);
    ProtocolAliasAssertions.verifyEncoded(this.vault, JSON.parse(maskedResponses.input[1].arguments).password, variants.json);
    ProtocolAliasAssertions.verifyEncoded(this.vault, maskedResponses.input[2].output.result, variants.base64);
    assert.equal(maskedResponses.input[1].name, 'lookup-' + this.alias);
    assert.deepEqual(maskedResponses.tools, responses.tools);
    assert.equal(maskedResponses.prompt_cache_key, this.alias);

    const gemini = {
      model: 'gemini-' + this.alias,
      systemInstruction: { parts: [{ text: variants.raw }, { text: variants.raw, thought: true, signature: this.alias }] },
      contents: [{ role: 'user', parts: [
        { text: variants.raw },
        { text: variants.url },
        { functionCall: { name: 'tool-' + this.alias, args: { raw: variants.raw, json: variants.json } } },
        { functionResponse: { name: 'tool-' + this.alias, response: { result: variants.base64 } } },
        { inlineData: { mimeType: 'image/png', data: variants.base64 } },
        { executableCode: { language: 'PYTHON', code: variants.raw } },
        { codeExecutionResult: { outcome: 'OUTCOME_OK', output: variants.raw } },
      ] }],
      tools: [{ functionDeclarations: [{ name: 'schema-' + this.alias, description: variants.raw }] }],
      cache_signature: this.alias,
    };
    const maskedGemini = this.codec.request(gemini, this.url('/v1beta/models/gemini-audit:generateContent'), this.transform) as any;
    assert.equal(maskedGemini.systemInstruction.parts[0].text, this.alias);
    assert.equal(maskedGemini.systemInstruction.parts[1].text, variants.raw);
    assert.equal(maskedGemini.systemInstruction.parts[1].signature, this.alias);
    assert.equal(maskedGemini.contents[0].parts[0].text, this.alias);
    ProtocolAliasAssertions.verifyEncoded(this.vault, maskedGemini.contents[0].parts[1].text, variants.url);
    assert.equal(maskedGemini.contents[0].parts[2].functionCall.args.raw, this.alias);
    ProtocolAliasAssertions.verifyEncoded(this.vault, maskedGemini.contents[0].parts[2].functionCall.args.json, variants.json);
    ProtocolAliasAssertions.verifyEncoded(this.vault, maskedGemini.contents[0].parts[3].functionResponse.response.result, variants.base64);
    assert.equal(maskedGemini.contents[0].parts[4].inlineData.data, variants.base64);
    assert.equal(maskedGemini.contents[0].parts[5].executableCode.code, this.alias);
    assert.equal(maskedGemini.contents[0].parts[6].codeExecutionResult.output, this.alias);
    assert.deepEqual(maskedGemini.tools, gemini.tools);
    assert.equal(maskedGemini.cache_signature, this.alias);

    const antigravity = { request: { contents: gemini.contents, systemInstruction: gemini.systemInstruction }, requestId: this.alias, metadata: { signature: this.alias } };
    const maskedAntigravity = this.codec.request(antigravity, this.url('/v1internal:generateContent'), this.transform) as any;
    assert.equal(maskedAntigravity.request.contents[0].parts[0].text, this.alias);
    assert.equal(maskedAntigravity.requestId, this.alias);
    assert.equal(maskedAntigravity.metadata.signature, this.alias);

    const unknown = { unknown: { text: variants.raw, metadata: this.alias } };
    const unchangedUnknown = this.codec.request(unknown, this.url('/unknown'), this.transform) as any;
    assert.notEqual(unchangedUnknown, unknown);
    assert.deepEqual(unchangedUnknown, unknown);
  };

  private verifyResponseFixtures = (): void => {
    const variants = this.variants();
    const aliasJson = JSON.stringify({ password: this.alias });
    const chat = { id: this.alias, model: this.alias, choices: [{ index: 0, message: { role: 'assistant', content: this.alias, refusal: this.alias, reasoning_content: this.alias, tool_calls: [{ id: this.alias, type: 'function', function: { name: this.alias, arguments: aliasJson } }] } }], usage: { signature: this.alias } };
    const restoredChat = this.codec.response(chat, this.unmask) as any;
    assert.equal(restoredChat.choices[0].message.content, this.secret);
    assert.equal(restoredChat.choices[0].message.refusal, this.secret);
    assert.equal(restoredChat.choices[0].message.reasoning_content, this.secret);
    assert.deepEqual(JSON.parse(restoredChat.choices[0].message.tool_calls[0].function.arguments), { password: this.secret });
    assert.equal(restoredChat.id, this.alias);
    assert.equal(restoredChat.model, this.alias);
    assert.equal(restoredChat.choices[0].message.role, 'assistant');
    assert.equal(restoredChat.choices[0].message.tool_calls[0].function.name, this.alias);
    assert.equal(restoredChat.usage.signature, this.alias);
    const urlAlias = ProtocolAliasAssertions.verifyEncoded(this.vault, this.transform(variants.url), variants.url);
    const restoredEncoded = this.codec.response({ choices: [{ message: { role: 'assistant', content: urlAlias, tool_calls: [{ function: { arguments: JSON.stringify({ value: urlAlias }) } }] } }] }, this.unmask) as any;
    assert.equal(restoredEncoded.choices[0].message.content, variants.url);
    assert.equal(JSON.parse(restoredEncoded.choices[0].message.tool_calls[0].function.arguments).value, variants.url);

    const anthropic = { type: 'message', id: this.alias, model: this.alias, content: [{ type: 'text', text: this.alias }, { type: 'tool_use', id: this.alias, name: this.alias, input: { password: this.alias } }, { type: 'thinking', thinking: this.alias, signature: this.alias }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: variants.base64 } }] };
    const restoredAnthropic = this.codec.response(anthropic, this.unmask) as any;
    assert.equal(restoredAnthropic.content[0].text, this.secret);
    assert.equal(restoredAnthropic.content[1].input.password, this.secret);
    assert.equal(restoredAnthropic.content[1].name, this.alias);
    assert.equal(restoredAnthropic.content[2].thinking, this.alias);
    assert.equal(restoredAnthropic.content[2].signature, this.alias);
    assert.equal(restoredAnthropic.content[3].source.data, variants.base64);
    assert.equal(restoredAnthropic.id, this.alias);

    const responses = { id: this.alias, object: 'response', output_text: this.alias, output: [
      { type: 'message', id: this.alias, role: 'assistant', content: [{ type: 'output_text', text: this.alias }] },
      { type: 'function_call', id: this.alias, name: this.alias, arguments: aliasJson },
      { type: 'function_call_output', output: { result: this.alias } },
      { type: 'reasoning', summary: [{ type: 'summary_text', text: this.alias }], encrypted_content: this.alias },
    ] };
    const restoredResponses = this.codec.response(responses, this.unmask) as any;
    assert.equal(restoredResponses.output_text, this.secret);
    assert.equal(restoredResponses.output[0].content[0].text, this.secret);
    assert.deepEqual(JSON.parse(restoredResponses.output[1].arguments), { password: this.secret });
    assert.deepEqual(restoredResponses.output[2].output, { result: this.secret });
    assert.equal(restoredResponses.output[3].summary[0].text, this.secret);
    assert.equal(restoredResponses.output[3].encrypted_content, this.alias);
    assert.equal(restoredResponses.output[1].name, this.alias);
    assert.equal(restoredResponses.id, this.alias);

    const geminiResponse = { response: { candidates: [{ content: { role: 'model', parts: [
      { text: this.alias }, { functionCall: { name: this.alias, args: { password: this.alias } } },
      { functionResponse: { name: this.alias, response: { result: this.alias } } },
      { executableCode: { language: 'PYTHON', code: this.alias } },
      { codeExecutionResult: { outcome: 'OUTCOME_OK', output: this.alias } },
      { text: this.alias, thought: true, signature: this.alias },
    ] } }], modelVersion: this.alias, traceId: this.alias } };
    const restoredGemini = this.codec.response(geminiResponse, this.unmask) as any;
    const parts = restoredGemini.response.candidates[0].content.parts;
    assert.equal(parts[0].text, this.secret);
    assert.equal(parts[1].functionCall.args.password, this.secret);
    assert.equal(parts[2].functionResponse.response.result, this.secret);
    assert.equal(parts[3].executableCode.code, this.secret);
    assert.equal(parts[4].codeExecutionResult.output, this.secret);
    assert.equal(parts[5].text, this.alias);
    assert.equal(parts[5].signature, this.alias);
    assert.equal(restoredGemini.response.modelVersion, this.alias);
    assert.equal(restoredGemini.response.traceId, this.alias);
    assert.notEqual(restoredGemini, geminiResponse);
    const unknown = { unknown: { text: this.alias, metadata: this.secret } };
    assert.deepEqual(this.codec.response(unknown, this.unmask), unknown);
  };

  private verifyResponseNormalization = (): void => {
    const responses = ResponseNormalizer.normalize({ id: 'resp-id', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Responses result text' }] }, { type: 'function_call', name: 'lookup', arguments: '{"key":"value"}' }] });
    assert.equal(responses.content[0].type, 'text');
    assert.equal(responses.content[0].text, 'Responses result text');
    assert.equal(responses.content[1].type, 'tool_use');
    assert.deepEqual(responses.content[1].input, { key: 'value' });

    const gemini = ResponseNormalizer.normalize({ candidates: [{ content: { parts: [{ text: 'Gemini result text' }, { functionCall: { name: 'lookup', args: { key: 'value' } } }, { text: 'hidden thought', thought: true }] } }], modelVersion: 'gemini-audit' });
    assert.equal(gemini.content[0].type, 'text');
    assert.equal(gemini.content[0].text, 'Gemini result text');
    assert.equal(gemini.content[1].type, 'tool_use');
    assert.deepEqual(gemini.content[1].input, { key: 'value' });
    assert.equal(gemini.content.some((block: any) => block.text === 'hidden thought'), false);

    const antigravity = ResponseNormalizer.normalize({ response: { candidates: [{ content: { parts: [{ text: 'Antigravity result text' }] } }], modelVersion: 'antigravity-audit' } });
    assert.equal(antigravity.content[0].text, 'Antigravity result text');

    const responsesStream = [
      'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'Responses ' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.output_text.delta', delta: 'stream result' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"key":"val' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.function_call_arguments.delta', output_index: 1, delta: 'ue"}' }) + '\n\n',
      'data: ' + JSON.stringify({ type: 'response.completed', response: { object: 'response', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Responses stream result' }] }, { type: 'function_call', name: 'lookup', arguments: '{"key":"value"}' }] } }) + '\n\n',
    ].join('') + 'data: [DONE]\n\n';
    const streamTools = new StreamContent().read(responsesStream);
    assert.equal(streamTools[0].text, 'Responses stream result');
    assert.deepEqual(streamTools[1].input, { key: 'value' });
    assert.equal(ResponseNormalizer.normalize(responsesStream).content[0].text, 'Responses stream result');

    const geminiStream = 'data: ' + JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'Antigravity stream result' }, { functionCall: { name: 'lookup', args: { key: 'stream-value' } } }] } }], modelVersion: 'antigravity-stream' } }) + '\n\n';
    const antigravityStreamContent = new StreamContent().read(geminiStream);
    assert.equal(antigravityStreamContent[0].text, 'Antigravity stream result');
    assert.equal(antigravityStreamContent[1].type, 'tool_use');
    assert.deepEqual(antigravityStreamContent[1].input, { key: 'stream-value' });
    const normalizedAntigravityStream = ResponseNormalizer.normalize(geminiStream);
    assert.equal(normalizedAntigravityStream.content[0].text, 'Antigravity stream result');
    assert.equal(normalizedAntigravityStream.content[1].type, 'tool_use');
  };

  private verifyManualPriority = (): void => {
    const store = new VaultStore(new VaultDatabase(':memory:'));
    store.setManualSecret('PROTO_DUPLICATE', this.secret);
    assert.throws(() => store.setAutoSecret('PROTO_DUPLICATE', this.secret), /уже использовалось/);
    store.deleteSecret('PROTO_DUPLICATE');
    assert.equal(store.getManualSecrets().some(secret => secret.key === 'PROTO_DUPLICATE'), false);
    assert.equal(store.getAutoSecrets().some(secret => secret.key === 'PROTO_DUPLICATE'), false);
    assert.equal(store.maskOutboundText(this.secret), this.secret);
    store.setManualSecret('PROTO_BASE', 'https://audit.internal');
    store.setAutoSecret('PROTO_LONG', 'https://audit.internal/path');
    assert.equal(store.maskOutboundText('https://audit.internal/path'), '$${<PROTO_BASE>}/path');
    store.getDatabase().close();
  };

  public run = async (): Promise<void> => {
    try {
      this.vault.setManualSecret('PROTO_CANARY', this.secret);
      this.verifyRequestFixtures();
      this.verifyResponseFixtures();
      this.verifyResponseNormalization();
      this.verifyManualPriority();
      console.log('Protocol tests passed: Anthropic, OpenAI Chat/Responses, Gemini/Antigravity targeting, exact service fields, manual priority.');
    } finally { this.db.close(); }
  };
}

new ProtocolTests().run().catch(error => { console.error(error); process.exitCode = 1; });
