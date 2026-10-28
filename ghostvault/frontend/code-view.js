import hljs from 'highlight.js/lib/core';
import json from 'highlight.js/lib/languages/json';
import { escapeHtml } from './utils.js';

hljs.registerLanguage('json', json);

export class CodeView {
  static render = (value, decorate) => {
    const source = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
    let isJson = false;
    try { JSON.parse(source); isJson = true; } catch {}
    let markup = isJson ? hljs.highlight(source, { language: 'json' }).value : escapeHtml(source);
    if (decorate) {
      const template = document.createElement('template');
      template.innerHTML = markup;
      const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) {
        const fragment = document.createElement('template');
        fragment.innerHTML = decorate(node.textContent);
        node.replaceWith(fragment.content);
      }
      markup = template.innerHTML;
    }
    const code = `<pre class="app-code" tabindex="0"><code${isJson ? ' class="language-json"' : ''}>${markup}</code></pre>`;
    return isJson ? '<figure class="app-code-block"><figcaption>JSON</figcaption>' + code + '</figure>' : code;
  };
}
