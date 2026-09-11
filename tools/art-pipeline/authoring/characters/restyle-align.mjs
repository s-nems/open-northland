import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ATLAS_FACINGS, alphaBox, parseArgs } from './sprite-post.mjs';

const args = parseArgs(process.argv.slice(2), { angle: '15' });
if (!args.cells || !args.renders || !args.out) {
  console.error('usage: node restyle-align.mjs --cells <dir> --renders <dir> [--angle 15] --out <dir>');
  process.exit(1);
}
fs.mkdirSync(args.out, { recursive: true });
for (const facing of ATLAS_FACINGS) {
  const render = path.join(args.renders, `${args.angle}deg`, `${facing}.png`);
  const cellFile = path.join(args.cells, `${args.angle}deg`, `${facing}.png`);
  const { width, height } = await sharp(render).metadata();
  const renderBox = await alphaBox(render);
  const box = await alphaBox(cellFile);
  const scale = renderBox.height / box.height;
  const w = Math.max(1, Math.round(box.width * scale)),
    h = Math.max(1, Math.round(box.height * scale));
  const figure = await sharp(cellFile)
    .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
    .resize(w, h, { kernel: 'lanczos3' })
    .png()
    .toBuffer();
  const left = Math.round(renderBox.left + renderBox.width / 2 - w / 2);
  const top = renderBox.top + renderBox.height - h;
  const out = path.join(args.out, `${facing}.png`);
  await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: figure, left, top }])
    .png()
    .toFile(out);
  console.log(
    facing,
    `${box.width}x${box.height} -> ${w}x${h} at ${left},${top}`,
    `scale ${scale.toFixed(3)}`,
  );
}
