import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

class ReleaseStager {
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  run = () => {
    const { values } = parseArgs({ options: { out: { type: 'string' }, dist: { type: 'string' }, public: { type: 'string' } } });
    if (!values.out) throw new Error('Specify --out with an empty staging directory');
    const destination = path.resolve(values.out);
    if (destination === this.root || this.root.startsWith(destination + path.sep)) throw new Error('Staging directory must not contain the source package');
    if (existsSync(destination) && readdirSync(destination).length) throw new Error('Staging directory must be empty');
    const dist = path.resolve(values.dist ?? path.join(this.root, 'dist'));
    const publicDir = path.resolve(values.public ?? path.join(this.root, 'public'));
    const resources = ['README.md', 'opencode/zen-connection'];
    const helpers = ['index.mjs', 'native-relay.mjs'].map(name => path.join(this.root, 'opencode/zen-connection', name));
    for (const file of [path.join(dist, 'runtime/cli.js'), path.join(publicDir, 'index.html'), path.join(this.root, 'README.md'), ...helpers]) {
      if (!existsSync(file)) throw new Error('Missing built release file: ' + file);
    }
    const manifest = JSON.parse(readFileSync(path.join(this.root, 'package.json'), 'utf8'));
    const dependencies = { ...manifest.dependencies };
    mkdirSync(destination, { recursive: true });
    cpSync(dist, path.join(destination, 'dist'), { recursive: true, filter: source => !/[/\\](?:test-[^/\\]+|e2e-runner|demo|mock-server)\.(?:js|d\.ts|js\.map)$/.test(source) });
    cpSync(publicDir, path.join(destination, 'public'), { recursive: true });
    for (const resource of resources) cpSync(path.join(this.root, resource), path.join(destination, resource), { recursive: true });
    const releaseManifest = { name: manifest.name, version: manifest.version, description: manifest.description, license: manifest.license, type: 'module', main: 'dist/index.js', bin: manifest.bin, engines: manifest.engines, files: manifest.files, dependencies, scripts: { start: 'node dist/runtime/cli.js start', status: 'node dist/runtime/cli.js status', stop: 'node dist/runtime/cli.js stop', setup: 'node dist/runtime/cli.js setup' } };
    writeFileSync(path.join(destination, 'package.json'), JSON.stringify(releaseManifest, null, 2) + '\n');
    const lock = JSON.parse(readFileSync(path.join(this.root, 'package-lock.json'), 'utf8'));
    lock.packages = Object.fromEntries(Object.entries(lock.packages).filter(([key, entry]) => !key || key.startsWith('node_modules/') && key !== 'node_modules/@ghostvault/ui-kit' && !entry.link && !entry.dev));
    lock.packages[''] = { name: manifest.name, version: manifest.version, license: manifest.license, dependencies, bin: releaseManifest.bin, engines: releaseManifest.engines };
    writeFileSync(path.join(destination, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
    writeFileSync(path.join(destination, 'ghostvault.cmd'), '@echo off\r\nnode "%~dp0dist\\runtime\\cli.js" %*\r\n');
    writeFileSync(path.join(destination, 'ghostvault'), '#!/bin/sh\nexec node "$(dirname "$0")/dist/runtime/cli.js" "$@"\n', { mode: 0o755 });
    console.log(JSON.stringify({ directory: destination, version: manifest.version, install: 'npm install --omit=dev --ignore-scripts', entry: 'node dist/runtime/cli.js', node: manifest.engines?.node, resources, dependenciesInstalled: false }));
  };
}

new ReleaseStager().run();
