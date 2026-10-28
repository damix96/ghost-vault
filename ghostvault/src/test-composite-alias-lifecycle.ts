import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createParser } from 'eventsource-parser';
import { SseTransformer } from './proxy/sse-transformer.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';

export class CompositeAliasLifecycleTests {
  public verifyReloadAndCollision = async (secret: string): Promise<{ formsDistinct: boolean; reloadStable: boolean; collisionSafe: boolean; dbSchemaStable: boolean }> => {
    const directory = await mkdtemp(join(tmpdir(), 'ghostvault-alias-reload-'));
    const filePath = join(directory, 'vault.db');
    const json1 = JSON.stringify(secret).slice(1, -1);
    const json2 = JSON.stringify(json1).slice(1, -1);
    const json3 = JSON.stringify(json2).slice(1, -1);
    const forms = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), secret.replace(/\//g, '\\/'), json1, json2, json3];
    let firstDb: VaultDatabase | undefined;
    let loadedDb: VaultDatabase | undefined;
    let collisionDb: VaultDatabase | undefined;
    let schemaDb: DatabaseSync | undefined;
    try {
      firstDb = new VaultDatabase(filePath);
      const firstStore = new VaultStore(firstDb);
      firstStore.setManualSecret('RELOAD_FORM', secret);
      const initialAliases = forms.map(form => firstStore.maskOutboundText(form));
      firstDb.close();
      firstDb = undefined;
      loadedDb = new VaultDatabase(filePath);
      const loadedStore = new VaultStore(loadedDb);
      const loadedAliases = forms.map(form => loadedStore.maskOutboundText(form));
      const reloadStable = initialAliases.every((alias, index) => alias === loadedAliases[index] && /^\$\$\{<[A-Z0-9_]+>\}$/.test(alias) && loadedStore.unmaskInboundText(alias) === forms[index]);
      const formsDistinct = new Set(initialAliases).size === forms.length;
      schemaDb = new DatabaseSync(filePath);
      const columns = schemaDb.prepare('PRAGMA table_info(secrets)').all().map((row: any) => row.name);
      const dbSchemaStable = columns.join(',') === 'key,real_value,alias,mask_in_ai,description,created_at,updated_at' && loadedStore.getDatabase().getSecrets().some(row => row.key === 'RELOAD_FORM' && row.alias === '$${<RELOAD_FORM>}');
      schemaDb.close();
      schemaDb = undefined;
      loadedDb.close();
      loadedDb = undefined;
      collisionDb = new VaultDatabase(':memory:');
      const collisionStore = new VaultStore(collisionDb);
      collisionStore.setManualSecret('COLLISION', secret);
      collisionStore.setManualSecret('COLLISION__GV_JSON1', 'collision-canary');
      const collisionForm = JSON.stringify(secret).slice(1, -1);
      const collisionAlias = collisionStore.maskOutboundText(collisionForm);
      const reservedAlias = '$${<COLLISION__GV_JSON1>}';
      const collisionSafe = /^\$\$\{<[A-Z0-9_]+>\}$/.test(collisionAlias) && collisionAlias !== reservedAlias && collisionStore.unmaskInboundText(collisionAlias) === collisionForm && collisionStore.unmaskInboundText(reservedAlias) === 'collision-canary';
      return { formsDistinct, reloadStable, collisionSafe, dbSchemaStable };
    } finally {
      firstDb?.close();
      loadedDb?.close();
      collisionDb?.close();
      schemaDb?.close();
      await rm(directory, { recursive: true, force: true });
    }
  };

  public verifyNonCascading = (): { plainSafe: boolean; streamSafe: boolean } => {
    const db = new VaultDatabase(':memory:');
    const vault = new VaultStore(db);
    const target = vault.setManualSecret('CASCADE_INNER', 'nested-value');
    const outerValue = 'outer-' + target.alias + '-tail';
    const outer = vault.setManualSecret('CASCADE_OUTER_WRAPPER', outerValue);
    const plain = vault.unmaskInboundText(outer.alias);
    const transformer = new SseTransformer(vault, 32, () => {});
    const wire: string[] = [];
    for (const character of Array.from(outer.alias)) wire.push(transformer.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: character }, finish_reason: null }] }) + '\n\n'));
    wire.push(transformer.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n'));
    const fragments: string[] = [];
    createParser({ onEvent: event => {
      if (event.data === '[DONE]') return;
      try { fragments.push(JSON.parse(event.data).choices?.[0]?.delta?.content || ''); } catch {}
    } }).feed(wire.join(''));
    db.close();
    return { plainSafe: plain === outerValue, streamSafe: fragments.join('') === outerValue };
  };
}
