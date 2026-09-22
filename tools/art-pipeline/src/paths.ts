import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { relativePath } from './recipe.js';
export function runtimePack(root: string): string {
  return join(root, 'packages/app/src/assets/custom');
}
/** The runtime pack's `ui/` subtree is shared with the public game, which reads this mirror of it. */
export const SHARED_UI = 'ui';
export function sharedUiMirror(root: string): string {
  return join(root, 'packages/app/src/assets/ui');
}
export function inside(root: string, path: string): string {
  const destination = resolve(root, relativePath.parse(path));
  const rel = relative(root, destination);
  if (isAbsolute(rel) || rel.split(sep)[0] === '..') throw new Error('Path outside root');
  return destination;
}
export async function sourcePath(root: string, directory: string, path: string) {
  const file = await realpath(inside(directory, path));
  const rel = relative(await realpath(root), file);
  if (isAbsolute(rel) || rel.split(sep)[0] === '..') throw new Error('Source symlink outside repository');
  return file;
}
