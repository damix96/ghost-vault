import { build } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Assets } from './assets.mjs';

await new Assets().prepare(resolve('public/icons'));
await build({ configFile: false, plugins: [tailwindcss()], build: {
  target: 'es2022',
  lib: { entry: { index: resolve('src/index.ts'), 'models/editor-session': resolve('src/models/editor-session.ts'), 'models/clipboard-task': resolve('src/models/clipboard-task.ts'), 'models/hint-state': resolve('src/models/hint-state.ts') }, formats: ['es'], fileName: (_, name) => `${name}.js`, cssFileName: 'styles' },
  rollupOptions: { external: id => !id.endsWith('.css') && (id === 'lit' || id.startsWith('lit/') || id.startsWith('@awesome.me/webawesome/')) }
} });
execFileSync(process.execPath, [resolve('node_modules/typescript/bin/tsc')], { stdio: 'inherit' });
await new Assets().prepare(resolve('dist/icons'));
await mkdir(resolve('dist/licenses'), { recursive: true });
await copyFile(resolve('node_modules/lucide-static/LICENSE'), resolve('dist/licenses/lucide-static.txt'));
await copyFile(resolve('node_modules/@awesome.me/webawesome/LICENSE.md'), resolve('dist/licenses/webawesome.txt'));
await copyFile(resolve('node_modules/lit/LICENSE'), resolve('dist/licenses/lit.txt'));
await build();
