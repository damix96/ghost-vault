export interface OpenCodeProviderOptions {
  id: string;
  name: string;
  baseUrl: string;
  modelId: string;
  apiKey?: string;
  canonical?: string;
}

export class OpenCodeConfig {
  public static create = (options: OpenCodeProviderOptions, major = 2): Record<string, any> => {
    const settings = { baseURL: options.baseUrl, ...(options.apiKey ? { apiKey: options.apiKey } : {}) };
    const model = { name: options.modelId, ...(major >= 2 && !options.canonical ? { capabilities: { tools: true, input: ['text'], output: ['text'] } } : {}) };
    const provider = major >= 2
      ? { name: options.name, ...(options.canonical ? { canonical: options.canonical } : { package: '@opencode/ai/providers/openai-compatible' }), settings, models: { [options.modelId]: model } }
      : { name: options.name, npm: '@ai-sdk/openai-compatible', options: settings, models: { [options.modelId]: model } };
    return { $schema: 'https://opencode.ai/config.json', [major >= 2 ? 'providers' : 'provider']: { [options.id]: provider } };
  };
}
