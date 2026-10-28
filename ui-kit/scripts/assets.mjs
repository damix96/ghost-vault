import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export class Assets {
  names = ['info', 'x', 'copy', 'eye', 'eye-off', 'check', 'chevron-down', 'chevron-right', 'chevron-left'];
  prepare = async target => {
    await mkdir(target, { recursive: true });
    await Promise.all(this.names.map(name => copyFile(resolve('node_modules/lucide-static/icons', `${name}.svg`), resolve(target, `${name}.svg`))));
  };
}

if (process.argv[2]) await new Assets().prepare(resolve(process.argv[2]));
