import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

export interface OpenCodeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class OpenCodeCli {
  private major?: number;

  constructor(private executable = OpenCodeCli.resolveExecutable()) {}

  private static resolveExecutable = (): string => {
    if (process.env.OPENCODE_BIN) return process.env.OPENCODE_BIN;
    if (process.platform !== 'win32') return 'opencode';
    const npmRoot = path.join(process.env.APPDATA || '', 'npm/node_modules');
    return [
      path.join(npmRoot, '@opencode/cli/bin/opencode.exe'),
      path.join(npmRoot, 'opencode-ai/bin/opencode.exe'),
    ].find(candidate => existsSync(candidate)) || 'opencode';
  };

  public version = async (): Promise<number> => {
    if (this.major) return this.major;
    const result = await promisify(execFile)(this.executable, ['--version'], { windowsHide: true, timeout: 10000 });
    const match = result.stdout.match(/\bv?(\d+)\.\d+/);
    if (!match) throw new Error('Cannot detect OpenCode version');
    this.major = Number(match[1]);
    return this.major;
  };

  public run = async (directory: string, model: string, prompt: string, timeoutMs = 30000): Promise<OpenCodeResult> => {
    const major = await this.version();
    return new Promise(resolve => {
      const args = ['run', '--model', model, '--auto', '--format', 'json', major >= 2 ? '--standalone' : '--pure'];
      const child = spawn(this.executable, args, { cwd: directory, env: { ...process.env }, windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', data => { stdout += data.toString(); });
      child.stderr.on('data', data => { stderr += data.toString(); });
      child.stdin.on('error', () => undefined);
      const timer = setTimeout(() => { child.kill(); resolve({ exitCode: -1, stdout, stderr: stderr + '\nOpenCode timed out' }); }, timeoutMs);
      child.once('error', error => { clearTimeout(timer); resolve({ exitCode: -1, stdout, stderr: stderr + error.message }); });
      child.once('close', code => { clearTimeout(timer); resolve({ exitCode: code ?? -1, stdout, stderr }); });
      child.stdin.end(prompt, 'utf8');
    });
  };
}
