import sharp from 'sharp';

export const CELL_W = 96;
export const CELL_H = 72;
// Strip and atlas order of the eight facings: the engine's settler facing index, which is also the order the
// original stores them in (not a uniform rotation).
export const ATLAS_FACINGS = ['SW', 'W', 'NW', 'NE', 'E', 'SE', 'S', 'N'];
export const ALPHA_VISIBLE = 8;
export const ALPHA_CRISP = 128;
// Inner edge darkening: opaque pixels touching transparency keep their hue but drop to this brightness.
export const EDGE_DARKEN = 0.6;
const BASE = {
  kernel: 'lanczos3',
  sharpen: 0,
  crisp: false,
  edge: false,
  brightness: 1,
  saturation: 1,
  contrast: 1,
};
export const POST = {
  'strong-separation': { ...BASE, sharpen: 0.5, crisp: true, saturation: 1.08, contrast: 1.1, edge: true },
  'soft-separation': { ...BASE, sharpen: 0.2, saturation: 1.04, contrast: 1.05 },
};

export async function alphaBox(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width,
    minY = info.height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > ALPHA_VISIBLE) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function unionBox(boxes) {
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  return { left, top, width: right - left, height: bottom - top };
}

function crispAlpha(data) {
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] >= ALPHA_CRISP ? 255 : 0;
}

// Darken every opaque pixel that touches a transparent one (after crisp alpha).
function darkenEdges(data, width, height) {
  const opaque = (x, y) =>
    x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] === 255;
  const rim = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaque(x, y)) continue;
      if (!opaque(x - 1, y) || !opaque(x + 1, y) || !opaque(x, y - 1) || !opaque(x, y + 1))
        rim.push((y * width + x) * 4);
    }
  }
  for (const i of rim) {
    data[i] = Math.round(data[i] * EDGE_DARKEN);
    data[i + 1] = Math.round(data[i + 1] * EDGE_DARKEN);
    data[i + 2] = Math.round(data[i + 2] * EDGE_DARKEN);
  }
}

export async function figureFromRender(file, box, scale, post) {
  const w = Math.max(1, Math.round(box.width * scale));
  const h = Math.max(1, Math.round(box.height * scale));
  let img = sharp(file).extract(box).resize(w, h, { kernel: post.kernel });
  if (post.sharpen > 0) img = img.sharpen({ sigma: post.sharpen });
  if (post.saturation !== 1 || post.brightness !== 1)
    img = img.modulate({ brightness: post.brightness, saturation: post.saturation });
  if (post.contrast !== 1) img = img.linear(post.contrast, 128 * (1 - post.contrast));
  const plain = !post.crisp && !post.edge;
  if (plain) return { png: await img.png().toBuffer(), width: w, height: h };
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width,
    height = info.height;
  if (post.crisp) crispAlpha(data);
  if (post.edge) darkenEdges(data, width, height);
  const png = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return { png, width, height };
}

export function parseArgs(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
