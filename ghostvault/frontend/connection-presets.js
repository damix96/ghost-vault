export class ConnectionPresets {
  static entries = [
    { id: 'anthropic', name: 'Claude / Anthropic', upstreamUrl: 'https://api.anthropic.com' },
    { id: 'openai', name: 'OpenAI', upstreamUrl: 'https://api.openai.com/v1' },
    { id: 'opencode', name: 'opencode', upstreamUrl: 'https://opencode.ai/inference/v1' },
    { id: 'openrouter', name: 'openrouter', upstreamUrl: 'https://openrouter.ai/api/v1' },
    { id: 'ollama', name: 'Ollama', upstreamUrl: 'http://127.0.0.1:11434/v1' },
  ];

}
