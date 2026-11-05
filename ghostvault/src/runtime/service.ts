import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { GhostProxyServer } from '../proxy/server.js';
import { VaultDatabase } from '../vault/sqlite-db.js';
import { VaultStore } from '../vault/store.js';
import { RuntimeSettings } from './settings.js';
import { RuntimeIdentity, RuntimeIdentitySchema, RuntimeProof } from './identity.js';
import { RuntimeCredentials } from './credentials.js';
import { RuntimeListener } from './listener.js';
import { RuntimeDeadline, RuntimeDrainTimeout } from './deadline.js';

export interface RuntimeEndpoint { register: () => void; close: () => Promise<void> }
export type RuntimeEndpointFactory = (app: FastifyInstance, vault: VaultStore, options: { host: string; port: number; mcpToken: string; version: string }) => RuntimeEndpoint;

export class GhostVaultRuntime {
  private identity: RuntimeIdentity;
  private controlToken = RuntimeProof.token();
  private credentials: RuntimeCredentials;
  private listener: RuntimeListener;
  private database?: VaultDatabase;
  private vault?: VaultStore;
  private proxy?: GhostProxyServer;
  private endpoint?: RuntimeEndpoint;
  private closing?: Promise<void>;
  private starting?: Promise<RuntimeIdentity>;
  private stopRequested = false;
  private started = false;

  constructor(public settings: RuntimeSettings, private endpointFactory: RuntimeEndpointFactory) {
    this.identity = RuntimeIdentitySchema.parse({ product: 'ghostvault', runtimeProtocol: 1, version: settings.version, instanceId: randomUUID(), startedAt: Date.now(), pid: process.pid, port: settings.port, state: 'starting' });
    this.credentials = new RuntimeCredentials(settings);
    this.listener = new RuntimeListener(settings, this.identity, this.controlToken, this.close);
  }

  public start = async (): Promise<RuntimeIdentity> => {
    if (this.started || this.stopRequested) throw new Error('Runtime has already been started or closed');
    this.started = true;
    this.starting = this.initialize();
    try { return await this.starting; }
    catch (error) { await this.close(); throw error; }
  };

  private initialize = async (): Promise<RuntimeIdentity> => {
    await this.listener.claim();
    if (this.stopRequested) throw new Error('Runtime startup was cancelled');
    const mcpToken = await this.credentials.publish({ instanceId: this.identity.instanceId, controlToken: this.controlToken, port: this.settings.port, databasePath: this.settings.databasePath });
    if (this.stopRequested) throw new Error('Runtime startup was cancelled');
    this.database = new VaultDatabase(this.settings.databasePath);
    this.vault = new VaultStore(this.database);
    this.proxy = new GhostProxyServer(this.vault, { host: this.settings.host, port: this.settings.port });
    this.endpoint = this.endpointFactory(this.proxy.getApp(), this.vault, { host: this.settings.host, port: this.settings.port, mcpToken, version: this.settings.version });
    this.endpoint.register();
    await this.proxy.getApp().ready();
    if (this.stopRequested) throw new Error('Runtime startup was cancelled');
    this.listener.route(this.proxy.getApp().routing);
    this.identity.state = 'ready';
    return { ...this.identity };
  };

  public getVault = (): VaultStore => {
    if (!this.vault) throw new Error('Runtime has not started');
    return this.vault;
  };
  public getServer = (): GhostProxyServer => {
    if (!this.proxy) throw new Error('Runtime has not started');
    return this.proxy;
  };
  public close = async (): Promise<void> => {
    this.stopRequested = true;
    this.closing ??= this.shutdown();
    const closing = this.closing;
    try { await closing; }
    catch (error) { if (this.closing === closing) this.closing = undefined; throw error; }
  };

  private shutdown = async (): Promise<void> => {
    this.identity.state = 'stopping';
    const graceDeadline = Date.now() + 5000;
    const settlementDeadline = graceDeadline + 2000;
    await this.starting?.catch(() => {});
    this.proxy?.getEventBroadcaster().close();
    const endpoint = this.endpoint?.close();
    const input = this.proxy?.closeSecretInput();
    const grace = Math.max(0, graceDeadline - Date.now());
    try { await RuntimeDeadline.wait(Promise.all([endpoint, input, this.listener.drain(grace), this.proxy?.drain(grace)]), grace); }
    catch (error) {
      if (!(error instanceof RuntimeDrainTimeout)) throw error;
      this.proxy?.abortRequests();
      this.listener.abortRequests();
      const settlement = Math.max(0, settlementDeadline - Date.now());
      await RuntimeDeadline.wait(Promise.all([endpoint, input, this.listener.drain(settlement), this.proxy?.drain(settlement)]), settlement);
    }
    await RuntimeDeadline.wait(this.proxy?.close() ?? Promise.resolve(), Math.max(0, settlementDeadline - Date.now()));
    this.database?.close();
    await this.listener.close();
  };
}
