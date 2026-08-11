import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';
import { isForbiddenGameFile } from './game-asset-policy.mjs';

const reviewedBinaryAssets = new Set([
  'docs/images/logo.webp',
  'docs/images/settlement.webp',
  'packages/app/public/favicon.png',
  'packages/app/public/fonts/tinos-latin-400.woff2',
  'packages/app/public/fonts/tinos-latinext-400.woff2',
  // The menu's typefaces: Cinzel and Alegreya Sans, subset from Google Fonts releases; SIL OFL
  // texts sit beside them as LICENSE-*.txt.
  'packages/app/public/fonts/alegreyasans-latin-400.woff2',
  'packages/app/public/fonts/alegreyasans-latin-500.woff2',
  'packages/app/public/fonts/alegreyasans-latin-700.woff2',
  'packages/app/public/fonts/alegreyasans-latinext-400.woff2',
  'packages/app/public/fonts/alegreyasans-latinext-500.woff2',
  'packages/app/public/fonts/alegreyasans-latinext-700.woff2',
  'packages/app/public/fonts/cinzel-latin.woff2',
  'packages/app/public/fonts/cinzel-latinext.woff2',
  // Original OpenNorthland branding (commissioned art, no original-game material): the emblem
  // as favicon/app icon; docs/images/logo.webp gives the README a stable logo path.
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
  if (isForbiddenGameFile(file)) {
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
