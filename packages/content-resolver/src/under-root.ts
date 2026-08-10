import { normalizeRelPath, type ReadableVfs, vjoin } from '@open-northland/vfs';

/**
 * The shared containment rule: a request may only ever reach an existing file inside the root it was
 * routed to. `root` is a host constant, never a request, and `relative` is matched as given, so a
 * host that wants percent-decoding does it first.
 */
export async function resolveFileUnderRoot(
  fs: ReadableVfs,
  root: string,
  relative: string,
): Promise<string | undefined> {
  // normalizeRelPath collapses `..` and rejects escapes, so the join below cannot leave the root.
  const rel = normalizeRelPath(relative.replace(/^\/+/, ''));
  if (rel === undefined) return undefined;
  const file = vjoin(root, rel);
  return (await fs.stat(file))?.kind === 'file' ? file : undefined;
}
