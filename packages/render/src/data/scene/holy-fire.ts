import { homeQualityView, householdGoodPolicyView, type WorldSnapshot } from '@open-northland/sim';
import { ONE } from '../projection/index.js';
import { readNumField } from '../snapshot/index.js';
import type { InHouseOverlay } from './in-house.js';

export interface HolyFireBinding {
  readonly name: string;
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

/** Source-authored holy-fire points for one tribe, building type, and zero-based home level. */
export type HolyFireLookup = (
  tribe: number,
  buildingType: number,
  level: number,
) => HolyFireBinding | undefined;

/** The looping flames a visible finished home stages this frame. Policy is settlement-wide; retained
 * oil alone is insufficient when the player has forbidden its use. */
export function holyFireOverlays(
  snapshot: WorldSnapshot,
  home: number,
  components: Readonly<Record<string, unknown>>,
  lookup: HolyFireLookup | undefined,
): InHouseOverlay[] {
  if (lookup === undefined || 'UnderConstruction' in components) return [];
  const buildingType = readNumField(components, 'Building', 'buildingType');
  const tribe = readNumField(components, 'Building', 'tribe');
  const level = readNumField(components, 'Building', 'level');
  const built = readNumField(components, 'Building', 'built');
  const player = readNumField(components, 'Owner', 'player');
  if (
    buildingType === undefined ||
    tribe === undefined ||
    level === undefined ||
    built === undefined ||
    built < ONE ||
    player === undefined
  ) {
    return [];
  }
  const binding = lookup(tribe, buildingType, level);
  if (binding === undefined || binding.points.length === 0) return [];
  if ((homeQualityView(snapshot, home)?.piety ?? 0) <= 0) return [];
  if (!householdGoodPolicyView(snapshot, player).piety) return [];
  return binding.points.map((point) => ({ name: binding.name, dx: point.x, dy: point.y }));
}
