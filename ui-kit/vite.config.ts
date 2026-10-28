import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [tailwindcss()],
  resolve: { alias: command === 'serve' ? [
    { find: /^@ghostvault\/ui-kit$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) },
    { find: '@ghostvault/ui-kit/styles.css', replacement: fileURLToPath(new URL('./src/styles.css', import.meta.url)) }
  ] : [] },
  server: { host: '127.0.0.1', port: 5178, strictPort: true },
  preview: { host: '127.0.0.1', port: 5178, strictPort: true },
  build: { outDir: 'playground-dist', target: 'es2022' }
}));
