// Derives every committed brand asset from the masters in source/. Run `npm run brand` from the root
// after changing a master; the outputs are committed so the app, the desktop build and the README
// need no image tooling.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BRAND_LOGO_STACKED_SIZE } from '../../packages/app/src/view/brand-art.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SOURCE = join(HERE, 'source');
const APP_PUBLIC = join(ROOT, 'packages/app/public');
const APP_BRAND = join(ROOT, 'packages/app/src/assets/brand');
const DESKTOP_BUILD = join(ROOT, 'packages/desktop/build');
const DOCS_IMAGES = join(ROOT, 'docs/images');

/** The menu's night ground; also the manifest theme colour. Mirrors the body background in index.html. */
const GROUND = '#0c1420';
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
/** Alpha above this counts as drawn when checking a master's edges. */
const EDGE_ALPHA_THRESHOLD = 16;

/**
 * Below this edge the painted longship turns to mud, so a flat drawing of the same shield stands in
 * for it. Browsers on high-density screens draw a 16 px favicon slot at 32 px, the drawing's grid.
 */
const SMALL_EMBLEM_MAX_SIZE = 32;
const SMALL_EMBLEM_SVG_VIEWBOX = 32;

const ICO_SIZES = [16, 32, 48, 64, 128, 256];
/**
 * The slots iconutil writes for an iconset: 16 and 32 px as run-length ARGB planes (macOS shows PNG
 * data in those two slots as noise), the rest as PNG; `@2x` slots repeat a pixel size under another
 * type. The 1024 px slot is left out to keep the committed file small.
 */
const ICNS_SLOTS = [
  ['ic04', 16, 'argb'],
  ['ic05', 32, 'argb'],
  ['ic11', 32, 'png'],
  ['ic12', 64, 'png'],
  ['ic07', 128, 'png'],
  ['ic13', 256, 'png'],
  ['ic08', 256, 'png'],
  ['ic14', 512, 'png'],
  ['ic09', 512, 'png'],
];
/** ICNS run-length coding: a literal run holds 1..128 bytes, a repeat run 3..130 copies of one byte. */
const ICNS_RLE = { literalMax: 128, repeatMin: 3, repeatMax: 130, repeatFlag: 0x80 };
const PWA_ICON_SIZES = [192, 512];
const APPLE_TOUCH_ICON_SIZE = 180;
const DESKTOP_ICON_SIZE = 1024;
/** Maskable icons must keep their motif inside the central 80 % safe zone. */
const MASKABLE_PADDING = 0.1;
const ICON_PADDING = 0.04;
/**
 * macOS draws app icons as a rounded square on Apple's 1024 px grid (an 824 px body, about 185 px
 * corner radius); a free-standing round shield gets shrunk into a grey frame instead.
 */
const MAC_TILE = { grid: 1024, body: 824, radius: 185, top: '#27313f', bottom: '#111822', motif: 0.84 };
/** The emblem stays whole in a centre square crop, which chat apps use for compact link previews. */
const OG_IMAGE = {
  width: 1200,
  height: 630,
  logoHeight: 560,
  dim: 0.55,
  tint: '#2a3a52',
  veil: 'rgba(12, 20, 32, 0.4)',
  jpeg: { quality: 86, mozjpeg: true },
};
/** Twice the width README.md shows it at. The plaque behind the wordmark reads on light and dark themes. */
const README_LOGO_WIDTH = 640;
/** The Chrome install dialog shows wide screenshots up to a 2.3:1 ratio. */
const SCREENSHOT_WIDTH = 1280;
const WEBP = { quality: 90, alphaQuality: 100 };

const emblemRaster = await trimmedMaster('emblem.png');
const lockupStacked = await trimmedMaster('lockup-stacked.png');
const smallEmblemSvg = await readFile(join(SOURCE, 'emblem-small.svg'));
/** Open Northland's own renderer, never the original game (docs/LEGAL.md); the menu shows it too. */
const SETTLEMENT = join(ROOT, 'docs/images/settlement.webp');

/**
 * The raster masters carry generous transparent margins; each target fits the trimmed motif instead.
 * A master drawn up to its canvas edge was cropped by the generator, so it fails the build.
 */
