// GUI-atlas montage generator — the human-oracle tool behind `packages/app/src/content/gui-atlas-map.ts`.
//
// Decodes a GUI bob sheet (`ls_gui_window.bmd` / `ls_gui_bubbles.bmd`) straight from an OWNED game copy and
// lays EVERY frame out in a numbered grid — a big index label + native size + hex id per cell, over a
// checkerboard so transparency and extent are visible — so a person can identify each sprite by eye and
// promote its `unknown_NNN` map entry to a real name. An agent can't self-judge pixels; this makes the
// frames legible for the one who can. Writes a PNG; commits nothing (reads copyrighted bytes, emits a
// local file only).
//
// Prereq: build the decoders first — `npm run build --workspace @vinland/asset-pipeline` (raw-TS can't
// resolve the `.js` import specifiers; same reason `npm run pipeline` compiles before running).
//
// Usage (from the repo root):
//   node tools/asset-pipeline/scripts/gui-montage.mjs \
//     [--game "../Cultures 8th Wonder"] [--sheet ls_gui_window] [--palette iconsleft] \
//     [--out gui-montage.png] [--cols 12] [--from 0] [--to <last>]
//
// The correct per-frame palette isn't known until frames are identified, so re-run with `--palette` to
// compare: `iconsleft` (tool panel), `context` (order icons), `bar_hitpoints`/`bar_standart` (bars),
// `bg_normal` (legible neutral). Palette names are the `Data/gui/palettes/<name>.pcx` carriers.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', 'dist', 'decoders');
const { decodeBmd, decodeBobFrame } = await import(join(DIST, 'bmd.js'));
const { decodePcx } = await import(join(DIST, 'pcx.js'));
const { expandBobFrame } = await import(join(DIST, 'atlas.js'));
const { encodePng } = await import(join(DIST, 'png.js'));

// ---- args ----
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const gameDir = arg('game', '../Cultures 8th Wonder');
const sheet = arg('sheet', 'ls_gui_window');
const paletteName = arg('palette', 'iconsleft');
const cols = Number.parseInt(arg('cols', '12'), 10);
const outPath = arg('out', `gui-montage-${sheet}-${paletteName}.png`);

const bmd = decodeBmd(new Uint8Array(readFileSync(join(gameDir, 'Data/engine2d/bin/bobs', `${sheet}.bmd`))));
const palette = decodePcx(
  new Uint8Array(readFileSync(join(gameDir, 'Data/gui/palettes', `${paletteName}.pcx`))),
).palette;
const from = Number.parseInt(arg('from', '0'), 10);
const to = Number.parseInt(arg('to', String(bmd.bobCount - 1)), 10);

// ---- tiny 5x7 bitmap font (digits, lowercase hex a-f, '#', 'x', space), so labels need no font file ----
const FONT = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  a: ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
  b: ['10000', '10000', '11110', '10001', '10001', '10001', '11110'],
  c: ['00000', '00000', '01111', '10000', '10000', '10000', '01111'],
  d: ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
  e: ['00000', '00000', '01110', '10001', '11111', '10000', '01110'],
  f: ['00110', '01000', '11110', '01000', '01000', '01000', '01000'],
  x: ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
  '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
const GW = 5;
const GH = 7;

function setPx(img, x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const o = (y * img.width + x) * 4;
  img.rgba[o] = r;
  img.rgba[o + 1] = g;
  img.rgba[o + 2] = b;
  img.rgba[o + 3] = a;
}
function fillRect(img, x, y, w, h, r, g, b, a = 255) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(img, xx, yy, r, g, b, a);
}
function drawText(img, str, x, y, scale, [r, g, b]) {
  let cx = x;
  for (const ch of str) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let gy = 0; gy < GH; gy++)
      for (let gx = 0; gx < GW; gx++)
        if (glyph[gy][gx] === '1') fillRect(img, cx + gx * scale, y + gy * scale, scale, scale, r, g, b);
    cx += (GW + 1) * scale;
  }
}
function textWidth(str, scale) {
  return str.length * (GW + 1) * scale - scale;
}
// nearest-neighbor, alpha-keyed blit of a source RGBA image
function blitScaled(dst, src, sw, sh, dx, dy, scale) {
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  for (let yy = 0; yy < dh; yy++)
    for (let xx = 0; xx < dw; xx++) {
      const sx = Math.min(sw - 1, Math.floor(xx / scale));
      const sy = Math.min(sh - 1, Math.floor(yy / scale));
      const so = (sy * sw + sx) * 4;
      if (src[so + 3] === 0) continue;
      setPx(dst, dx + xx, dy + yy, src[so], src[so + 1], src[so + 2], 255);
    }
}

// ---- layout ----
const BOX = 128; // sprite fit box; frames scale to fit (small ones up to 4x, big ones down)
const PAD = 8;
const LABEL_H = 34;
const CELL_W = BOX + PAD * 2;
const CELL_H = BOX + PAD + LABEL_H;
const count = to - from + 1;
const rows = Math.ceil(count / cols);
const W = cols * CELL_W;
const H = rows * CELL_H;
const img = { width: W, height: H, rgba: new Uint8Array(W * H * 4) };
fillRect(img, 0, 0, W, H, 24, 24, 28);

for (let k = 0; k < count; k++) {
  const i = from + k;
  const cx = (k % cols) * CELL_W;
  const cy = ((k / cols) | 0) * CELL_H;
  const ax = cx + PAD;
  const ay = cy + PAD;
  for (let yy = 0; yy < BOX; yy++)
    for (let xx = 0; xx < BOX; xx++) {
      const c = ((xx >> 3) + (yy >> 3)) & 1 ? 64 : 48;
      setPx(img, ax + xx, ay + yy, c, c, c);
    }
  const f = decodeBobFrame(bmd, i);
  if (f.width > 0 && f.height > 0) {
    const { rgba } = expandBobFrame(f, palette);
    const scale = Math.min(4, BOX / Math.max(f.width, f.height));
    const dw = Math.round(f.width * scale);
    const dh = Math.round(f.height * scale);
    blitScaled(img, rgba, f.width, f.height, ax + ((BOX - dw) >> 1), ay + ((BOX - dh) >> 1), scale);
  }
  const ly = cy + PAD + BOX;
  fillRect(img, cx, ly, CELL_W, LABEL_H, 12, 12, 16);
  drawText(img, `#${i}`, cx + PAD, ly + 4, 3, [255, 220, 40]);
  drawText(img, `${f.width}x${f.height}`, cx + PAD, ly + 24, 1, [150, 200, 255]);
  const hex = `0x${i.toString(16).padStart(2, '0')}`;
  drawText(img, hex, cx + CELL_W - PAD - textWidth(hex, 1), ly + 24, 1, [150, 150, 160]);
}

writeFileSync(outPath, encodePng(img));
console.log(
  `wrote ${outPath}  (${W}x${H}, ${sheet}: frames ${from}-${to} through palette '${paletteName}', ${cols}x${rows} grid)`,
);
