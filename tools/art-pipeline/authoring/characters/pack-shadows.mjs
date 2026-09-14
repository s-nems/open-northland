import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { ATLAS_FACINGS } from './sprite-post.mjs';

const lightingPath = fileURLToPath(new URL('../../../../docs/art/lighting.json', import.meta.url));
const lighting = JSON.parse(await fs.readFile(lightingPath, 'utf8'));
const run = path.resolve(process.argv[2]);
const recipe = JSON.parse(await fs.readFile(path.join(run, 'recipe.json'), 'utf8'));
for (const clip of recipe.clips) {
  const frames = clip.frames ?? recipe.frames;
  if (!Number.isInteger(frames) || frames < 1 || frames > 16)
    throw new Error(`${clip.name}: expected at most 16 stored frames per facing, got ${frames}`);
}
const layout = JSON.parse(await fs.readFile(path.join(run, 'layout.json'), 'utf8'));
const clips = [
  recipe.clips.find((c) => c.name === 'walk'),
  recipe.clips.find((c) => c.name === 'idle'),
  ...recipe.clips.filter((c) => c.atomicId !== undefined && c.poses === undefined),
  ...recipe.clips.filter((c) => c.carryGood !== undefined),
];
const count = 8 * clips.reduce((sum, c) => sum + (c.frames ?? recipe.frames), 0);
const columns = count > 576 ? 40 : 24;
const stagingSize = 768,
  anchorX = 352,
  anchorY = 384;
const inputs = {};
for (const file of ['layout.json', 'recipe.json']) {
  inputs[file] = createHash('sha256')
    .update(await fs.readFile(path.join(run, file)))
    .digest('hex');
}
const composites = [];
const bounds = { left: anchorX, top: anchorY, right: anchorX, bottom: anchorY };
for (const clip of clips) {
  for (const facing of ATLAS_FACINGS) {
    const name = `${clip.name}-${facing}`;
    const directory = path.join(run, '.work/shadow-render', name);
    const receipt = JSON.parse(await fs.readFile(path.join(directory, 'inputs.json'), 'utf8'));
    for (const [file, expected] of Object.entries(receipt)) {
      if (path.basename(file) === 'run-character.py') continue;
      const hash = createHash('sha256')
        .update(await fs.readFile(path.resolve(run, file)))
        .digest('hex');
      if (hash !== expected) throw new Error(`Stale shadow render: ${file}`);
      inputs[file] = hash;
    }
    const body = `sprites/${name}-88px.png`;
    inputs[body] = createHash('sha256')
      .update(await fs.readFile(path.join(run, body)))
      .digest('hex');
    const { box, scale } = layout[name];
    for (let frame = 0; frame < (clip.frames ?? recipe.frames); frame++) {
      const source = path.join(directory, `f${String(frame).padStart(2, '0')}.png`);
      const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let y = 0; y < info.height; y++)
        for (let x = 0; x < info.width; x++) {
          if (
            (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) &&
            data[(y * info.width + x) * 4 + 3]
          )
            throw new Error(`Shadow exceeds source camera: ${name}/${frame}`);
        }
      const scaled = await sharp(source)
        .resize(Math.round(info.width * scale), Math.round(info.height * scale))
        .blur(lighting.shadow.characterBlurPixels)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      for (let i = 0; i < scaled.data.length; i += 4) {
        scaled.data[i] = lighting.shadow.rgb[0];
        scaled.data[i + 1] = lighting.shadow.rgb[1];
        scaled.data[i + 2] = lighting.shadow.rgb[2];
        scaled.data[i + 3] = Math.round(scaled.data[i + 3] * lighting.shadow.characterOpacity);
      }
      const input = await sharp(scaled.data, {
        raw: {
          width: scaled.info.width,
          height: scaled.info.height,
          channels: 4,
        },
      })
        .png()
        .toBuffer();
      const padding = (info.width - (recipe.render?.size ?? 512)) / 2;
      const left = Math.round(anchorX - (padding + box.left + box.width / 2) * scale);
      const top = Math.round(anchorY - (padding + box.top + box.height) * scale);
      const padded = await sharp({
        create: {
          width: stagingSize,
          height: stagingSize,
          channels: 4,
          background: '#00000000',
        },
      })
        .composite([{ input, left, top }])
        .png()
        .toBuffer();
      const pixels = await sharp(padded).ensureAlpha().raw().toBuffer();
      let visible = 0;
      for (let y = 0; y < stagingSize; y++)
        for (let x = 0; x < stagingSize; x++) {
          if (!pixels[(y * stagingSize + x) * 4 + 3]) continue;
          visible++;
          bounds.left = Math.min(bounds.left, x);
          bounds.top = Math.min(bounds.top, y);
          bounds.right = Math.max(bounds.right, x);
          bounds.bottom = Math.max(bounds.bottom, y);
          if (x < 2 || x >= stagingSize - 2 || y < 2 || y >= stagingSize - 2)
            throw new Error(`Shadow exceeds staging raster: ${name}/${frame}`);
        }
      if (!visible) throw new Error(`Empty shadow: ${name}/${frame}`);
      composites.push(padded);
    }
  }
}
const crop = {
  left: bounds.left - 2,
  top: bounds.top - 2,
  width: bounds.right - bounds.left + 5,
  height: bounds.bottom - bounds.top + 5,
};
const packed = await Promise.all(
  composites.map(async (cell, i) => ({
    input: await sharp(cell).extract(crop).png().toBuffer(),
    left: (i % columns) * crop.width,
    top: Math.floor(i / columns) * crop.height,
  })),
);
const width = columns * crop.width,
  height = Math.ceil(count / columns) * crop.height;
const destination = path.join(run, 'shadows');
await fs.mkdir(destination, { recursive: true });
await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
  .composite(packed)
  .png()
  .toFile(path.join(destination, 'atlas.png'));
await fs.writeFile(
  path.join(destination, 'shadow.json'),
  `${JSON.stringify(
    {
      sprite: 'shadow.png',
      width,
      height,
      cellWidth: crop.width,
      cellHeight: crop.height,
      columns,
      anchorX: anchorX - crop.left,
      anchorY: anchorY - crop.top,
      clips: clips.map((c) => c.name),
      basis: `Evaluated Blender geometry projected onto flat ground using ${lighting.id} from docs/art/lighting.json. Camera conversion preserves the reference screen-space direction and length relative to projected height. Flat receiver and fixed character blur are artistic approximations. Body camera, layout, poses and attachments retained.`,
      inputs,
    },
    null,
    2,
  )}\n`,
);
console.log(`${count} shadow frames: ${width}x${height}`);
