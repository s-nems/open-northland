import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isForbiddenGameFile, isReviewRequiredFile } from './game-asset-policy.mjs';

const reviewedBinaryAssets = new Set([
  'docs/images/logo.webp',
  'docs/images/settlement.webp',
  // The menu's backdrop stills, also the boot card's: Open Northland rendering decoded maps, on the
  // same footing as settlement.webp.
  'packages/app/src/assets/menu-backdrops/arabskie_wyspy.jpg',
  'packages/app/src/assets/menu-backdrops/burza_piaskowa.jpg',
  'packages/app/src/assets/menu-backdrops/czarnoksieznik_z_szeolu.jpg',
  'packages/app/src/assets/menu-backdrops/gringo.jpg',
  'packages/app/src/assets/menu-backdrops/jotunheim.jpg',
  'packages/app/src/assets/menu-backdrops/kraina_starych_bohaterow.jpg',
  'packages/app/src/assets/menu-backdrops/nowa_nadzieja.jpg',
  'packages/app/src/assets/menu-backdrops/oczy_weza.jpg',
  'packages/app/src/assets/menu-backdrops/piracka_utopia.jpg',
  'packages/app/src/assets/menu-backdrops/smocza_kraina.jpg',
  'packages/app/src/assets/menu-backdrops/upadek_krola.jpg',
  'packages/app/src/assets/menu-backdrops/upadek_krola_panorama.jpg',
  'packages/app/src/assets/menu-backdrops/w_sercu_nawalnicy.jpg',
  // The in-game HUD chrome: generated for this project, no original-game input (provenance in the custom
  // art checkout's ui/foundation and ui/mission-book packages, which publish these copies).
  'packages/app/src/assets/ui/foundation/icons.png',
  'packages/app/src/assets/ui/foundation/notices.png',
  'packages/app/src/assets/ui/foundation/surface.png',
  'packages/app/src/assets/ui/mission-book/band.webp',
  'packages/app/src/assets/ui/mission-book/spread.webp',
  'packages/app/src/assets/ui/mission-book/vellum.webp',
  // Minimap frames and their backing: generated for this project with gpt-image-1.5, no original-game
  // input; the ksiega frame took the project's own mission book spread as its style reference.
  'packages/app/src/assets/ui/minimap/frames/ksiega.webp',
  'packages/app/src/assets/ui/minimap/frames/urnes.webp',
  'packages/app/src/assets/ui/minimap/frames/zelazo.webp',
  'packages/app/src/assets/ui/minimap/wood.webp',
  // The line tools' plan stake and the road tool's plot: generated for this project with gpt-image-1.5,
  // with the original's palisade stakes, stone goods and a game still as style references. Each blocked,
  // ring and claimed copy is an edit of its open image, registered to the same frame. All are reduced to
  // the game's own sprite scale and remapped to colours taken from the original's sprites.
  'packages/app/src/assets/markers/plan-stake-blocked.png',
  'packages/app/src/assets/markers/plan-stake-open.png',
  'packages/app/src/assets/markers/plan-stake-ring.png',
  'packages/app/src/assets/markers/plan-road-blocked.png',
  'packages/app/src/assets/markers/plan-road-claimed.png',
  'packages/app/src/assets/markers/plan-road-open.png',
  // The dock cursor's mooring post: generated for this project with gpt-image-1.5, with the project's own
  // plan stake as its style reference, reduced to the game's sprite scale and remapped to the colours of
  // the plan markers above.
  'packages/app/src/assets/markers/berth-post.png',
  // The map ping's pin, with the shield's planks repeated in grey beside it for tinting, each in a
  // transparent gutter: generated for this project with gpt-image-1.5 from a text description alone,
  // reduced to the game's sprite scale.
  'packages/app/src/assets/markers/map-ping-pin.png',
  // The app's typefaces: Cinzel, Alegreya Sans and Alegreya Sans SC, subset from Google Fonts
  // releases; SIL OFL texts sit beside them as LICENSE-*.txt.
  'packages/app/public/fonts/alegreyasans-cyrillic-400.woff2',
  'packages/app/public/fonts/alegreyasans-cyrillic-500.woff2',
  'packages/app/public/fonts/alegreyasans-cyrillic-700.woff2',
  'packages/app/public/fonts/alegreyasans-latin-400.woff2',
  'packages/app/public/fonts/alegreyasans-latin-500.woff2',
  'packages/app/public/fonts/alegreyasans-latin-700.woff2',
  'packages/app/public/fonts/alegreyasans-latinext-400.woff2',
  'packages/app/public/fonts/alegreyasans-latinext-500.woff2',
  'packages/app/public/fonts/alegreyasans-latinext-700.woff2',
  'packages/app/public/fonts/alegreyasans-latin-400italic.woff2',
  'packages/app/public/fonts/alegreyasans-latinext-400italic.woff2',
  'packages/app/public/fonts/alegreyasans-cyrillic-400italic.woff2',
  'packages/app/public/fonts/alegreyasanssc-latin-400.woff2',
  'packages/app/public/fonts/alegreyasanssc-latin-500.woff2',
  'packages/app/public/fonts/alegreyasanssc-latin-700.woff2',
  'packages/app/public/fonts/alegreyasanssc-latinext-400.woff2',
  'packages/app/public/fonts/alegreyasanssc-latinext-500.woff2',
  'packages/app/public/fonts/alegreyasanssc-latinext-700.woff2',
  'packages/app/public/fonts/alegreyasanssc-cyrillic-400.woff2',
  'packages/app/public/fonts/alegreyasanssc-cyrillic-500.woff2',
  'packages/app/public/fonts/alegreyasanssc-cyrillic-700.woff2',
  'packages/app/public/fonts/cinzel-latin.woff2',
  'packages/app/public/fonts/cinzel-latinext.woff2',
  // The Han face for the Chinese locales: Noto Sans SC subset from the notofonts release; source,
  // subset and SIL OFL text in LICENSE-NotoSansSC.txt.
  'packages/app/public/fonts/notosanssc-han-400.woff2',
  'packages/app/public/fonts/notosanssc-han-700.woff2',
  // A siege attack's music: "Colossal Boss Battle Theme" by Matthew Pablo, CC-BY 3.0, from
  // https://opengameart.org/node/20947, converted from the author's MP3; notice in
  // packages/app/public/licenses/THIRD-PARTY-NOTICES.txt.
  'packages/app/public/audio/colossal-boss-battle.ogg',
  // Original OpenNorthland branding (commissioned art, no original-game material). The masters live
  // in tools/brand/source; `npm run brand` derives the rest, including the README logo above. The
  // Open Graph image and the manifest screenshot also use docs/images/settlement.webp, a capture of
  // Open Northland's own renderer.
  'tools/brand/source/badge-installer.png',
  'tools/brand/source/badge-portable.png',
  'tools/brand/source/badge-uninstaller.png',
  'tools/brand/source/emblem.png',
  'tools/brand/source/lockup-horizontal.png',
  'tools/brand/source/lockup-stacked.png',
  'tools/brand/source/wordmark.png',
  'packages/app/public/apple-touch-icon.png',
  'packages/app/public/favicon.ico',
  'packages/app/public/icon-192.png',
  'packages/app/public/icon-512.png',
  'packages/app/public/icon-512-maskable.png',
  'packages/app/public/og-image.jpg',
  'packages/app/public/screenshot-wide.webp',
  'packages/app/src/assets/brand/logo-stacked.webp',
  // The CulturesNation logo, identifying the about screen's link to that community site; the mark is
  // CulturesNation's. Source: https://culturesnation.pl/culturesnation-logo.png
  'packages/app/src/assets/community/culturesnation.webp',
  'packages/desktop/resources/icon-installer.icns',
  'packages/desktop/resources/icon-installer.ico',
  'packages/desktop/resources/icon-portable.ico',
  'packages/desktop/resources/icon-uninstaller.ico',
  'packages/desktop/resources/icon.icns',
  'packages/desktop/resources/icon.ico',
  'packages/desktop/resources/icon.png',
  'packages/desktop/resources/portable-splash.bmp',
]);

// Shared cursor UI, generated without original-game input; only these reviewed deliveries are allowed.
const cursorStates = [
  'normal',
  'select',
  'pressed',
  'command',
  'pointer',
  'grab',
  'grabbing',
  'not-allowed',
  'move',
  'attack',
  'attack-move',
  'build',
  'work',
  'crosshair',
  'text',
  'help',
  'progress',
];
for (const theme of ['iron', 'bone', 'amber', 'steel']) {
  for (const state of cursorStates) {
    for (const size of [24, 28, 32]) {
      for (const density of ['', '@2x']) {
        reviewedBinaryAssets.add(
          `packages/app/src/assets/ui/cursors/${theme}/${state}-${size}${density}.png`,
        );
      }
    }
  }
}

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

  if (lower.startsWith('content/') || lower.startsWith('.cache/')) {
    errors.push(`${file}: generated content must stay untracked`);
  }
  if (isForbiddenGameFile(file)) {
    errors.push(`${file}: original or decoded game-file type is not allowed`);
  }
  if (isReviewRequiredFile(file) && !reviewedBinaryAssets.has(file) && !isCheckoutArt(file)) {
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
