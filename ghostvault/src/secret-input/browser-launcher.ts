import { execFile } from 'node:child_process';
import path from 'node:path';

export type BrowserLaunchResult = 'attempted' | 'unavailable';
export interface BrowserCommand { file: string; args: string[]; env: NodeJS.ProcessEnv }
export type BrowserCommandRunner = (command: BrowserCommand) => Promise<boolean>;

export class SecretInputBrowser {
  constructor(private platform = process.platform, private run: BrowserCommandRunner = SecretInputBrowser.execute) {}

  public open = async (address: URL): Promise<BrowserLaunchResult> => {
    const command = this.command(address);
    if (!command) return 'unavailable';
    try { return await this.run(command) ? 'attempted' : 'unavailable'; }
    catch { return 'unavailable'; }
  };

  public command = (address: URL): BrowserCommand | undefined => {
    if (address.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) || address.username || address.password || address.hash) return;
    if (!['/vault-secret/new', '/vault-secret/update'].includes(address.pathname)) return;
    if ([...address.searchParams.keys()].some(key => key !== 'request' && key !== 'secrets')) return;
    const request = address.searchParams.get('request');
    const names = address.searchParams.get('secrets');
    if (request && !/^[a-f0-9-]{36}$/.test(request)) return;
    if (names && !/^[A-Z0-9_]+(?:,[A-Z0-9_]+)*$/.test(names)) return;
    if (address.href.length > 8192) return;
    const env = { ...process.env };
    if (this.platform === 'win32') return {
      file: path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:GHOSTVAULT_INPUT_URL -ErrorAction Stop'],
      env: { ...env, GHOSTVAULT_INPUT_URL: address.href },
    };
    if (this.platform === 'darwin') return { file: '/usr/bin/open', args: [address.href], env };
    if (this.platform === 'linux' && (env.DISPLAY || env.WAYLAND_DISPLAY)) return { file: '/usr/bin/xdg-open', args: [address.href], env };
    return undefined;
  };

  private static execute: BrowserCommandRunner = command => new Promise(resolve => {
    execFile(command.file, command.args, { env: command.env, windowsHide: true, timeout: 3000, maxBuffer: 1024, shell: false }, error => resolve(!error));
  });
}
