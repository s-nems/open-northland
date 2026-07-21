import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

/**
 * The containment rule the content routes and the desktop shell's static page files share: a
 * request may only ever reach an existing file *inside* the root it was routed to. `undefined`
 * means the caller falls through to its own 404.
 *
 * `root` must already be absolute and normalized — it is the host's own constant, never a request.
 * `relative` is matched as given: percent-decoding, if the host wants it, happens before the call.
 */
export function resolveFileUnderRoot(root: string, relative: string): string | undefined {
  // `resolve` collapses `..` first, so the containment check below sees the real target.
  const file = resolve(root, relative.replace(/^\/+/, ''));
  if (!file.startsWith(root + sep) || !existsSync(file)) return undefined;
  return file;
}
