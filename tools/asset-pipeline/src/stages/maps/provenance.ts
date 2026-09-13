import type { MapProvenance } from '@open-northland/data';
import { type ReadableVfs, relIn, vdirname } from '@open-northland/vfs';
import { findPathCaseInsensitive, type SourceFile, type SourceRoots } from '../../roots.js';

function under(root: string | undefined, path: string): boolean {
  if (root === undefined) return false;
  try {
    relIn(root, path);
    return true;
  } catch {
    return false;
  }
}

/** Loose Data/maps can contain installed mods; only an unoverlaid folder from a recognized game archive is classified as base. */
export async function mapProvenance(
  fs: ReadableVfs,
  roots: SourceRoots,
  source: SourceFile,
): Promise<MapProvenance> {
  const folder = vdirname(source.rel).replace(/\\/g, '/');
  const parts = folder.toLowerCase().split('/');
  const layer: MapProvenance['layer'] =
    roots.mod !== roots.game && under(roots.mod, source.path)
      ? 'mod'
      : under(roots.game, source.path)
        ? 'game'
        : 'archive';
  if (parts[0] === 'usermaps') return { kind: 'user', folder, layer };
  if (parts[0] === 'cnmodmaps' || parts[0] === 'datacnmd') return { kind: 'mod', folder, layer };
  if (layer === 'mod') return { kind: 'mod', folder, layer };
  if (layer === 'archive' && parts[0] === 'data' && parts[1] === 'maps') {
    for (const root of new Set([roots.mod, roots.game])) {
      if (root === undefined) continue;
      // Even a sibling script or roster override prevents a base-only classification.
      if ((await findPathCaseInsensitive(fs, root, folder.split('/'))) !== undefined) {
        return { kind: 'unknown', folder, layer };
      }
    }
    const origins = roots.archiveOrigins;
    const prefix = `${folder.toLowerCase()}/`;
    if (origins?.get(source.rel.toLowerCase()) !== 'base') return { kind: 'unknown', folder, layer };
    for (const [member, origin] of origins) {
      if (member.startsWith(prefix) && origin !== 'base') return { kind: 'unknown', folder, layer };
    }
    return { kind: 'base', folder, layer };
  }
  return { kind: 'unknown', folder, layer };
}
