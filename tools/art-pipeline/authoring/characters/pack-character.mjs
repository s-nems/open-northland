import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { ATLAS_FACINGS, alphaBox, figureFromRender, POST, unionBox } from './sprite-post.mjs';

const [runArg, renderArg, preset = 'strong-separation', outputArg] = process.argv.slice(2);
if (!runArg || !renderArg)
  throw new Error('usage: node pack-character.mjs <character dir> <render dir> [preset] [output dir]');
if (!Object.hasOwn(POST, preset)) throw new Error(`Unknown preset: ${preset}`);
const run = path.resolve(runArg),
  renders = path.resolve(renderArg);
const out = outputArg ? path.resolve(outputArg) : path.join(run, 'sprites');
await fs.mkdir(out, { recursive: true });
const layoutFile = path.join(run, 'layout.json');
const layout = await fs
  .readFile(layoutFile, 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return {};
  });
const names = (await fs.readdir(renders))
  .filter((name) => /^(walk|idle|chop|run|[a-z]+)-[NSEW]+$/.test(name))
  .sort();
const boxes = new Map();
for (const name of names) {
  const files = (await fs.readdir(path.join(renders, name)))
    .filter((f) => /^f\d+\.png$/.test(f))
    .sort((a, b) => Number(a.slice(1, -4)) - Number(b.slice(1, -4)));
  if (!files.length) throw new Error(`No frames: ${name}`);
  if (files.length > 16) throw new Error(`${name}: exceeds 16 stored frames per facing`);
  boxes.set(name, {
    files,
    box: unionBox(await Promise.all(files.map((f) => alphaBox(path.join(renders, name, f))))),
  });
}
const report = [];
for (const [name, { files, box }] of boxes) {
  const projection = await fs
    .readFile(path.join(renders, name, 'projection.json'), 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === 'ENOENT') return { padding: 0 };
      throw error;
    });
  const padding = projection.padding;
  if (!Number.isInteger(padding) || padding < 0) throw new Error(`Invalid render padding: ${name}`);
  if (!layout[name]) {
    const reference = boxes.get('walk-SW');
    if (!name.startsWith('walk-') && !reference)
      throw new Error('Render walk-SW first to establish equipment scale');
    layout[name] = {
      box: { ...box, left: box.left - padding, top: box.top - padding },
      scale: 88 / (name.startsWith('walk-') ? box.height : reference.box.height),
    };
  }
  const { box: anchor, scale } = layout[name];
  const frames = [];
  for (const [index, file] of files.entries()) {
    const source = path.join(renders, name, file);
    const meta = await sharp(source).metadata();
    const bounds = await alphaBox(source);
    if (
      bounds.left === 0 ||
      bounds.top === 0 ||
      bounds.left + bounds.width >= meta.width ||
      bounds.top + bounds.height >= meta.height
    )
      throw new Error(`Clipped source render: ${name}/${file}; add renderPadding`);
    const fig = await figureFromRender(
      source,
      { left: 0, top: 0, width: meta.width, height: meta.height },
      scale,
      POST[preset],
    );
    const left = Math.round(96 - (anchor.left + anchor.width / 2 + padding) * scale);
    const top = Math.round(128 - (anchor.top + anchor.height + padding) * scale);
    const padded = await sharp({ create: { width: 768, height: 768, channels: 4, background: '#00000000' } })
      .composite([{ input: fig.png, left: left + 256, top: top + 256 }])
      .png()
      .toBuffer();
    const canvas = await sharp(padded)
      .extract({ left: 256, top: 256, width: 192, height: 144 })
      .png()
      .toBuffer();
    const pixels = await sharp(canvas).ensureAlpha().raw().toBuffer();
    let area = 0;
    for (let y = 0; y < 144; y++)
      for (let x = 0; x < 192; x++) {
        const alpha = pixels[(y * 192 + x) * 4 + 3];
        if (POST[preset].crisp && alpha !== 0 && alpha !== 255)
          throw new Error(`Soft alpha: ${name}/${file}`);
        if (alpha) {
          area++;
          if (x === 0 || x === 191 || y === 0 || y === 143) throw new Error(`Clipped frame: ${name}/${file}`);
        }
      }
    if (area < 100) throw new Error(`Empty frame: ${name}/${file}`);
    frames.push({ input: canvas, left: index * 192, top: 0 });
  }
  await sharp({ create: { width: 192 * frames.length, height: 144, channels: 4, background: '#00000000' } })
    .composite(frames)
    .png()
    .toFile(path.join(out, `${name}-88px.png`));
  report.push({ clip: name, frames: frames.length });
}
if (ATLAS_FACINGS.every((f) => boxes.has(`walk-${f}`))) {
  const cells = await Promise.all(
    ATLAS_FACINGS.map(async (f, index) => ({
      input: await sharp(path.join(out, `walk-${f}-88px.png`))
        .extract({ left: 0, top: 0, width: 192, height: 144 })
        .png()
        .toBuffer(),
      left: index * 192,
      top: 0,
    })),
  );
  await sharp({ create: { width: 1536, height: 144, channels: 4, background: '#00000000' } })
    .composite(cells)
    .png()
    .toFile(path.join(out, 'facings-88px.png'));
}
await fs.writeFile(layoutFile, JSON.stringify(layout, null, 2) + '\n');
console.log(
  JSON.stringify({ clips: report, hardAlpha: POST[preset].crisp, nonempty: true, edgeContacts: 0 }),
);
