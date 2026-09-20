import type { HuntPrey } from '@open-northland/data';
import {
  ANIMAL_TRIBE_BOARS,
  ANIMAL_TRIBE_CATTLE,
  ANIMAL_TRIBE_DEERS,
  ANIMAL_TRIBE_DUCKS,
  ANIMAL_TRIBE_GEESE,
  ANIMAL_TRIBE_GOATS,
  ANIMAL_TRIBE_HARES,
  ANIMAL_TRIBE_PARROTS,
  ANIMAL_TRIBE_RABBITS,
  ANIMAL_TRIBE_RAVENS,
  ANIMAL_TRIBE_SHEEP,
  ANIMAL_TRIBE_SPARROWS,
  ANIMAL_TRIBE_STAGS,
  ANIMAL_TRIBE_SWANS,
} from './animal-tribes.js';
import { JOB_HUNTER } from './jobs.js';

/**
 * The hunter's balance: which animal species are game, what each carcass yields, and the hunter bow's
 * band and damage. No readable source carries a per-species yield, so the species set and amounts are an
 * approximation (source basis "Hunter prey and carcass yields"). Keyed by real animal tribe ids and good
 * id-slugs, so the same table serves the real-content merge and the sandbox catalog.
 */

/** The carcass goods a species can yield, by good id-slug (resolved per content set). */
export type CarcassGoodSlug = 'meat' | 'leather' | 'wool';

export interface HuntPreyBalance {
  readonly tribeType: number;
  /** Livestock hunted only when no normal game is in the hunting ground (kept for husbandry). */
  readonly lastResort?: boolean;
  readonly yields: Readonly<Partial<Record<CarcassGoodSlug, number>>>;
}

/**
 * The prey species and their carcass yields. Predators, `aggressive` fauna and decorative fauna have no
 * row and are never hunted, nor does the chicken, whose extracted `hitpoints_adult 50000` would soak
 * over a hundred arrows. Small game gives meat alone, larger ungulates add a hide, and the last-resort
 * livestock rows mirror what a farm would get out of them.
 */
export const HUNT_PREY_BALANCE: readonly HuntPreyBalance[] = [
  { tribeType: ANIMAL_TRIBE_HARES, yields: { meat: 1 } },
  { tribeType: ANIMAL_TRIBE_RABBITS, yields: { meat: 1 } },
  { tribeType: ANIMAL_TRIBE_SPARROWS, yields: { meat: 1 } },
  { tribeType: ANIMAL_TRIBE_RAVENS, yields: { meat: 1 } },
  { tribeType: ANIMAL_TRIBE_PARROTS, yields: { meat: 1 } },
  { tribeType: ANIMAL_TRIBE_DUCKS, yields: { meat: 1 } },
  { tribeType: ANIMAL_TRIBE_GEESE, yields: { meat: 1 } },
  { tribeType: ANIMAL_TRIBE_SWANS, yields: { meat: 1 } },
  { tribeType: ANIMAL_TRIBE_DEERS, yields: { meat: 2, leather: 1 } },
  { tribeType: ANIMAL_TRIBE_GOATS, yields: { meat: 2, leather: 1 } },
  { tribeType: ANIMAL_TRIBE_STAGS, yields: { meat: 3, leather: 1 } },
  { tribeType: ANIMAL_TRIBE_BOARS, yields: { meat: 3, leather: 1 } },
  { tribeType: ANIMAL_TRIBE_SHEEP, lastResort: true, yields: { meat: 1, wool: 2 } },
  { tribeType: ANIMAL_TRIBE_CATTLE, lastResort: true, yields: { meat: 4, leather: 2 } },
];

/** A content set must carry these goods, with a harvest atomic, for its hunters to bank that yield. */
export const CARCASS_GOOD_SLUGS: readonly CarcassGoodSlug[] = ['meat', 'leather', 'wool'];

/** A content set's id rows a slug/tribe resolves against (sandbox and real ids differ). */
interface IdRow {
  readonly typeId: number;
  readonly id: string;
}

/**
 * Resolve the balance against a content set's own goods and tribes into its `huntPrey` table. Species
 * and yields the set does not carry are dropped, and a row left with no resolvable yield is dropped
 * whole, so the emitted table always passes the schema's cross-reference checks.
 */
export function huntPreyRows(goods: readonly IdRow[], tribes: readonly IdRow[]): HuntPrey[] {
  const goodBySlug = new Map(goods.map((g) => [g.id, g.typeId]));
  const tribeIds = new Set(tribes.map((t) => t.typeId));
  const rows: HuntPrey[] = [];
  for (const species of HUNT_PREY_BALANCE) {
    if (!tribeIds.has(species.tribeType)) continue;
    const yields = [];
    for (const [slug, amount] of Object.entries(species.yields)) {
      const goodType = goodBySlug.get(slug);
      if (goodType !== undefined) yields.push({ goodType, amount });
    }
    if (yields.length === 0) continue;
    rows.push({ tribeType: species.tribeType, lastResort: species.lastResort ?? false, yields });
  }
  return rows;
}

/**
 * The hunter's general experience track, transcribed verbatim from the extracted
 * `humanjobexperiencetypes.ini` type 37 (`hunter general`, job 15).
 */
export const HUNTER_GENERAL_XP_TRACK = {
  typeId: 37,
  id: 'hunter_general',
  name: 'hunter general',
  jobType: JOB_HUNTER,
  experienceFactor: 200,
  baseRepeatCounter: 5,
} as const;

/**
 * The hunter bow's band and damage: an authored override of the extracted `weapons.ini` row (typeId 19),
 * whose mod data makes the hunter bow stronger than a soldier's short bow (damage 700 vs 500, reach
 * 3-17 vs 3-15). A civilian trade must shoot weaker, so every value here sits just under the short bow's.
 * The row carries no `goodType`, so the bow stays outside the equipment economy as extracted.
 */
export const HUNTER_BOW_BALANCE: {
  readonly minRange: number;
  readonly maxRange: number;
  /** Per-armor-class damage, each below the short bow's column ({0:500, 1:128, 2:400, 3..4:100, 6:60, 7:100}). */
  readonly damage: Readonly<Record<string, number>>;
} = {
  minRange: 3,
  maxRange: 13, // short bow reaches 15
  damage: { '0': 400, '1': 100, '2': 320, '3': 80, '4': 80, '6': 50, '7': 80 },
};

// Clip timings transcribed verbatim from the extracted `atomicanimations.ini`, for
// `viking_hunter_attack` and `viking_hunter_harvest_cadaver`.
export const HUNTER_BOW_DRAW_LENGTH = 25;
export const HUNTER_BOW_RELEASE_FRAME = 12; // the ATTACK event (the arrow looses mid-draw)
export const HUNTER_HARVEST_CADAVER_LENGTH = 35;
