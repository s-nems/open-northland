import { readFile, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { loadAsset } from './catalog.js';
import { characterInputs } from './character.js';
import { digest, listFiles } from './files.js';
import { sourcePath } from './paths.js';
export async function inputHashes(root: string, asset: Awaited<ReturnType<typeof loadAsset>>) {
  const files = new Set<string>([asset.path, join(root, 'package-lock.json')]);
  for (const folder of ['tools/art-pipeline/src', 'packages/art-contracts/src'])
    for (const file of await listFiles(join(root, folder))) files.add(join(root, folder, file));
  for (const output of asset.recipe.outputs) {
    const c = output.content;
    if (c.operation === 'copy') files.add(await sourcePath(root, asset.directory, c.source));
    if (c.operation === 'raster')
      for (const draw of c.draws)
        for (const name of [draw.source, draw.reference])
          if (name) files.add(await sourcePath(root, asset.directory, name));
    if (c.operation === 'character')
      for (const path of await characterInputs(asset.directory, c.source, c.shadow)) {
        const resolved = await realpath(path);
        await sourcePath(
          root,
          root,
          relative(await realpath(root), resolved)
            .split(sep)
            .join('/'),
        );
        files.add(resolved);
      }
  }
  const result: Record<string, string> = {};
  const canonicalRoot = await realpath(root);
  for (const file of [...files].sort())
    result[
      relative(canonicalRoot, await realpath(file))
        .split(sep)
        .join('/')
    ] = digest(await readFile(file));
  return result;
}
