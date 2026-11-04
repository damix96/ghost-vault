import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface ShortcutDefinition { executable: string; arguments: string; workingDirectory: string; windowStyle: number }

export class WindowsShortcut {
  public readonly powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  public quote = (value: string): string => "'" + value.replaceAll("'", "''") + "'";
  public encode = (script: string): string => Buffer.from(script, 'utf16le').toString('base64');

  public inspect = (target: string): ShortcutDefinition | undefined => {
    if (!existsSync(target)) return undefined;
    return JSON.parse(this.execute('$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut(' + this.quote(target) + '); @{executable=$shortcut.TargetPath; arguments=$shortcut.Arguments; workingDirectory=$shortcut.WorkingDirectory; windowStyle=$shortcut.WindowStyle} | ConvertTo-Json -Compress'));
  };

  public write = (target: string, definition: ShortcutDefinition): void => {
    this.execute('$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut(' + this.quote(target) + '); $shortcut.TargetPath=' + this.quote(definition.executable) + '; $shortcut.Arguments=' + this.quote(definition.arguments) + '; $shortcut.WorkingDirectory=' + this.quote(definition.workingDirectory) + '; $shortcut.WindowStyle=' + definition.windowStyle + '; $shortcut.Save()');
  };

  public checkScriptExecution = (): void => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-powershell-'));
    const probe = path.join(directory, 'probe.ps1');
    try {
      writeFileSync(probe, '\uFEFFWrite-Output "ghostvault-startup-ready"');
      const result = spawnSync(this.powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', probe], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
      if (result.error || result.status !== 0 || result.stdout.trim() !== 'ghostvault-startup-ready') throw new Error('PowerShell script execution is unavailable or blocked; login startup was not installed. Use the stdio bridge or start command');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  };

  public execute = (script: string): string => {
    if (process.platform !== 'win32') throw new Error('Windows shortcuts are unavailable on this platform');
    const result = spawnSync(this.powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', this.encode("$ErrorActionPreference='Stop'; " + script)], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (result.error || result.status !== 0) throw new Error('Windows startup shortcut could not be created or inspected; no operating-system feature was enabled');
    return result.stdout.trim();
  };
}
