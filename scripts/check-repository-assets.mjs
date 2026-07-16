import { execFileSync } from 'node:child_process';
import { basename, extname } from 'node:path';

const forbiddenGameExtensions = new Set([
  '.bmd',
  '.cif',
  '.cur',
  '.dll',
  '.dls',
  '.exe',
  '.fnt',
  '.hlt',
  '.lib',
  '.pcx',
  '.sgt',
  '.wav',
]);

const reviewedBinaryAssets = new Set([
  'docs/images/logo.webp',
  'docs/images/settlement.webp',
  'packages/app/public/favicon.png',
  'packages/app/public/fonts/tinos-latin-400.woff2',
  'packages/app/public/fonts/tinos-latinext-400.woff2',
  // Original OpenNorthland branding (commissioned art, no original-game material): the menu
  // backdrop + logo, and the emblem as favicon/app icon. docs/images/logo.webp intentionally
  // duplicates the menu logo — the README needs a stable path, the menu a Vite-fingerprinted one.
  'packages/app/src/entries/menu/assets/logo.webp',
  'packages/app/src/entries/menu/assets/village.webp',
  'packages/desktop/build/icon.icns',
  'packages/desktop/build/icon.png',
]);

const reviewRequiredExtensions = new Set([
  '.gif',
  '.icns',
  '.ico',
  '.jpeg',
  '.jpg',
  '.otf',
  '.png',
  '.ttf',
  '.webp',
  '.woff',
  '.woff2',
]);

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const errors = [];

for (const file of tracked) {
  const lower = file.toLowerCase();
  const extension = extname(lower);

  if (lower.startsWith('content/')) {
    errors.push(`${file}: generated content must stay untracked`);
  }
  if (forbiddenGameExtensions.has(extension) || basename(lower) === 'map.dat') {
    errors.push(`${file}: original or decoded game-file type is not allowed`);
  }
  if (reviewRequiredExtensions.has(extension) && !reviewedBinaryAssets.has(file)) {
    errors.push(`${file}: binary asset is not in the reviewed allowlist`);
  }
}

if (errors.length > 0) {
  console.error('Repository asset policy failed:\n');
  for (const error of errors) console.error(`- ${error}`);
  console.error('\nIf this is an original or decoded game asset, remove it.');
  console.error('For a new project-owned binary, document its source and update the allowlist.');
  process.exit(1);
}

console.log(`Repository asset policy passed (${tracked.length} tracked files checked).`);
