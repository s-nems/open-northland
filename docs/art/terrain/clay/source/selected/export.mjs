import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const dir = import.meta.dirname;
const source = join(dir, 'master.png');
const soil = resolve(dir, '../../../meadow-ground/source/clay/texture.png');
const boxes = JSON.parse(await readFile(join(dir, 'layout.json'), 'utf8'));
const config = { rows: [0, 1, 2, 4, 5], scale: 0.78, grade: { brightness: 0.67, saturation: 0.52, hue: 8 } };

async function rowBands() {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const active = [];
  for (let y = 0; y < info.height; y++) {
    let count = 0;
    for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * info.channels + 3] > 16) count++;
    if (count > 5) active.push(y);
  }
  const bands = [];
  for (const y of active) {
    if (!bands.length || y > bands.at(-1)[1] + 1) bands.push([y, y]);
    else bands.at(-1)[1] = y;
  }
  if (bands.length !== 6) throw new Error(`Expected six generated row bands, found ${bands.length}`);
  return bands.map(([top, bottom]) => [Math.max(0, top - 4), Math.min(info.height - 1, bottom + 4)]);
}

async function alphaCrop(column, band) {
  const left0 = column * 512;
  const top0 = band[0];
  const width0 = 512;
  const height0 = band[1] - band[0] + 1;
  const extracted = await sharp(source)
    .extract({ left: left0, top: top0, width: width0, height: height0 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data, info } = extracted;
  let minX = info.width,
    minY = info.height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * info.channels + 3] <= 16) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  if (maxX < 0) throw new Error(`No visible sprite in column ${column}, band ${band}`);
  const pad = 3;
  const left = Math.max(0, minX - pad),
    top = Math.max(0, minY - pad);
  return [
    left0 + left,
    top0 + top,
    Math.min(width0 - left, maxX - left + pad + 1),
    Math.min(height0 - top, maxY - top + pad + 1),
  ];
}

async function fitted(crop, box, config) {
  const extracted = await sharp(source)
    .extract({ left: crop[0], top: crop[1], width: crop[2], height: crop[3] })
    .modulate(config.grade)
    .png()
    .toBuffer();
  const meta = await sharp(extracted).metadata();
  const maxWidth = box[2] * config.scale;
  const maxHeight = box[3] * config.scale;
  const factor = Math.min(maxWidth / meta.width, maxHeight / meta.height, 1);
  const width = Math.max(1, Math.round(meta.width * factor));
  const height = Math.max(1, Math.round(meta.height * factor));
  return {
    input: await sharp(extracted)
      .resize(width, height, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer(),
    left: Math.round(box[0] + (box[2] - width) / 2),
    top: Math.round(box[1] + (box[3] - height) / 2),
  };
}

const bands = await rowBands();
for (const mine of [1, 2]) {
  const deposits = [];
  for (let state = 0; state < 5; state++) {
    const crop = await alphaCrop(mine - 1, bands[config.rows[state]]);
    deposits.push(await fitted(crop, boxes[mine - 1][state], config));
  }
  const base = await sharp({
    create: { width: 800, height: 144, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(deposits)
    .png()
    .toBuffer();
  const layers = [];
  for (let state = 0; state < 5; state++) {
    const frame = await sharp(base)
      .extract({ left: state * 160, top: 0, width: 160, height: 144 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const patch = await sharp(soil)
      .extract({
        left: (state * 67 + mine * 31) % 352,
        top: (state * 83 + mine * 47) % 368,
        width: 160,
        height: 144,
      })
      .modulate({ brightness: 0.82 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const distance = new Float32Array(160 * 144).fill(24);
    for (let y = 0; y < 144; y++)
      for (let x = 0; x < 160; x++) {
        if (frame.data[(y * 160 + x) * 4 + 3] < 64) continue;
        distance[y * 160 + x] = 0;
        const interior =
          x > 0 &&
          x < 159 &&
          y > 0 &&
          y < 143 &&
          [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ].every(([dx, dy]) => frame.data[((y + dy) * 160 + x + dx) * 4 + 3] >= 64);
        if (interior) continue;
        for (let dy = -23; dy <= 23; dy++)
          for (let dx = -23; dx <= 23; dx++) {
            const px = x + dx,
              py = y + dy;
            if (px < 0 || px >= 160 || py < 0 || py >= 144) continue;
            const d = Math.hypot(dx, dy);
            const index = py * 160 + px;
            if (d < distance[index]) distance[index] = d;
          }
      }
    for (let i = 0; i < patch.data.length; i += 4) {
      const d = distance[i / 4];
      const t = Math.max(0, 1 - d / 13);
      const fade = t * t * (3 - 2 * t);
      patch.data[i + 3] = Math.round(255 * 0.6 * fade);
    }
    layers.push({
      input: await sharp(patch.data, { raw: { width: 160, height: 144, channels: 4 } })
        .png()
        .toBuffer(),
      left: state * 160,
      top: 0,
    });
  }
  layers.push({ input: base, left: 0, top: 0 });
  await sharp({
    create: { width: 800, height: 144, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(layers)
    .png()
    .toFile(join(dir, `mine-0${mine}.png`));
}
