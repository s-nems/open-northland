import { readFile } from 'node:fs/promises';
import type { Browser } from 'playwright';
import sharp from 'sharp';
import { sourcePath } from './paths.js';
import type { Raster } from './recipe.js';
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
  anchor: { x: number; y: number };
}
export async function renderRaster(
  browser: Browser,
  root: string,
  directory: string,
  recipes: { path: string; recipe: Raster }[],
) {
  const sources: Record<string, string> = {};
  for (const { recipe } of recipes)
    for (const draw of recipe.draws)
      for (const name of [draw.source, draw.reference]) {
        if (name !== undefined && sources[name] === undefined)
          sources[name] = (await readFile(await sourcePath(root, directory, name))).toString('base64');
      }
  const page = await browser.newPage();
  try {
    const results = await page.evaluate(
      async ({ recipes, sources }) => {
        const images: Record<string, HTMLImageElement> = {};
        for (const [name, base64] of Object.entries(sources)) {
          const image = new Image();
          image.src = `data:image/png;base64,${base64}`;
          await image.decode();
          images[name] = image;
        }
        const pixelCache = new Map<HTMLImageElement, Uint8ClampedArray>();
        const bounds = (image: HTMLImageElement, requested: number[] | undefined, trim: boolean) => {
          const [x = 0, y = 0, w = image.width, h = image.height] = requested ?? [];
          if (x + w > image.width || y + h > image.height || ![x, y, w, h].every(Number.isInteger))
            throw new Error('Crop outside source image or fractional crop');
          if (!trim) return [x, y, w, h] as const;
          let pixels = pixelCache.get(image);
          if (!pixels) {
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas unavailable');
            ctx.drawImage(image, 0, 0);
            pixels = ctx.getImageData(0, 0, image.width, image.height).data;
            pixelCache.set(image, pixels);
          }
          let left = x + w,
            top = y + h,
            right = -1,
            bottom = -1;
          for (let py = y; py < y + h; py++)
            for (let px = x; px < x + w; px++) {
              if ((pixels[(py * image.width + px) * 4 + 3] ?? 0) <= 16) continue;
              left = Math.min(left, px);
              top = Math.min(top, py);
              right = Math.max(right, px);
              bottom = Math.max(bottom, py);
            }
          if (right < left || bottom < top) throw new Error('Empty alpha cell');
          left = Math.max(x, left - 2);
          top = Math.max(y, top - 2);
          return [left, top, Math.min(x + w, right + 3) - left, Math.min(y + h, bottom + 3) - top] as const;
        };
        return recipes.map(({ path, recipe }) => {
          const canvas = document.createElement('canvas');
          canvas.width = recipe.width;
          canvas.height = recipe.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas unavailable');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          const frames: Frame[] = [];
          const crops: number[][] = [];
          const draws: {
            source: string;
            crop: readonly [number, number, number, number];
            x: number;
            y: number;
            width: number;
            height: number;
          }[] = [];
          for (const draw of recipe.draws) {
            const image = images[draw.source];
            if (!image) throw new Error('Missing draw source');
            const crop = bounds(image, draw.crop, draw.alphaBounds);
            const reference = draw.reference === undefined ? image : images[draw.reference];
            if (!reference) throw new Error('Missing sizing reference');
            const sizing = bounds(reference, draw.crop, draw.alphaBounds);
            const [bx, by, bw, bh] = draw.box;
            const ratio = Math.min(bw / sizing[2], bh / sizing[3], 1);
            let width = draw.fit === 'stretch' ? bw : sizing[2] * ratio;
            let height = draw.fit === 'stretch' ? bh : sizing[3] * ratio;
            if (draw.round || recipe.sampling === 'lanczos3') {
              width = Math.round(width);
              height = Math.round(height);
            }
            if (width <= 0 || height <= 0) throw new Error('Empty output draw');
            if (width > crop[2] || height > crop[3]) throw new Error('Export would upscale');
            let x = bx,
              y = by;
            if (draw.align !== 'start') x += (bw - width) / 2;
            if (draw.align === 'center') y += (bh - height) / 2;
            if (draw.align === 'bottom') y += bh - height;
            if (recipe.sampling === 'lanczos3') {
              x = Math.round(x);
              y = Math.round(y);
            }
            if (x + width > canvas.width || y + height > canvas.height)
              throw new Error('Draw outside output canvas');
            ctx.drawImage(image, ...crop, x, y, width, height);
            draws.push({ source: draw.source, crop, x, y, width, height });
            crops.push([...crop]);
            if (draw.frameAnchor) {
              if (![x, y, width, height].every(Number.isInteger))
                throw new Error('Atlas frame must have integer bounds');
              if (
                frames.some(
                  (f) => x < f.x + f.width && x + width > f.x && y < f.y + f.height && y + height > f.y,
                )
              )
                throw new Error('Generated atlas frames overlap');
              frames.push({
                x,
                y,
                width,
                height,
                anchor: { x: width * draw.frameAnchor.x, y: height * draw.frameAnchor.y },
              });
            }
          }
          const png = canvas.toDataURL('image/png').split(',')[1] ?? '';
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const alpha = { zero: 0, partial: 0, opaque: 0 };
          for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i] === 0) alpha.zero++;
            else if (pixels[i] === 255) alpha.opaque++;
            else alpha.partial++;
          }
          if (recipe.alpha === 'transparent' && (alpha.zero === 0 || alpha.partial + alpha.opaque === 0))
            throw new Error('Expected visible sprite and transparent background');
          if (recipe.alpha === 'opaque' && alpha.zero + alpha.partial > 0)
            throw new Error('Expected opaque material');
          return { path, png, frames, crops, alpha, draws };
        });
      },
      { recipes, sources },
    );
    for (const result of results) {
      const job = recipes.find((r) => r.path === result.path);
      if (job?.recipe.sampling !== 'lanczos3') continue;
      const composites = [];
      for (const draw of result.draws) {
        const base64 = sources[draw.source];
        if (!base64) throw new Error('Missing native source');
        const [left, top, width, height] = draw.crop;
        const input = await sharp(Buffer.from(base64, 'base64'))
          .extract({ left, top, width, height })
          .resize(draw.width, draw.height, { fit: 'fill', kernel: 'lanczos3', withoutEnlargement: true })
          .png()
          .toBuffer();
        composites.push({ input, left: draw.x, top: draw.y });
      }
      const png = await sharp({
        create: { width: job.recipe.width, height: job.recipe.height, channels: 4, background: '#00000000' },
      })
        .composite(composites)
        .png()
        .toBuffer();
      const pixels = await sharp(png).ensureAlpha().raw().toBuffer();
      const alpha = { zero: 0, partial: 0, opaque: 0 };
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 0) alpha.zero++;
        else if (pixels[i] === 255) alpha.opaque++;
        else alpha.partial++;
      }
      if (job.recipe.alpha === 'opaque' && alpha.zero + alpha.partial > 0)
        throw new Error('Expected opaque material');
      if (job.recipe.alpha === 'transparent' && (alpha.zero === 0 || alpha.partial + alpha.opaque === 0))
        throw new Error('Expected visible sprite and transparent background');
      result.png = png.toString('base64');
      result.alpha = alpha;
    }
    return results;
  } finally {
    await page.close();
  }
}
