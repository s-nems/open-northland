/**
 * Path helpers for `/`-separated {@link Vfs} paths. Backslashes are treated as separators too, so a
 * native Windows root handed to the Node adapter and an archive-borne `data\...` member both parse.
 */

const SEPARATORS = /[\\/]+/;

export function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

export function vjoin(...parts: readonly string[]): string {
  let joined = '';
  for (const part of parts) {
    if (part === '') continue;
    joined = joined === '' ? part : `${joined.replace(/[\\/]+$/, '')}/${part.replace(/^[\\/]+/, '')}`;
  }
  return joined;
}

/** Everything before the last separator; `''` for a bare name, `'/'` at the root. */
export function vdirname(path: string): string {
  const trimmed = toPosix(path).replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  if (cut < 0) return '';
  return cut === 0 ? '/' : trimmed.slice(0, cut);
}

export function vbasename(path: string): string {
  const trimmed = toPosix(path).replace(/\/+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/** `path` relative to `root`, for a `path` produced by joining under `root`; `''` when equal. */
export function relIn(root: string, path: string): string {
  if (path === root) return '';
  const base = root.replace(/[\\/]+$/, '');
  const rest = path.startsWith(base) ? path.slice(base.length) : undefined;
  if (rest === undefined || !/^[\\/]/.test(rest)) {
    throw new Error(`path ${path} is not under ${root}`);
  }
  return toPosix(rest).replace(/^\/+/, '');
}

/**
 * An archive-borne member name as a `/`-relative path that cannot escape its extraction root, or
 * `undefined` when it is absolute, drive-relative (`C:evil`), empty, or climbs out via `..`.
 */
export function normalizeRelPath(name: string): string | undefined {
  if (/^[A-Za-z]:/.test(name)) return undefined;
  const posix = toPosix(name);
  if (posix.startsWith('/')) return undefined;
  const segments: string[] = [];
  for (const segment of posix.split(SEPARATORS)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.pop() === undefined) return undefined;
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? undefined : segments.join('/');
}
