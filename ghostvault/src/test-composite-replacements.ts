import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createParser } from 'eventsource-parser';
import { CompositeAliasLifecycleTests } from './test-composite-alias-lifecycle.js';
import { PayloadCodec } from './protocols/payload-codec.js';
import { SseTransformer } from './proxy/sse-transformer.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';

interface Section {
  name: string;
  source: string;
  key: string;
  representation: string;
}

class CompositeReplacementTests {
  private db = new VaultDatabase(':memory:');
  private vault = new VaultStore(this.db);
  private codec = new PayloadCodec();
  private secretA = 'C"/\\path\n\u96ea\ud83e\uddea/TOKEN';
  private secretB = 'PREFIX-KEY';
  private aliasA = '$${<COMPOSITE_SPECIAL>}';
  private aliasB = '$${<COMPOSITE_PREFIX>}';
  private aliasPattern = /\$\$\{<[A-Z0-9_]+>\}/g;
  private reportPath = new URL('../../.cache/replacement-composite-regression-report.json', import.meta.url);

  private sections = (): Section[] => {
    const object = JSON.stringify({ credential: this.secretA });
    const nested = JSON.stringify({ envelope: { credential: this.secretA } });
    const json1 = JSON.stringify(this.secretA).slice(1, -1);
    const json2 = JSON.stringify(json1).slice(1, -1);
    const json3 = JSON.stringify(json2).slice(1, -1);
    const slash = this.secretA.replace(/\//g, '\\/');
    return [
      { name: 'raw', source: this.secretA, key: 'COMPOSITE_SPECIAL', representation: this.secretA },
      { name: 'urlEncoded', source: encodeURIComponent(this.secretA), key: 'COMPOSITE_SPECIAL', representation: encodeURIComponent(this.secretA) },
      { name: 'base64', source: Buffer.from(this.secretA).toString('base64'), key: 'COMPOSITE_SPECIAL', representation: Buffer.from(this.secretA).toString('base64') },
      { name: 'legacySlashEscaped', source: slash, key: 'COMPOSITE_SPECIAL', representation: slash },
      { name: 'jsonString', source: JSON.stringify(this.secretA), key: 'COMPOSITE_SPECIAL', representation: json1 },
      { name: 'jsonObject', source: object, key: 'COMPOSITE_SPECIAL', representation: json1 },
      { name: 'arrayNested', source: JSON.stringify([{ nested: { credential: this.secretA } }]), key: 'COMPOSITE_SPECIAL', representation: json1 },
      { name: 'nestedJson', source: nested, key: 'COMPOSITE_SPECIAL', representation: json1 },
      { name: 'depth2', source: JSON.stringify(object), key: 'COMPOSITE_SPECIAL', representation: json2 },
      { name: 'depth3', source: JSON.stringify(JSON.stringify(object)), key: 'COMPOSITE_SPECIAL', representation: json3 },
      { name: 'repeated', source: this.secretA + '|' + this.secretA, key: 'COMPOSITE_SPECIAL', representation: this.secretA },
      { name: 'prefixOverlap', source: 'before-' + this.secretB + '-suffix-after', key: 'COMPOSITE_PREFIX', representation: this.secretB },
    ];
  };

  private markedContent = (sections: Section[]): string => sections.map(section => '[' + section.name + ']\n' + section.source + '\n[/' + section.name + ']').join('\n');

  private extract = (content: string, name: string): string => {
    const startMarker = '[' + name + ']\n';
    const endMarker = '\n[/' + name + ']';
    const start = content.indexOf(startMarker);
    const end = content.indexOf(endMarker, start + startMarker.length);
    return start < 0 || end < 0 ? '' : content.slice(start + startMarker.length, end);
  };

  private parseAtDepth = (value: string, depth: number): { valid: boolean; value?: any } => {
    try {
      let result: any = value;
      for (let index = 0; index < depth; index++) result = JSON.parse(result);
      return { valid: true, value: result };
    } catch { return { valid: false }; }
  };

  private parseJson = (value: string): any => {
    try { return JSON.parse(value); } catch { return undefined; }
  };

  private containsUnpairedSurrogate = (value: string): boolean => {
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
        index++;
      } else if (code >= 0xdc00 && code <= 0xdfff) return true;
    }
    return false;
  };

  private mappedAliasFor = (text: string, representation: string): string | undefined =>
    [...text.matchAll(this.aliasPattern)].map(match => match[0]).find(alias => this.vault.unmaskInboundText(alias) === representation);

  private transformRequest = (request: any, url: string): any => this.codec.request(request, url, text => this.vault.maskOutboundText(text));

  private streamEcho = (content: string): { restored: string; fragments: string[] } => {
    const transformer = new SseTransformer(this.vault, 48, () => {});
    const wire: string[] = [];
    for (const character of Array.from(content)) {
      wire.push(transformer.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: character }, finish_reason: null }] }) + '\n\n'));
    }
    wire.push(transformer.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n'));
    const fragments: string[] = [];
    createParser({ onEvent: event => {
      if (event.data === '[DONE]') return;
      try { fragments.push(JSON.parse(event.data).choices?.[0]?.delta?.content || ''); } catch {}
    } }).feed(wire.join(''));
    return { restored: fragments.join(''), fragments };
  };

  private streamToolEcho = (argumentsText: string): string => {
    const transformer = new SseTransformer(this.vault, 48, () => {});
    const wire: string[] = [];
    for (const character of Array.from(argumentsText)) {
      wire.push(transformer.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: character } }] }, finish_reason: null }] }) + '\n\n'));
    }
    wire.push(transformer.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }) + '\n\n'));
    let result = '';
    createParser({ onEvent: event => {
      if (event.data === '[DONE]') return;
      try { result += JSON.parse(event.data).choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments || ''; } catch {}
    } }).feed(wire.join(''));
    return result;
  };

  private run = async (): Promise<void> => {
    this.vault.setManualSecret('COMPOSITE_SPECIAL', this.secretA);
    this.vault.setManualSecret('COMPOSITE_PREFIX', this.secretB);
    const sections = this.sections();
    const sourceContent = this.markedContent(sections);
    const mixedSource = sections.map(section => section.source).join('');
    const prompt = sourceContent + '\n[MIXED]\n' + mixedSource;
    const request = { model: 'composite-fixture', id: 'service-id-stays-visible', metadata: { signature: 'metadata-stays-visible' }, messages: [{ role: 'user', content: prompt }], tools: [{ type: 'function', function: { name: 'echo_fixture', description: 'schema-stays-visible', parameters: { type: 'object', properties: { value: { type: 'string' } } } } }] };
    const url = '/opencode/v1/chat/completions';
    const mapped = this.transformRequest(request, url);
    const mappedFromJson = this.transformRequest(JSON.stringify(request), url);
    const maskedContent = mapped.messages[0].content;
    const maskedFromJson = this.parseJson(mappedFromJson)?.messages?.[0]?.content ?? '';
    const variantsA = Object.values(this.vault.getManualSecrets().find(secret => secret.key === 'COMPOSITE_SPECIAL')!.variants);
    const variantsB = Object.values(this.vault.getManualSecrets().find(secret => secret.key === 'COMPOSITE_PREFIX')!.variants);
    const sectionResults = sections.map(section => {
      const masked = this.extract(maskedContent, section.name);
      const variants = section.key === 'COMPOSITE_SPECIAL' ? variantsA : variantsB;
      const matchedAlias = this.mappedAliasFor(masked, section.representation);
      return { name: section.name, aliasPresent: Boolean(matchedAlias), alias: matchedAlias, knownVariantsPresent: variants.some(value => Boolean(value) && masked.includes(value)), representationStillPresent: masked.includes(section.representation), exactSourcePresent: masked.includes(section.source) };
    });
    const mixedStart = maskedContent.indexOf('[MIXED]\n') + '[MIXED]\n'.length;
    const mixedMasked = maskedContent.slice(mixedStart);
    const mixedAliases = [...mixedMasked.matchAll(this.aliasPattern)].map(match => match[0]);
    const mixedResult = { aliasCount: mixedAliases.length, aliasesRestoreToKnownForms: mixedAliases.every(alias => [...sections.map(section => section.representation)].includes(this.vault.unmaskInboundText(alias))), variantsPresent: [...variantsA, ...variantsB].some(value => Boolean(value) && mixedMasked.includes(value)), exactSourcePresent: mixedMasked.includes(mixedSource), depth2SourcePresent: mixedMasked.includes(sections.find(section => section.name === 'depth2')!.source), depth3SourcePresent: mixedMasked.includes(sections.find(section => section.name === 'depth3')!.source) };
    const serviceFieldsUnchanged = mapped.model === request.model && mapped.id === request.id && mapped.metadata.signature === request.metadata.signature && JSON.stringify(mapped.tools) === JSON.stringify(request.tools);
    const carrierEquivalent = maskedFromJson === maskedContent;
    const echoed = this.streamEcho(maskedContent);
    const mixedEchoed = this.streamEcho(mixedMasked);
    const originalJsonChecks = [
      { name: 'jsonString', depth: 1, expected: this.secretA },
      { name: 'jsonObject', depth: 1, expected: { credential: this.secretA } },
      { name: 'arrayNested', depth: 1, expected: [{ nested: { credential: this.secretA } }] },
      { name: 'nestedJson', depth: 1, expected: { envelope: { credential: this.secretA } } },
      { name: 'depth2', depth: 2, expected: { credential: this.secretA } },
      { name: 'depth3', depth: 3, expected: { credential: this.secretA } },
    ];
    const jsonResults = originalJsonChecks.map(check => {
      const section = sections.find(item => item.name === check.name)!;
      const masked = this.extract(maskedContent, check.name);
      const output = this.parseAtDepth(this.extract(echoed.restored, check.name), check.depth);
      const outbound = this.parseAtDepth(masked, check.depth);
      const outboundAliasAtExpectedDepth = outbound.valid && [...JSON.stringify(outbound.value).matchAll(this.aliasPattern)].some(match => this.vault.unmaskInboundText(match[0]) === section.representation);
      return { name: check.name, outboundAliasAtExpectedDepth, outboundExactSourceStillPresent: masked.includes(section.source), restoredJsonValidAtExpectedDepth: output.valid, restoredValueMatches: output.valid && JSON.stringify(output.value) === JSON.stringify(check.expected) };
    });
    const toolSource = JSON.stringify({ plain: this.secretA, jsonString: JSON.stringify({ credential: this.secretA }), depth2: JSON.stringify(JSON.stringify({ credential: this.secretA })) });
    const toolRequest = { model: request.model, messages: [{ role: 'user', content: 'tool fixture' }, { role: 'assistant', tool_calls: [{ index: 0, id: 'call-fixture', type: 'function', function: { name: 'echo_fixture', arguments: toolSource } }] }] };
    const maskedTool = this.transformRequest(toolRequest, url).messages[1].tool_calls[0].function.arguments;
    const maskedToolValue = this.parseJson(maskedTool) || {};
    const nestedToolRepresentation = JSON.stringify(this.secretA).slice(1, -1);
    const depth2ToolRepresentation = JSON.stringify(nestedToolRepresentation).slice(1, -1);
    const nestedToolAlias = this.mappedAliasFor(maskedToolValue.jsonString, nestedToolRepresentation);
    const depth2ToolAlias = this.mappedAliasFor(maskedToolValue.depth2, depth2ToolRepresentation);
    const restoredToolText = this.streamToolEcho(maskedTool);
    let restoredTool: any;
    try { restoredTool = JSON.parse(restoredToolText); } catch { restoredTool = undefined; }
    const nestedToolValid = Boolean(restoredTool && this.parseAtDepth(restoredTool.jsonString, 1).valid && this.parseAtDepth(restoredTool.jsonString, 1).value?.credential === this.secretA);
    const depth2ToolValid = Boolean(restoredTool && this.parseAtDepth(restoredTool.depth2, 2).valid && this.parseAtDepth(restoredTool.depth2, 2).value?.credential === this.secretA);
    const toolResults = {
      rawOutboundMasked: maskedToolValue.plain === this.aliasA,
      nestedJsonOutboundMasked: Boolean(nestedToolAlias),
      depth2OutboundMasked: Boolean(depth2ToolAlias),
      plainRestored: restoredTool?.plain === this.secretA,
      nestedJsonValidAndRestored: nestedToolValid,
      depth2JsonValidAndRestored: Boolean(depth2ToolAlias) && depth2ToolValid,
    };
    const lifecycleTests = new CompositeAliasLifecycleTests();
    const aliasLifecycle = await lifecycleTests.verifyReloadAndCollision(this.secretA);
    const nonCascading = lifecycleTests.verifyNonCascading();
    const report: Record<string, any> = {
      database: ':memory:', cloudCalls: 0, requestCount: 1,
      prompt: { oneChatUserContent: true, sectionCount: sections.length, mixedConcatenationNoDelimiters: true, fixtureContainsSecrets: true },
      outbound: { sections: sectionResults, mixed: mixedResult, serviceFieldsUnchanged, objectAndJsonStringCarrierEquivalent: carrierEquivalent },
      echo: { simulatedExactMaskedContent: true, restoredCompositeEqualsOriginal: echoed.restored === prompt, mixedRestoredEqualsOriginal: mixedEchoed.restored === mixedSource, fragmentCount: echoed.fragments.length, everyEmittedDeltaHasValidSurrogates: echoed.fragments.every(fragment => !this.containsUnpairedSurrogate(fragment)), json: jsonResults },
      toolArguments: toolResults,
      aliasLifecycle,
      nonCascading,
      expectedCriteria: { allOutboundSectionsMasked: sectionResults.every(result => result.aliasPresent && !result.knownVariantsPresent && !result.representationStillPresent && !result.exactSourcePresent), mixedMasked: mixedResult.aliasCount > 0 && mixedResult.aliasesRestoreToKnownForms && !mixedResult.variantsPresent && !mixedResult.exactSourcePresent && !mixedResult.depth2SourcePresent && !mixedResult.depth3SourcePresent, fullEchoRestored: echoed.restored === prompt && mixedEchoed.restored === mixedSource, everyEmittedDeltaValid: echoed.fragments.every(fragment => !this.containsUnpairedSurrogate(fragment)), allJsonMaskedAndValid: jsonResults.every(result => result.outboundAliasAtExpectedDepth && result.restoredJsonValidAtExpectedDepth && result.restoredValueMatches), toolRoundTrip: Object.values(toolResults).every(Boolean), serviceFieldsAndCarrierStable: serviceFieldsUnchanged && carrierEquivalent, aliasFormsDistinctAndReloadStable: aliasLifecycle.formsDistinct && aliasLifecycle.reloadStable, collisionSafe: aliasLifecycle.collisionSafe, dbSchemaStable: aliasLifecycle.dbSchemaStable, nonCascadingPlainAndStream: nonCascading.plainSafe && nonCascading.streamSafe },
      fixturePrompt: prompt,
    };
    const failures = Object.entries(report.expectedCriteria).filter(([, passed]) => !passed).map(([name]) => name);
    report['failures'] = failures;
    await writeFile(this.reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    this.db.close();
    assert.deepEqual(failures, [], 'Composite replacement failures are recorded in ' + this.reportPath.pathname);
  };

  public execute = async (): Promise<void> => this.run();
}

new CompositeReplacementTests().execute().catch(error => { console.error(error); process.exitCode = 1; });
