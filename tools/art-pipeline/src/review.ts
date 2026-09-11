import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { candidate } from './candidate.js';
import { json } from './files.js';
import { presentationDigest } from './presentation.js';
import { reviewPage } from './review-page.js';
import { exists } from './transaction.js';
export async function review(root: string, id: string) {
  const current = await candidate(root, id),
    items = [];
  for (const path of Object.keys(current.report.files).filter((f) => f.endsWith('.png'))) {
    const next = await readFile(join(current.delivery, path)),
      previousPath = join(root, 'packages/app/src/assets/own', path);
    const previous = (await exists(previousPath)) ? await readFile(previousPath) : undefined;
    let changedPixels: number | null = null;
    if (previous) {
      const a = await sharp(previous).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const b = await sharp(next).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (a.info.width === b.info.width && a.info.height === b.info.height) {
        changedPixels = 0;
        for (let i = 0; i < a.data.length; i += 4)
          if (!a.data.subarray(i, i + 4).equals(b.data.subarray(i, i + 4))) changedPixels++;
      }
    }
    const manifestPath = join(current.delivery, dirname(path), 'runtime.json');
    const manifest = (await exists(manifestPath)) ? await json(manifestPath) : null;
    const beforeManifestPath = join(root, 'packages/app/src/assets/own', dirname(path), 'runtime.json');
    const beforeManifest = (await exists(beforeManifestPath)) ? await json(beforeManifestPath) : null;
    items.push({
      path,
      next: next.toString('base64'),
      previous: previous?.toString('base64') ?? null,
      changedPixels,
      manifest,
      beforeManifest,
    });
  }
  const digest = await presentationDigest(current.delivery);
  const path = join(current.directory, 'review.html');
  await writeFile(path, reviewPage({ id, digest, items }));
  return { path, id, digest };
}
