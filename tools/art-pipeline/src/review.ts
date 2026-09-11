import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { deliverySchema } from './approval.js';
import { candidate } from './candidate.js';
import { json } from './files.js';
import { presentationDigest } from './presentation.js';
import { reviewPage } from './review-page.js';
import { exists } from './transaction.js';
export async function review(root: string, id: string) {
  const current = await candidate(root, id),
    items = [];
  const registry = deliverySchema.parse(await json(join(root, 'docs/art/delivery.json')));
  const paths = [...new Set([...Object.keys(current.report.files), ...(registry[id] ?? [])])].sort();
  const metadata = [];
  for (const path of paths.filter((f) => f.endsWith('.json'))) {
    const previousPath = join(root, 'packages/app/src/assets/own', path);
    metadata.push({
      path,
      next: current.report.files[path] ? await json(join(current.delivery, path)) : null,
      previous: (await exists(previousPath)) ? await json(previousPath) : null,
    });
  }
  for (const path of paths.filter((f) => f.endsWith('.png'))) {
    const next = current.report.files[path] ? await readFile(join(current.delivery, path)) : undefined,
      previousPath = join(root, 'packages/app/src/assets/own', path);
    const previous = (await exists(previousPath)) ? await readFile(previousPath) : undefined;
    let changedPixels: number | null = null;
    if (previous && next) {
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
      next: next?.toString('base64') ?? null,
      previous: previous?.toString('base64') ?? null,
      changedPixels,
      manifest,
      beforeManifest,
    });
  }
  const digest = await presentationDigest(current.delivery);
  const path = join(current.directory, 'review.html');
  await writeFile(path, reviewPage({ id, digest, items, metadata }));
  return { path, id, digest };
}
