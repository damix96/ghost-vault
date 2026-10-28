import { ResponseContent } from '../protocols/response-content.js';
import { StreamContent } from '../protocols/stream-content.js';

export class ResponseNormalizer {
  public static normalize = (body: any): any => {
    if (body === null || body === undefined) return body;
    let data = body;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch {}
    }
    if (typeof data === 'string') {
      if (data.includes('data:')) {
        const content = new StreamContent().read(data);
        if (content.length) return { content, raw: data };
      }
      return { content: [{ type: 'text', text: data }] };
    }
    if (Array.isArray(data)) return { content: data.flatMap(item => ResponseContent.read(item)), raw: data };
    if (data && typeof data === 'object') {
      const content = ResponseContent.read(data);
      if (content.length || Array.isArray(data.content)) return { ...data, content };
    }
    return data;
  };
}
