import type { FootprintCell } from '@open-northland/data';
import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity } from '../ecs/world.js';

/** One player-buildable wall segment backed by a `ScriptLandscapeType.wall` record. `gfxIndex` is the
 * map catalog's stable landscape-gfx index; the sim keeps it opaque and reads all rules from the catalog. */
export const Palisade = defineComponent<{
  gfxIndex: number;
  tribe: number;
  built: Fixed;
  /** Detached copies of the selected graphics record's collision cells. A live sim never depends on the
   * app's map catalog continuing to exist after placement. */
  walk: FootprintCell[];
  /** Placement-only occupied body. An open gate retains its closed counterpart's full passage here. */
  placementWalk: FootprintCell[];
  construction: { goodType: number; amount: number }[];
  /** Source transition-9 valency gain per completed repair strike. */
  repairPerStrike: number;
  repairing: boolean;
  /** Exclusive builder claim for an unfinished segment, taken when a builder picks it; its work flag
   * shows from then on. */
  reservation: null | { builder: Entity };
  gate: null | { open: boolean; counterpartGfxIndex: number };
}>('Palisade', 'economy');

/** A completed wall's source-authored walk cells participate in routing. An unfinished marker reserves
 * its plot but remains passable until the single wood-consuming construction strike finishes. */
export const PalisadeBlocking = defineComponent<Record<string, never>>('PalisadeBlocking', 'movement');
