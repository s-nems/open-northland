import type { Entity, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { JOB_CIVILIST, JOB_WOMAN, placeSandboxBuilding } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The family scene: prove the marriage → household → child loop end to end, in two vignettes.
 *
 *  - **The wedding** (left): an unmarried woman is ordered to `marry` — she and the free man walk
 *    together, kiss (atomics 20/21), and stay spouses for life.
 *  - **The child** (right): an already-married couple assigned to the level-2 home is ordered to
 *    `makeChild`: the wife hauls the ground food into the home larder (3 units, reserved from
 *    eating), waits inside for her husband, hearts show over the house while they make love, and the
 *    family steps out with a newborn daughter who joins the household.
 *
 * The browser half is where a human judges the pixels: the kiss clip, the wife carrying food home,
 * the couple disappearing into the house, the hearts, the baby at the door, and the home's gold
 * family dot. The headless half asserts the mechanics below.
 */

const MAP_W = 26;
const MAP_H = 12;

/** The child couple's home — level 2 (`home_level_02`, `logichomesize` 3): the smallest tier with
 *  room for the couple plus their newborn. */
const HOME_REF = 'home_level_02';
const HOME = { x: 18, y: 5 } as const;
/**
 * The home's entity id, PREDICTED: the four settlers are created directly in `build` (ids 1..4) and
 * the enqueued `placeBuilding` creates exactly one entity on tick 0 — id 5. The `assignHouse` order
 * must name the home at build time, before tick 0 runs; the first check below asserts the prediction
 * so a placement-path change fails loudly instead of silently mis-assigning.
 */
const HOME_ENTITY = 5 as Entity;

/** The married couple (the child vignette) starts here, beside the home. */
const WIFE = { x: 14, y: 5 } as const;
const HUSBAND = { x: 15, y: 7 } as const;
/** The single pair (the wedding vignette), far enough apart that the walk-together reads on screen. */
const BRIDE = { x: 3, y: 3 } as const;
const GROOM = { x: 9, y: 3 } as const;
/** The loose food the wife hauls into the larder — exactly the sim's 3-unit child fund. */
const FOOD_PILE = { x: 11, y: 8, amount: 3 } as const;

/** Walks + 3 food round-trips + the 200-tick hearts phase all finish well inside this. */
const RUN_TICKS = 2500;
const INITIAL_ZOOM = 1.1;

const {
  Age,
  Building,
  ChildOrder,
  Female,
  FoodReserve,
  MakingLove,
  Marriage,
  Residence,
  Settler,
  Stockpile,
} = components;

/**
 * The simple-food good, resolved BY SLUG: the browser scene runs on merged real content (typeId 16,
 * the original id) while the headless twin runs on the sandbox catalog (typeId 116, the +100 rebase),
 * so a hardcoded id would silently no-op one of the two.
 */
function foodGoodType(sim: Simulation): number {
  const good = sim.content.goods.find((g) => g.id === 'food_simple');
  if (good === undefined) throw new Error('family scene: content has no food_simple good');
  return good.typeId;
}

/** The home larder's total stocked food (both food goods), for the fund-consumed check. */
function homeFoodUnits(sim: Simulation): number {
  const stock = sim.world.get(HOME_ENTITY, Stockpile).amounts;
  let total = 0;
  for (const good of sim.content.goods) {
    if (good.id.startsWith('food_')) total += stock.get(good.typeId) ?? 0;
  }
  return total;
}

/** Create one adult settler directly (pre-tick-0, so its id is known to the build's orders). */
function spawnAdult(sim: Simulation, jobType: number, x: number, y: number): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createSettler(sim.world, sim.content, sim.rng, {
    jobType,
    x: node.hx,
    y: node.hy,
    tribe: PRIMARY_TRIBE,
    owner: HUMAN_PLAYER,
  });
  if (e === null) throw new Error('family scene: unknown settler job');
  return e;
}

function build(sim: Simulation): void {
  // The child vignette's couple — pre-married (the wedding vignette shows the ceremony itself), so
  // the `makeChild` order below validates on tick 0.
  const wife = spawnAdult(sim, JOB_WOMAN, WIFE.x, WIFE.y);
  const husband = spawnAdult(sim, JOB_CIVILIST, HUSBAND.x, HUSBAND.y);
  sim.world.add(wife, Marriage, { spouse: husband, child: null });
  sim.world.add(husband, Marriage, { spouse: wife, child: null });

  // The wedding vignette's singles — the `marry` order pairs them and they walk together and kiss.
  const bride = spawnAdult(sim, JOB_WOMAN, BRIDE.x, BRIDE.y);
  spawnAdult(sim, JOB_CIVILIST, GROOM.x, GROOM.y);

  placeSandboxBuilding(sim, HOME_REF, HOME.x, HOME.y);
  const pile = cellAnchorNode(FOOD_PILE.x, FOOD_PILE.y);
  sim.enqueue({
    kind: 'dropGood',
    good: foodGoodType(sim),
    x: pile.hx,
    y: pile.hy,
    amount: FOOD_PILE.amount,
  });
  sim.enqueue({ kind: 'marry', entity: bride });
  sim.enqueue({ kind: 'assignHouse', entity: wife, house: HOME_ENTITY });
  sim.enqueue({ kind: 'makeChild', entity: wife, child: 'female' });
}

export const familyScene: SceneDefinition = {
  id: 'family',
  seed: 12,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the predicted home entity is the placed home (the assignHouse order named the right id)',
      predicate: (sim) =>
        sim.world.has(HOME_ENTITY, Building) &&
        sim.world.tryGet(HOME_ENTITY, Residence) === undefined &&
        sim.world.has(HOME_ENTITY, Stockpile),
    },
    {
      label: 'the marry order wed the single pair — mirrored lifelong Marriages, no lingering wedding',
      predicate: (sim) => {
        const married: Entity[] = [];
        for (const e of sim.world.query(Marriage, Settler)) married.push(e);
        if (married.length !== 4) return false; // both couples (the pre-married one + the wed one)
        for (const e of married) {
          const m = sim.world.get(e, Marriage);
          if (sim.world.get(m.spouse, Marriage).spouse !== e) return false;
        }
        return true;
      },
    },
    {
      label: 'a daughter was born into the household (a Female minor, living in the home)',
      predicate: (sim) => {
        for (const e of sim.world.query(Age, Settler)) {
          // Born a girl and still a minor — baby or child, since the run outlasts the 4-year baby
          // stage. Which of the two she is at the end is growth's business, not this scene's.
          const { jobType } = sim.world.get(e, Settler);
          if (!systems.isBaby(jobType) && !systems.isChild(jobType)) return false;
          if (!sim.world.has(e, Female)) return false;
          return sim.world.tryGet(e, Residence)?.home === HOME_ENTITY;
        }
        return false; // no daughter at all
      },
    },
    {
      label: 'the child fund was consumed and the order completed (no reserve, hearts, or order left)',
      predicate: (sim) => {
        if (homeFoodUnits(sim) !== 0) return false;
        if (sim.world.has(HOME_ENTITY, FoodReserve) || sim.world.has(HOME_ENTITY, MakingLove)) return false;
        for (const _e of sim.world.query(ChildOrder)) return false; // the order must be gone
        return true;
      },
    },
  ],
};
