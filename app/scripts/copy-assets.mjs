// Copies renderer HTML into dist so the built app is self-contained.
import { mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';
const srcDir = join(root, 'src', 'renderer');
const outDir = join(root, 'dist', 'renderer');
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(srcDir)) {
  if (f.endsWith('.html') || f.endsWith('.css')) {
    copyFileSync(join(srcDir, f), join(outDir, f));
  }
}
console.log('copy-assets: renderer HTML/CSS copied to dist/renderer');
