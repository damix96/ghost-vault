import { DatabaseSync } from 'node:sqlite';

export class DefaultRoutes {
  public static definitions = [
    ['opencode', 'OpenCode Zen', 'opencode', 'https://opencode.ai/inference', 'OpenCode Zen: OpenAI и Anthropic API'],
    ['opencode-go', 'OpenCode Go', 'opencode-go', 'https://opencode.ai/inference/go', 'Подписка Go: отдельный маршрут и адрес провайдера'],
    ['anthropic', 'Claude / Anthropic', 'anthropic', 'https://api.anthropic.com', 'Anthropic Messages API'],
    ['openai', 'OpenAI', 'openai', 'https://api.openai.com', 'OpenAI и совместимые клиенты'],
    ['ollama', 'Ollama / vLLM', 'ollama', 'http://127.0.0.1:11434', 'Локальные модели'],
  ];
  constructor(private db: DatabaseSync) {}

  public initialize = (): void => {
    const insert = this.db.prepare('INSERT OR IGNORE INTO routes (id, name, prefix, upstream_url, description, is_custom) VALUES (?, ?, ?, ?, ?, 0)');
    const defaults = DefaultRoutes.definitions;
    for (const row of defaults) insert.run(...row);
    this.db.prepare("UPDATE routes SET name = ?, description = ?, upstream_url = ? WHERE id = 'opencode' AND is_custom = 0 AND upstream_url IN ('https://api.opencode.ai', 'https://opencode.ai/zen')")
      .run('OpenCode Zen', defaults[0][4], defaults[0][3]);
  };
}
