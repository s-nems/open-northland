import type { MapProvenance } from '@open-northland/data';
import { relIn, vdirname } from '@open-northland/vfs';
import type { SourceFile, SourceRoots } from '../../roots.js';

function under(root: string | undefined, path: string): boolean {
  if (root === undefined) return false;
  try {
    relIn(root, path);
    return true;
  } catch {
    return false;
  }
}

/** Loose `Data/maps` can hold installed mods, so a map there is `unknown`; `base` is reserved for a
 *  map proven to come from the game's own archive, which the map stages do not read yet. */
export function mapProvenance(roots: SourceRoots, source: SourceFile): MapProvenance {
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
  return { kind: 'unknown', folder, layer };
}
