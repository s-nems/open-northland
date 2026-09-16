import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

// Sum static JavaScript dependencies per URL entry; exclude stylesheets, images and lazy subroutes.
// Gzip each file separately to match separate HTTP responses. This report sets no size gate.

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));

/** Transitive static imports of a manifest key, stopping at dynamic ones: those are the other rows. */
function closure(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const imported of manifest[key]?.imports ?? []) closure(imported, seen);
  return seen;
}

function measure(keys) {
  const files = new Set();
  for (const key of keys) {
    for (const member of closure(key)) {
      const file = manifest[member]?.file;
      if (file?.endsWith('.js') === true) files.add(file);
    }
  }
  let raw = 0;
  let gzip = 0;
  for (const file of files) {
    const bytes = readFileSync(resolve(dist, file));
    raw += bytes.length;
    gzip += gzipSync(bytes).length;
  }
  return { chunks: files.size, raw, gzip };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry);
if (entryKey === undefined) throw new Error('no entry chunk in the vite manifest');

const rows = [{ label: 'shell (every mode)', ...measure([entryKey]) }];
// Bundling can move the route table from the entry into one of its static dependencies.
const routes = new Set([...closure(entryKey)].flatMap((key) => manifest[key]?.dynamicImports ?? []));
for (const routeKey of routes) {
  if (!routeKey.startsWith('src/entries/')) continue;
  const label = routeKey.replace(/^src\/entries\//, '').replace(/(\/index)?\.ts$/, '');
  rows.push({ label, ...measure([entryKey, routeKey]) });
}
rows.sort((a, b) => b.gzip - a.gzip);

const largest = Object.values(manifest)
  .filter((chunk) => chunk.file.endsWith('.js'))
  .map((chunk) => statSync(resolve(dist, chunk.file)).size)
  .reduce((a, b) => Math.max(a, b), 0);

console.log('\nJavaScript per entry module (static import closure):');
for (const row of rows) {
  console.log(
    `  ${row.label.padEnd(20)}${String(row.chunks).padStart(3)} chunks  ${kb(row.raw).padStart(10)}  gzip ${kb(row.gzip).padStart(9)}`,
  );
}
console.log(`  largest single chunk: ${kb(largest)}\n`);
