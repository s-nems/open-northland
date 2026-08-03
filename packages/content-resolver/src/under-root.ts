import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * The shared containment rule: a request may only ever reach an existing file inside the root it was
 * routed to. `root` must be absolute and normalized - a host constant, never a request - and
 * `relative` is matched as given, so a host that wants percent-decoding does it first.
 */
export function resolveFileUnderRoot(root: string, relative: string): string | undefined {
  // `resolve` collapses `..` first, so the containment check below sees the real target.
  const file = resolve(root, relative.replace(/^\/+/, ''));
  if (!file.startsWith(root + sep) || !existsSync(file)) return undefined;
  return file;
}
