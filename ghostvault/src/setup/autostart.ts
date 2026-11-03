import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { RuntimeSettings } from '../runtime/settings.js';
import { WindowsShortcut, ShortcutDefinition } from './windows-shortcut.js';

export interface AutostartResult { target: string; content: string; changed: boolean; applied: boolean }

export class AutostartInstaller {
  constructor(private settings: RuntimeSettings, private entry: string, private executable = process.execPath, private shortcuts = new WindowsShortcut()) {}

  public install = (options: { target?: string; apply?: boolean; platform?: NodeJS.Platform } = {}): AutostartResult => {
    const platform = options.platform ?? process.platform;
    if (platform !== 'win32') throw new Error('Automatic login registration is currently supported on Windows only; use the stdio bridge or start command on this platform');
    const appData = process.env.APPDATA;
    if (!options.target && !appData) throw new Error('APPDATA is required for Windows user-login startup');
    const target = path.resolve(options.target ?? path.join(appData!, 'Microsoft/Windows/Start Menu/Programs/Startup/GhostVault.lnk'));
    if (path.extname(target).toLowerCase() !== '.lnk') throw new Error('Windows startup target must end in .lnk');
    const args = [this.entry, 'ensure-start', ...this.settings.arguments()];
    const script = '\uFEFF& ' + this.shortcuts.quote(this.executable) + ' @(' + args.map(this.shortcuts.quote).join(',') + ')\r\nexit $LASTEXITCODE\r\n';
    const workingDirectory = path.join(this.settings.dataDir, 'startup');
    const scriptName = 'launcher-' + createHash('sha256').update(script).digest('hex') + '.ps1';
    const scriptPath = path.join(workingDirectory, scriptName);
    const command = '& ' + this.shortcuts.quote(scriptPath);
    const definition: ShortcutDefinition = { executable: this.shortcuts.powershell, arguments: '-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + this.shortcuts.encode(command), workingDirectory: '', windowStyle: 7 };
    if (definition.arguments.length > 1023) throw new Error('Startup helper path is too long for a Windows shortcut; select a shorter data directory');
    const content = JSON.stringify({ shortcut: definition, scriptPath, script });
    const helperExists = existsSync(scriptPath);
    if (helperExists && readFileSync(scriptPath, 'utf8') !== script) throw new Error('Startup helper content differs from its expected content');
    const changed = !helperExists || !isDeepStrictEqual(this.shortcuts.inspect(target), definition);
    if (options.apply && changed) {
      this.shortcuts.checkScriptExecution();
      if (!options.target && !target.startsWith(path.resolve(appData!) + path.sep)) throw new Error('Invalid Startup destination');
      mkdirSync(path.dirname(target), { recursive: true });
      mkdirSync(workingDirectory, { recursive: true });
      const temporary = path.join(path.dirname(target), 'ghostvault-' + randomUUID() + '.lnk');
      try {
        if (!helperExists) writeFileSync(scriptPath, script, { flag: 'wx', mode: 0o600 });
        this.shortcuts.write(temporary, definition);
        if (!isDeepStrictEqual(this.shortcuts.inspect(temporary), definition)) throw new Error('Windows did not preserve the complete startup shortcut');
        if (existsSync(target)) copyFileSync(target, target + '.backup-' + randomUUID());
        renameSync(temporary, target);
      } catch (error) {
        if (!helperExists) rmSync(scriptPath, { force: true });
        throw error;
      } finally { rmSync(temporary, { force: true }); }
    }
    return { target, content, changed, applied: Boolean(options.apply) };
  };

}
