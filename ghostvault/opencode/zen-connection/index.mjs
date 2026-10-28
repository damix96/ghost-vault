import { NativeZenRelay } from './native-relay.mjs';

class GhostVaultZenConnection {
  setup = async context => {
    let endpoint;
    try { endpoint = new URL(context.options?.baseURL ?? 'http://127.0.0.1:8765/opencode/v1'); }
    catch { return; }
    if (!['http:', 'https:'].includes(endpoint.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) return;
    const baseURL = endpoint.href.replace(/\/+$/, '');
    await context.provider.transform(editor => {
      const source = editor.get('opencode');
      if (!source) return;
      const integrationID = source.provider.integrationID ?? 'opencode';
      if (integrationID !== 'opencode') return;
      const info = {
        ...structuredClone(source.provider), id: 'ghostvault-zen', canonical: 'opencode', integrationID,
        name: 'GhostVault - Zen (real cloud)', settings: { ...source.provider.settings, baseURL },
      };
      const models = [...source.models.values()].map(value => {
        const model = structuredClone(value);
        model.settings = { ...model.settings, baseURL };
        return model;
      });
      editor.add({ info, models, sourceConnection: source.sourceConnection });
    });
    if (context.options?.nativeTransport !== true) return;
    const relay = new NativeZenRelay();
    const endpointUrl = relay.start();
    await context.session.hook('http.request', event => relay.attach(event, endpointUrl), { providerID: 'ghostvault-zen' });
    return relay.stop;
  };
}

export default { id: 'ghostvault.provider.zen-connection', setup: new GhostVaultZenConnection().setup };
