import { defineConfig } from 'vite';
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const consumerRoot = fileURLToPath(new URL('./frontend', import.meta.url));
const outputRoot = fileURLToPath(new URL('./public', import.meta.url));
let assetOutput = outputRoot;
export default defineConfig({
  root: consumerRoot,
  base: '/',
  publicDir: false,
  resolve: { dedupe: ['lit', 'lit-html', '@lit/reactive-element'] },
  build: { outDir: outputRoot, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 700 },
  plugins: [{ name: 'ghostvault-kit-assets', configResolved: config => { assetOutput = resolve(config.root, config.build.outDir); }, closeBundle: async () => {
    await mkdir(assetOutput, { recursive: true });
    await cp(new URL('../ui-kit/dist/icons', import.meta.url), assetOutput + '/icons', { recursive: true });
    await cp(new URL('../ui-kit/dist/licenses', import.meta.url), assetOutput + '/licenses', { recursive: true });
  } }],
});
