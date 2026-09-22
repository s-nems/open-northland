// Derives every committed brand asset from the masters in source/. Run `npm run brand` from the root
// after changing a master; the outputs are committed so the app, the desktop build and the README
// need no image tooling.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SOURCE = join(HERE, 'source');
const APP_PUBLIC = join(ROOT, 'packages/app/public');
const APP_BRAND = join(ROOT, 'packages/app/src/assets/brand');
const DESKTOP_BUILD = join(ROOT, 'packages/desktop/build');
const DOCS_IMAGES = join(ROOT, 'docs/images');

/** The page and menu ground; also the manifest theme colour. Mirrors the body background in index.html. */
const GROUND = '#1a1410';
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
/** Alpha above this counts as drawn when checking a master's edges. */
const EDGE_ALPHA_THRESHOLD = 16;

/**
 * Below this edge the painted longship turns to mud, so the N monogram stands in for it. Browsers on
 * high-density screens draw a 16 px favicon slot at 32 px, which is the monogram's native grid.
 */
const MONOGRAM_MAX_SIZE = 32;
const MONOGRAM_SVG_VIEWBOX = 32;

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
const OG_IMAGE = { width: 1200, height: 630, logoWidth: 1000 };
const README_LOGO_WIDTH = 1600;
const MENU_LOGO_WIDTH = 1200;
const WEBP = { quality: 90, alphaQuality: 100 };

const emblemRaster = await trimmedMaster('emblem.png');
const lockupHorizontal = await trimmedMaster('lockup-horizontal.png');
const lockupStacked = await trimmedMaster('lockup-stacked.png');
const monogramSvg = await readFile(join(SOURCE, 'monogram.svg'));

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

async function monogram(size) {
  const density = (72 * size) / MONOGRAM_SVG_VIEWBOX;
  return sharp(monogramSvg, { density }).resize(size, size).png().toBuffer();
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
  return size <= MONOGRAM_MAX_SIZE ? monogram(size) : paintedEmblem(size, ICON_PADDING);
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

async function ogImage() {
  const logo = await sharp(lockupHorizontal).resize({ width: OG_IMAGE.logoWidth }).png().toBuffer();
  return sharp({
    create: { width: OG_IMAGE.width, height: OG_IMAGE.height, channels: 4, background: GROUND },
  })
    .composite([{ input: logo, gravity: 'centre' }])
    .png()
    .toBuffer();
}

function webManifest() {
  return `${JSON.stringify(
    {
      name: 'Open Northland',
      short_name: 'Northland',
      description: 'An open-source engine for Cultures - 8th Wonder of the World.',
      start_url: '/',
      display: 'standalone',
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
    const png = await iconPng(size);
    return [type, encoding === 'argb' ? await icnsArgb(png) : png];
  }),
);

await emit(APP_PUBLIC, 'favicon.ico', ico(icoEntries.filter((e) => e.size <= 48)));
await emit(APP_PUBLIC, 'favicon.svg', monogramSvg);
await emit(
  APP_PUBLIC,
  'apple-touch-icon.png',
  await paintedEmblem(APPLE_TOUCH_ICON_SIZE, ICON_PADDING, GROUND),
);
for (const [size, png] of pwaIcons) await emit(APP_PUBLIC, `icon-${size}.png`, png);
await emit(APP_PUBLIC, 'icon-512-maskable.png', await paintedEmblem(512, MASKABLE_PADDING, GROUND));
await emit(APP_PUBLIC, 'og-image.png', await ogImage());
await emit(APP_PUBLIC, 'site.webmanifest', webManifest());

await emit(DESKTOP_BUILD, 'icon.png', await paintedEmblem(DESKTOP_ICON_SIZE, ICON_PADDING));
await emit(DESKTOP_BUILD, 'icon.ico', ico(icoEntries));
await emit(DESKTOP_BUILD, 'icon.icns', icns(icnsSlots));

await emit(
  DOCS_IMAGES,
  'logo.webp',
  await sharp(lockupHorizontal).resize({ width: README_LOGO_WIDTH }).webp(WEBP).toBuffer(),
);
await emit(
  APP_BRAND,
  'logo-stacked.webp',
  await sharp(lockupStacked).resize({ width: MENU_LOGO_WIDTH }).webp(WEBP).toBuffer(),
);