async function trimmedMaster(name) {
  const { data, info } = await sharp(join(SOURCE, name))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = (x, y) => data[(y * info.width + x) * info.channels + 3];
  const last = { x: info.width - 1, y: info.height - 1 };
  for (let x = 0; x < info.width; x++) {
    if (alpha(x, 0) > EDGE_ALPHA_THRESHOLD || alpha(x, last.y) > EDGE_ALPHA_THRESHOLD) {
      throw new Error(`${name} is drawn up to its top or bottom edge; the motif is cropped`);
    }
  }
  for (let y = 0; y < info.height; y++) {
    if (alpha(0, y) > EDGE_ALPHA_THRESHOLD || alpha(last.x, y) > EDGE_ALPHA_THRESHOLD) {
      throw new Error(`${name} is drawn up to its left or right edge; the motif is cropped`);
    }
  }
  return sharp(join(SOURCE, name)).trim().png().toBuffer();
}

async function smallEmblem(size) {
  const density = (72 * size) / SMALL_EMBLEM_SVG_VIEWBOX;
  return sharp(smallEmblemSvg, { density }).resize(size, size).png().toBuffer();
}

/** The painted emblem fitted into a `size` square with `padding` (fraction of `size`) on each side. */
async function paintedEmblem(size, padding, background = TRANSPARENT) {
  const inner = Math.round(size * (1 - 2 * padding));
  const pad = Math.round((size - inner) / 2);
  return sharp(emblemRaster)
    .resize(inner, inner, { fit: 'contain', background: TRANSPARENT })
    .extend({ top: pad, bottom: size - inner - pad, left: pad, right: size - inner - pad, background })
    .png()
    .toBuffer();
}

async function iconPng(size) {
  return size <= SMALL_EMBLEM_MAX_SIZE ? smallEmblem(size) : paintedEmblem(size, ICON_PADDING);
}

/** The emblem on a night-blue rounded square laid out on Apple's icon grid, rendered at `size`. */
async function macTile(size) {
  const scale = size / MAC_TILE.grid;
  const body = Math.round(MAC_TILE.body * scale);
  const inset = Math.round((size - body) / 2);
  const radius = MAC_TILE.radius * scale;
  const tile = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${MAC_TILE.top}"/><stop offset="1" stop-color="${MAC_TILE.bottom}"/>` +
      `</linearGradient></defs>` +
      `<rect x="${inset}" y="${inset}" width="${body}" height="${body}" rx="${radius}" fill="url(#g)"/></svg>`,
  );
  const motifSize = Math.round(body * MAC_TILE.motif);
  const motif =
    motifSize <= SMALL_EMBLEM_MAX_SIZE ? await smallEmblem(motifSize) : await paintedEmblem(motifSize, 0);
  return sharp(tile)
    .composite([{ input: motif, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/** ICO container with PNG-encoded entries; a 256 px entry is written as size 0 per the format. */
function ico(entries) {
  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER + ENTRY * entries.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(({ size, png }, i) => {
    const at = HEADER + ENTRY * i;
    header.writeUInt8(size === 256 ? 0 : size, at);
    header.writeUInt8(size === 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2);
    header.writeUInt8(0, at + 3);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map((e) => e.png)]);
}

function icnsRunLength(plane) {
  const out = [];
  let i = 0;
  while (i < plane.length) {
    let run = 1;
    while (i + run < plane.length && plane[i + run] === plane[i] && run < ICNS_RLE.repeatMax) run++;
    if (run >= ICNS_RLE.repeatMin) {
      out.push(ICNS_RLE.repeatFlag + (run - ICNS_RLE.repeatMin), plane[i]);
      i += run;
      continue;
    }
    let literal = 0;
    while (
      i + literal < plane.length &&
      literal < ICNS_RLE.literalMax &&
      !(
        i + literal + 2 < plane.length &&
        plane[i + literal] === plane[i + literal + 1] &&
        plane[i + literal] === plane[i + literal + 2]
      )
    ) {
      literal++;
    }
    out.push(literal - 1, ...plane.subarray(i, i + literal));
    i += literal;
  }
  return Buffer.from(out);
}

/** The `ic04`/`ic05` payload: an `ARGB` tag, then the alpha, red, green and blue planes run-length coded. */
async function icnsArgb(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height;
  const planes = [3, 0, 1, 2].map((channel) => {
    const plane = Buffer.alloc(pixels);
    for (let p = 0; p < pixels; p++) plane[p] = data[p * info.channels + channel];
    return icnsRunLength(plane);
  });
  return Buffer.concat([Buffer.from('ARGB', 'ascii'), ...planes]);
}

/** ICNS container laid out like iconutil's output, so Finder and the dock read every slot. */
function icns(slots) {
  const chunks = slots.map(([type, payload]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(8 + payload.length, 4);
    return Buffer.concat([head, payload]);
  });
  const total = chunks.reduce((n, c) => n + c.length, 8);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...chunks]);
}

/** The stacked lockup centred on the settlement backdrop, dimmed and tinted like the main menu's night. */
async function ogImage() {
  const backdrop = await sharp(SETTLEMENT)
    .resize(OG_IMAGE.width, OG_IMAGE.height, { fit: 'cover' })
    .modulate({ brightness: OG_IMAGE.dim })
    .tint(OG_IMAGE.tint)
    .png()
    .toBuffer();
  const veil = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_IMAGE.width}" height="${OG_IMAGE.height}">` +
      `<rect width="100%" height="100%" fill="${OG_IMAGE.veil}"/></svg>`,
  );
  const logo = await sharp(lockupStacked).resize({ height: OG_IMAGE.logoHeight }).png().toBuffer();
  return sharp(backdrop)
    .composite([{ input: veil }, { input: logo, gravity: 'centre' }])
    .jpeg(OG_IMAGE.jpeg)
    .toBuffer();
}

