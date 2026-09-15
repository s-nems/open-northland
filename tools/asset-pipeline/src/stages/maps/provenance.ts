import { dirname } from 'node:path';
import type { MapProvenance } from '@open-northland/data';

/** `CnModMaps/` and `DataCnmd/` are the mod's own maps and `UserMaps/` the player's; loose `Data/maps`
 *  can hold anything a game install accumulated, so a map there stays `unknown`. */
export function mapProvenance(rel: string): MapProvenance {
  const folder = dirname(rel);
  const head = folder.toLowerCase().split('/')[0];
  if (head === 'usermaps') return { kind: 'user', folder };
  if (head === 'cnmodmaps' || head === 'datacnmd') return { kind: 'mod', folder };
  return { kind: 'unknown', folder };
}
