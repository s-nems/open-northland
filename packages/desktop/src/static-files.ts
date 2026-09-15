import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

/**
 * The file a request pathname names under `root`, or undefined: a missing file, a directory, a
 * malformed percent sequence, and any path that would leave the root all read the same way. `root` is
 * an absolute host constant, never request input.
 */
export async function fileUnderRoot(root: string, rawPathname: string): Promise<string | undefined> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return undefined;
  }
  const file = resolve(root, `.${sep}${pathname.replace(/^\/+/, '')}`);
  if (!file.startsWith(`${root}${sep}`)) return undefined;
  try {
    return (await stat(file)).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}