function webManifest(screenshot) {
  return `${JSON.stringify(
    {
      name: 'Open Northland',
      short_name: 'Northland',
      description: 'An open-source engine for Cultures - 8th Wonder of the World.',
      id: '/',
      start_url: '/',
      display: 'fullscreen',
      orientation: 'landscape',
      categories: ['games'],
      background_color: GROUND,
      theme_color: GROUND,
      icons: [
        ...PWA_ICON_SIZES.map((size) => ({
          src: `/icon-${size}.png`,
          sizes: `${size}x${size}`,
          type: 'image/png',
        })),
        { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
      screenshots: [
        {
          src: '/screenshot-wide.webp',
          sizes: `${screenshot.width}x${screenshot.height}`,
          type: 'image/webp',
          form_factor: 'wide',
          label: 'A Viking settlement',
        },
      ],
    },
    null,
    2,
  )}\n`;
}

async function emit(dir, name, data) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), data);
  console.log(`${join(dir, name).slice(ROOT.length + 1)} (${data.length} bytes)`);
}

const pwaIcons = await Promise.all(PWA_ICON_SIZES.map(async (size) => [size, await iconPng(size)]));
const icoEntries = await Promise.all(ICO_SIZES.map(async (size) => ({ size, png: await iconPng(size) })));
const icnsSlots = await Promise.all(
  ICNS_SLOTS.map(async ([type, size, encoding]) => {
    const png = await macTile(size);
    return [type, encoding === 'argb' ? await icnsArgb(png) : png];
  }),
);

await emit(APP_PUBLIC, 'favicon.ico', ico(icoEntries.filter((e) => e.size <= 48)));
await emit(APP_PUBLIC, 'favicon.svg', smallEmblemSvg);
await emit(
  APP_PUBLIC,
  'apple-touch-icon.png',
  await paintedEmblem(APPLE_TOUCH_ICON_SIZE, ICON_PADDING, GROUND),
);
for (const [size, png] of pwaIcons) await emit(APP_PUBLIC, `icon-${size}.png`, png);
await emit(APP_PUBLIC, 'icon-512-maskable.png', await paintedEmblem(512, MASKABLE_PADDING, GROUND));
await emit(APP_PUBLIC, 'og-image.jpg', await ogImage());
const screenshot = await sharp(SETTLEMENT).resize({ width: SCREENSHOT_WIDTH }).webp(WEBP).toBuffer({
  resolveWithObject: true,
});
await emit(APP_PUBLIC, 'screenshot-wide.webp', screenshot.data);
await emit(APP_PUBLIC, 'site.webmanifest', webManifest(screenshot.info));

await emit(DESKTOP_BUILD, 'icon.png', await paintedEmblem(DESKTOP_ICON_SIZE, ICON_PADDING));
await emit(DESKTOP_BUILD, 'icon.ico', ico(icoEntries));
await emit(DESKTOP_BUILD, 'icon.icns', icns(icnsSlots));

await emit(
  DOCS_IMAGES,
  'logo.webp',
  await sharp(lockupStacked).resize({ width: README_LOGO_WIDTH }).webp(WEBP).toBuffer(),
);
await emit(
  APP_BRAND,
  'logo-stacked.webp',
  await sharp(lockupStacked)
    .resize({ ...BRAND_LOGO_STACKED_SIZE, fit: 'contain', background: TRANSPARENT })
    .webp(WEBP)
    .toBuffer(),
);
