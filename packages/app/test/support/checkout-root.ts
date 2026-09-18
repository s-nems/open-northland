import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The checkout this module belongs to. Its callers run both from source under vitest and from the
 * compiled copy under `packages/app/dist`, which sits one directory deeper, so the root is searched
 * for rather than counted off this file's own path.
 */

/** Present at the checkout root and nowhere below it. */
const ROOT_MARKER = 'tsconfig.base.json';

function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(dir, ROOT_MARKER))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no ${ROOT_MARKER} above ${import.meta.url}`);
    dir = parent;
  }
  return dir;
}

const root = findRoot();

export function checkoutRoot(): string {
  return root;
}
