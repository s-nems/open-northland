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
 * The hunter's clean-room balance: which animal species are game, what each carcass yields, and the
 * hunter-bow band/damage. AUTHORED (user decisions) - no readable source carries a per-species yield,
 * so the species set and amounts are a named approximation (source basis "Hunter prey and carcass
 * yields"; the {@link HuntPrey} schema doc owns why `catchable` is not the signal). Shared by the
 * real-content merge and the sandbox catalog, keyed by the real animal tribe ids and good id-slugs so
 * one table serves both id spaces.
 */

/** The carcass goods a species can yield, by good id-slug (resolved per content set). */
export type CarcassGoodSlug = 'meat' | 'leather' | 'wool';

/** One species' hunting row: its tribe, whether it is last-resort livestock, and its carcass contents. */
export interface HuntPreyBalance {
  readonly tribeType: number;
  /** Livestock hunted only when no normal game is in the hunting ground (kept for husbandry). */
  readonly lastResort?: boolean;
  readonly yields: Readonly<Partial<Record<CarcassGoodSlug, number>>>;
}

/**
 * The prey species and their carcass yields. Predators (wolves, bears, lions), `aggressive` fauna
 * (ibexes, evil hares) and decorative fauna have no row and are never hunted; neither does the
 * chicken, whose extracted `hitpoints_adult 50000` would soak over a hundred hunter arrows - a grind
 * trap, not game. Small game gives meat alone (the sparrow/raven/parrot rows are dormant today -
 * their extracted `hitpoints_adult` is 0, which spawns no creature); the larger ungulates add a hide;
 * the last-resort livestock rows mirror what a farm would get out of them (sheep wool, cattle hides).
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

/** The distinct carcass good slugs the balance table names - what a content set must carry (with a
 *  harvest atomic) for its hunters to bank that yield. */
export const CARCASS_GOOD_SLUGS: readonly CarcassGoodSlug[] = ['meat', 'leather', 'wool'];

/** A content set's id rows a slug/tribe resolves against (sandbox and real ids differ). */
interface IdRow {
  readonly typeId: number;
  readonly id: string;
}

/**
 * Resolve {@link HUNT_PREY_BALANCE} against a content set's own goods and tribes into its `huntPrey`
 * table. Rows for species the set does not carry are dropped (the sandbox ships a handful of animal
 * tribes), as is a yield line whose good the set lacks - and a row left with no resolvable yield is
 * dropped whole, so the emitted table always passes the schema and its cross-reference checks.
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
 * `humanjobexperiencetypes.ini` type 37 (`hunter general`, job 15) - the sandbox `jobExperience` lane
 * ships it so a sandbox hunter trains exactly like one on real content (a carcass harvest accrues it
 * through the ordinary work-XP seam).
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
 * The hunter bow's band and damage - a DESIGN OVERRIDE of the extracted `weapons.ini` row (typeId 19):
 * the mod data makes the hunter bow strictly stronger than the short bow (damage 700 vs 500 per class,
 * reach 3-17 vs 3-15), but the hunter is a civilian trade, so it must shoot a weaker bow than a
 * soldier's (user decision). Every value sits just under the short bow's. The bow stays outside the
 * equipment economy exactly as extracted - its row carries no `goodType`, so it is never a
 * craftable/equippable good; the trade itself is the weapon binding.
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

// The hunter's clip timings, transcribed verbatim from the extracted `atomicanimations.ini`:
// `viking_hunter_attack` (the action-81 bow draw) and `viking_hunter_harvest_cadaver` (the action-33
// pluck) - the sandbox `atomicAnimations` lane ships them so its hunter paces exactly like one on
// real content.
export const HUNTER_BOW_DRAW_LENGTH = 25;
export const HUNTER_BOW_RELEASE_FRAME = 12; // the ATTACK event (the arrow looses mid-draw)
export const HUNTER_HARVEST_CADAVER_LENGTH = 35;
