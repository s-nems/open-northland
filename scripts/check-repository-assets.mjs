import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { isForbiddenGameFile } from './game-asset-policy.mjs';

const reviewedBinaryAssets = new Set([
  'docs/images/logo.webp',
  'docs/images/settlement.webp',
  // The menu's backdrop stills: Open Northland rendering decoded maps, on the same footing as
  // settlement.webp.
  'packages/app/src/assets/menu-backdrops/burza_piaskowa.jpg',
  'packages/app/src/assets/menu-backdrops/demo_mainmenu_10.jpg',
  'packages/app/src/assets/menu-backdrops/kraina_starych_bohaterow.jpg',
  'packages/app/src/assets/menu-backdrops/mroczny_swiat.jpg',
  'packages/app/src/assets/menu-backdrops/nowa_nadzieja.jpg',
  'packages/app/src/assets/menu-backdrops/saracen_4.jpg',
  'packages/app/src/assets/menu-backdrops/straznicypolnocy.jpg',
  'packages/app/src/assets/menu-backdrops/wielka_inwazja.jpg',
  // The in-game HUD chrome: generated for this project, no original-game input (provenance in the custom
  // art checkout's ui/foundation package, which publishes this copy).
  'packages/app/src/assets/ui/foundation/icons.png',
  'packages/app/src/assets/ui/foundation/notices.png',
  'packages/app/src/assets/ui/foundation/surface.png',
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
  '.blend',
  '.exr',
  '.fbx',
  '.gif',
  '.glb',
  '.gz',
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

// The largest art build input is a 14 MiB character clip; a bigger blob is a human-only source
// and belongs in Git LFS, where its index entry is a pointer of a few hundred bytes.
const MAX_PLAIN_BLOB_BYTES = 24 * 1024 * 1024;
const GIT_OUTPUT_MAX_BYTES = 64 * 1024 * 1024;

const indexEntries = execFileSync('git', ['ls-files', '-z', '--stage'], {
  encoding: 'utf8',
  maxBuffer: GIT_OUTPUT_MAX_BYTES,
})
  .split('\0')
  .filter(Boolean)
  .map((entry) => {
    const [metadata, file] = entry.split('\t');
    return { file, oid: metadata.split(' ')[1] };
  });
const tracked = indexEntries.map((entry) => entry.file);
const blobSizes = execFileSync('git', ['cat-file', '--batch-check=%(objectsize)'], {
  encoding: 'utf8',
  input: indexEntries.map((entry) => entry.oid).join('\n'),
  maxBuffer: GIT_OUTPUT_MAX_BYTES,
})
  .split('\n')
  .map(Number);
const blobSize = new Map(indexEntries.map((entry, index) => [entry.file, blobSizes[index]]));
const errors = [];
const trackedSet = new Set(tracked);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
// A checkout with custom art registers its packages and deliveries through this optional module.
const checkoutPolicy = new URL('./custom-art-policy.mjs', import.meta.url);
const isCheckoutArt = existsSync(checkoutPolicy)
  ? (await import(checkoutPolicy.href)).checkoutArtPolicy(readJson, (path) => trackedSet.has(path))
  : () => false;

for (const file of tracked) {
  const lower = file.toLowerCase();
  const extension = extname(lower);

  if (lower.startsWith('content/')) {
    errors.push(`${file}: generated content must stay untracked`);
  }
  if (isForbiddenGameFile(file)) {
    errors.push(`${file}: original or decoded game-file type is not allowed`);
  }
  if (reviewRequiredExtensions.has(extension) && !reviewedBinaryAssets.has(file) && !isCheckoutArt(file)) {
    errors.push(`${file}: binary asset is not in the reviewed allowlist`);
  }
  if (blobSize.get(file) > MAX_PLAIN_BLOB_BYTES) {
    errors.push(`${file}: blob over ${MAX_PLAIN_BLOB_BYTES / 1024 / 1024} MiB must be tracked with Git LFS`);
  }
}

if (errors.length > 0) {
  console.error('Repository asset policy failed:\n');
  for (const error of errors) console.error(`- ${error}`);
  console.error('\nIf this is an original or decoded game asset, remove it.');
  console.error('For a new project-owned binary, document its source and update the allowlist.');
  console.error(
    'Human-only art sources match an LFS pattern in .gitattributes; build inputs stay plain blobs.',
  );
  process.exit(1);
}

console.log(`Repository asset policy passed (${tracked.length} tracked files checked).`);
