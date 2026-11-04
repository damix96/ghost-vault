import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { RuntimeSettings } from './settings.js';
import { RuntimeProof } from './identity.js';

const RecordSchema = z.object({ instanceId: z.string().uuid(), controlToken: z.string().regex(/^[a-f0-9]{64}$/), port: z.number().int(), databasePath: z.string() });
export type RuntimeRecord = z.infer<typeof RecordSchema>;

export class RuntimeCredentials {
  constructor(private settings: RuntimeSettings) {}

  public read = (): RuntimeRecord | undefined => {
    try { return RecordSchema.parse(JSON.parse(readFileSync(this.settings.recordPath, 'utf8'))); }
    catch { return undefined; }
  };

  public publish = async (record: RuntimeRecord): Promise<string> => {
    mkdirSync(this.settings.dataDir, { recursive: true, mode: 0o700 });
    const temporary = this.settings.recordPath + '.' + record.instanceId + '.tmp';
    writeFileSync(temporary, JSON.stringify(record), { flag: 'wx', mode: 0o600 });
    try { await this.replace(temporary); }
    finally { rmSync(temporary, { force: true }); }
    if (process.platform !== 'win32') chmodSync(this.settings.recordPath, 0o600);
    if (!existsSync(this.settings.tokenPath)) {
      try { writeFileSync(this.settings.tokenPath, RuntimeProof.token(), { flag: 'wx', mode: 0o600 }); }
      catch (error) { if ((error as { code?: string }).code !== 'EEXIST') throw error; }
    }
    return this.readMcpToken();
  };

  private replace = async (temporary: string): Promise<void> => {
    const deadline = Date.now() + 1000;
    while (true) {
      try { await rename(temporary, this.settings.recordPath); return; }
      catch (error) {
        if (Date.now() >= deadline || !['EPERM', 'EBUSY', 'EACCES'].includes((error as { code?: string }).code ?? '')) throw error;
        await delay(20 + Math.random() * 20);
      }
    }
  };

  public readMcpToken = (): string => {
    const token = readFileSync(this.settings.tokenPath, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid GhostVault MCP credential file');
    return token;
  };

}
