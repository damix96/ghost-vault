import { Payload, TextTransform } from './types.js';

export class ContentFields {
  public static text = (body: Payload, key: string, transform: TextTransform): void => {
    if (typeof body[key] === 'string') body[key] = transform(body[key]);
  };

  public static values = (value: any, transform: TextTransform): any => {
    if (typeof value === 'string') return transform(value);
    if (Array.isArray(value)) return value.map(item => ContentFields.values(item, transform));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ContentFields.values(item, transform)]));
    return value;
  };

  public static json = (body: Payload, key: string, transform: TextTransform): void => {
    if (typeof body[key] !== 'string') return;
    try {
      const parsed = JSON.parse(body[key]);
      body[key] = JSON.stringify(ContentFields.values(parsed, transform));
    } catch {
      body[key] = transform(body[key]);
    }
  };

  public static content = (content: any, transform: TextTransform): any => {
    if (typeof content === 'string') return transform(content);
    if (!Array.isArray(content)) return content;
    return content.map(block => {
      if (typeof block === 'string') return transform(block);
      if (!block || typeof block !== 'object') return block;
      if (['text', 'input_text', 'output_text'].includes(block.type)) ContentFields.text(block, 'text', transform);
      if (block.type === 'refusal') ContentFields.text(block, 'refusal', transform);
      return block;
    });
  };
}
