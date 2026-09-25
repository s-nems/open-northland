import { homeQualityView, householdGoodPolicyView, type WorldSnapshot } from '@open-northland/sim';
import { ONE } from '../projection/index.js';
import { readNumField } from '../snapshot/index.js';
import type { InHouseOverlay } from './in-house.js';

export interface HolyFireBinding {
  readonly name: string;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  /** The fire of a prayer site: it burns from the day the building stands, with no oil to feed it. */
  readonly perpetual: boolean;
}

/** Source-authored holy-fire points for one tribe, building type, and zero-based home level. */
export type HolyFireLookup = (
  tribe: number,
  buildingType: number,
  level: number,
) => HolyFireBinding | undefined;

/** The looping flames a visible finished home or prayer site stages this frame. A home's fire needs oil
 * its player allows it to burn; a prayer site's always burns. */
export function holyFireOverlays(
  snapshot: WorldSnapshot,
  building: number,
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
  if (!binding.perpetual) {
    if ((homeQualityView(snapshot, building)?.piety ?? 0) <= 0) return [];
    if (!householdGoodPolicyView(snapshot, player).piety) return [];
  }
  return binding.points.map((point) => ({ name: binding.name, dx: point.x, dy: point.y }));
}
